import { ethers, Interface } from "ethers";
// Assuming provider, TRANSFER_TOPIC, and transferIface are generic ERC20 constants
import { provider, TRANSFER_TOPIC, transferIface } from "./types/constants";
import { Transfer } from "./types/types";
import { formatAmount } from "./utils/utils"; // Used for display formatting
// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
// Interface for the desired final output data
interface TokenCreationData {
  tokenMint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  programId: string; // EVM concept: Contract/Factory Address called by the transaction
  decimals?: number;
  tokenBalanceChanges?: string; // Formatted initial mint amount
  tokenChanges?: {
    // Raw log data from the mint event
    from: string;
    to: string;
    value: string;
  };
  hash: string;
  totalSupply?: string; // Formatted total supply
}
/**
 * Analyzes a transaction to extract token creation details with minimal external calls.
 * Updated to fallback to fetching/parsing source code from Etherscan/IPFS for direct deploys.
 * Improved HTML parsing: extracts all <pre> blocks and selects the one containing Solidity source.
 * Uses alternative IPFS gateway (cherrybot.ai) for fetches.
 * @param txHash The transaction hash to analyze.
 */
export async function analyzeTokenCreation(txHash: string): Promise<void> {
  let finalData: Partial<TokenCreationData> = { hash: txHash };
  try {
    // --- EXTERNAL CALL 1 (Initial Data Fetch) ---
    // Fetch both simultaneously for robustness, though receipt is often fetched first.
    const [receipt, transaction] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);
    if (!receipt || receipt.status !== 1) {
      console.log(
        `Transaction ${
          receipt?.status === 0 ? "failed" : "not found"
        }: ${txHash}`
      );
      return;
    }
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    // Set initial data fields
    const userWallet = transaction.from.toLowerCase();
    const txTo = transaction.to?.toLowerCase() || "0x";
    finalData.creatorAddress = userWallet;
    finalData.programId =
      txTo === "0x"
        ? receipt.contractAddress?.toLowerCase() || "N/A (Direct Deploy)"
        : txTo;
    console.log(`\n--- Checking Token Creation: ${txHash} ---`);
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Deployer: ${userWallet}`);
    console.log(
      `Transaction Fee: ${ethers.formatEther(
        receipt.gasUsed * receipt.gasPrice
      )} ETH`
    );
    // --- LOG PARSING (Find Mint Event) ---
    let firstMint: Transfer | null = null;
    for (const log of receipt.logs) {
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed && parsed.args.from.toLowerCase() === ZERO_ADDRESS) {
            firstMint = {
              token: log.address.toLowerCase(),
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            };
            break; // Found the first mint, which defines the token address
          }
        } catch {}
      }
    }
    if (!firstMint) {
      console.log(
        "No initial mint (transfer from zero address) found. Not a standard token creation."
      );
      return;
    }
    // Set fields derived from the mint log
    finalData.tokenMint = firstMint.token;
    finalData.tokenChanges = {
      from: firstMint.from,
      to: firstMint.to,
      value: firstMint.value.toString(),
    };
    // --- METADATA EXTRACTION FROM SOURCE (No Contract Calls) ---
    let fetchedName = "Unknown";
    let fetchedSymbol = "UNK";
    let fetchedDecimals = DEFAULT_DECIMALS;
    let fetchedTotalSupply = firstMint.value.toString(); // Use minted amount as total supply (common for initial mints)

    // Fallback for direct deploys: Fetch source from Etherscan and parse for metadata
    if (fetchedName === "Unknown") {
      const contractAddr = finalData.tokenMint;
      const etherscanUrl = `https://etherscan.io/address/${contractAddr}#code`;
      try {
        const response = await fetch(etherscanUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // First, try to extract IPFS/Swarm hash
        let hashMatch = html.match(/(?:ipfs|swarm|bzz):\/\/([a-f0-9]{64})/i);
        let source = "";
        if (hashMatch) {
          const hash = hashMatch[1];
          console.log(`Found hash: ${hash}, attempting IPFS fetch...`);
          // Try IPFS with cherrybot.ai gateway
          let ipfsUrl = `https://ipfs.cherrybot.ai/ipfs/${hash}`;
          let ipfsResponse = await fetch(ipfsUrl);
          if (ipfsResponse.ok) {
            source = await ipfsResponse.text();
          } else {
            console.warn(
              `Cherrybot IPFS fetch failed (${ipfsResponse.status}), trying Swarm...`
            );
            // Try Swarm
            const swarmUrl = `https://gateway.ethswarm.org/bzz:/${hash}/`;
            const swarmResponse = await fetch(swarmUrl);
            if (swarmResponse.ok) {
              source = await swarmResponse.text();
            } else {
              console.warn(`Swarm fetch failed (${swarmResponse.status})`);
            }
          }
        }

        // If no hash or fetch failed, extract from Etherscan HTML source display
        if (!source) {
          // Improved: Extract all <pre> blocks and select the Solidity source one
          const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
          let match;
          let candidates: string[] = [];
          while ((match = preRegex.exec(html)) !== null) {
            let candidate = match[1]
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, "&")
              .replace(/&nbsp;/g, " ")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/&\#xA;/g, "\n")
              .trim();
            // Filter for Solidity source: contains 'pragma solidity' and not just hex-like
            if (
              candidate.includes("pragma solidity") &&
              !/^[0-9a-f]+$/i.test(candidate.replace(/\s/g, ""))
            ) {
              candidates.push(candidate);
            }
          }
          if (candidates.length > 0) {
            source = candidates[0]; // Take the first valid one
            console.log(
              `Extracted Solidity source from Etherscan HTML (${candidates.length} candidates).`
            );
          } else {
            console.warn("No valid Solidity source <pre> found in HTML.");
          }
        }

        if (source) {
          // Parse source for ERC20 constructor
          const erc20Match = source.match(
            /ERC20\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/
          );
          if (erc20Match) {
            fetchedName = erc20Match[1];
            fetchedSymbol = erc20Match[2];
            console.log(
              `Extracted metadata from source: ${fetchedName} (${fetchedSymbol})`
            );
          }

          // Parse for decimals override
          const decMatch = source.match(
            /function\s+decimals\s*\(\)\s*(public|view|pure|external)?\s*(virtual\s+override\s+)?returns\s*\(\s*uint8\s*\)\s*\{?\s*return\s+(\d+);/i
          );
          if (decMatch) {
            fetchedDecimals = parseInt(decMatch[3]);
            console.log(`Extracted decimals from source: ${fetchedDecimals}`);
          }
        } else {
          console.warn("No source code found on Etherscan.");
        }
      } catch (e) {
        console.warn(`Failed to fetch/parse Etherscan/IPFS/Swarm source: ${e}`);
      }
    }

    // --- Finalize all data fields ---
    finalData.name = fetchedName;
    finalData.symbol = fetchedSymbol;
    finalData.decimals = fetchedDecimals;
    finalData.totalSupply = fetchedTotalSupply;
    finalData.tokenBalanceChanges = formatAmount(
      firstMint.value,
      fetchedDecimals,
      fetchedSymbol
    );
    // --- Output Results ---
    console.log(
      "\n✅ Token Creation Successfully Analyzed (No Metadata Contract Calls)"
    );
    console.log("-------------------------------------------------------");
    console.log(`Token Address (Mint): ${finalData.tokenMint}`);
    console.log(
      `Token Name/Symbol:    ${finalData.name} (${finalData.symbol})`
    );
    console.log(`Decimals:             ${finalData.decimals}`);
    console.log(
      `Total Supply:         ${formatAmount(
        BigInt(finalData.totalSupply),
        finalData.decimals!,
        finalData.symbol!
      )}`
    );
    console.log(`Initial Mint Amount:  ${finalData.tokenBalanceChanges}`);
    console.log(`Initial Recipient:    ${finalData.tokenChanges!.to}`);
    console.log(`Contract/Factory ID:  ${finalData.programId}`);
    console.log(`Creator Address:      ${finalData.creatorAddress}`);
    console.log(`Transaction Hash:     ${finalData.hash}`);
    console.log("-------------------------------------------------------");
  } catch (err) {
    console.error(
      `Error analyzing token creation in transaction ${txHash}: ${
        (err as Error).message
      }`
    );
  }
}
