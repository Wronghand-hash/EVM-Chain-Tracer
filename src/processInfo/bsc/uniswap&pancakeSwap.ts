import { ethers, Interface } from "ethers";
// Assuming providerBSC, TRANSFER_TOPIC, and transferIface are BSC constants
import {
  provider,
  TRANSFER_TOPIC,
  transferIface,
} from "../../types/Bsc/constants";
import { Transfer } from "../../types/Etherium/types";
import { formatAmount } from "../../utils/bsc/utils"; // Used for display formatting
// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
// IPFS and Swarm gateways for robust fetching
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://ipfs.cherrybot.ai/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://ipfs.ethswarm.org/ipfs/",
];
const SWARM_GATEWAYS = [
  "https://gateway.ethswarm.org/bzz:/",
  "https://swarm-gateways.net/bzz:/",
  "https://bee.troopers.io/bzz:/", // Additional Swarm gateway
];
// PancakeSwap Router V2 address on BSC (for potential liquidity checks)
const PANCAKESWAP_ROUTER_V2 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
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
  liquidityAdded?: boolean; // Flag if liquidity detected via PancakeSwap
}
/**
 * Analyzes a transaction on BSC to extract token creation details with minimal external calls.
 * Extracts name/symbol from constructor args in tx input for direct deploys.
 * Prioritizes on-chain calls for runtime metadata.
 * Falls back to BscScan overview scraping for verified contract metadata.
 * Enhanced for robust IPFS/Swarm handling with headers.
 * Additionally checks for PancakeSwap liquidity addition in the same tx.
 * @param txHash The transaction hash to analyze.
 */
export async function analyzeTokenCreationBSC(txHash: string): Promise<void> {
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
    console.log(`\n--- Checking Token Creation on BSC: ${txHash} ---`);
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Deployer: ${userWallet}`);
    console.log(
      `Transaction Fee: ${ethers.formatEther(
        receipt.gasUsed * receipt.gasPrice
      )} BNB` // Note: BSC uses BNB
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
    // --- CHECK FOR PANCAKESWAP LIQUIDITY ADDITION ---
    let liquidityAdded = false;
    // Simple check: Look for Sync event from potential pair (Mint to pair or Sync after addLiquidity)
    // For full detection, parse router calls, but keep minimal: check if tx.to is PancakeRouter and input has addLiquidity
    if (txTo === PANCAKESWAP_ROUTER_V2.toLowerCase() && transaction.data) {
      try {
        // Basic heuristic: addLiquidityETH or addLiquidity signature
        const addLiquiditySig = "0xe8e33700"; // addLiquidity(address,uint256,uint256,uint256,uint256,address,uint256)
        const addLiquidityETHSig = "0xf305d719"; // addLiquidityETH(address,uint256,uint256,uint256,uint256,address,uint256)
        if (
          transaction.data.startsWith(addLiquiditySig) ||
          transaction.data.startsWith(addLiquidityETHSig)
        ) {
          liquidityAdded = true;
          console.log("Detected PancakeSwap liquidity addition in tx.");
        }
      } catch {}
    }
    // Alternative: Parse logs for PairCreated if via factory, but assume router call for simplicity
    finalData.liquidityAdded = liquidityAdded;
    // --- METADATA EXTRACTION FROM TX INPUT (For Direct Deploys, No External Calls) ---
    let fetchedName = "Unknown";
    let fetchedSymbol = "UNK";
    let fetchedDecimals = DEFAULT_DECIMALS;
    let fetchedTotalSupply = firstMint.value.toString(); // Use minted amount as total supply (common for initial mints)

    // Parse constructor args for standard ERC20 if direct deploy
    if (txTo === "0x" && transaction.data && transaction.data.length > 10) {
      // Try constructor with decimals first
      const ERC20_ABI_WITH_DEC = [
        "constructor(string name, string symbol, uint8 decimals)",
      ];
      const ERC20_ABI_WITHOUT_DEC = ["constructor(string name, string symbol)"];
      let parsed = null;
      try {
        const ifaceWithDec = new Interface(ERC20_ABI_WITH_DEC);
        parsed = ifaceWithDec.parseTransaction({ data: transaction.data });
        if (parsed && parsed.name === "constructor") {
          fetchedName = parsed.args.name;
          fetchedSymbol = parsed.args.symbol;
          fetchedDecimals = Number(parsed.args.decimals);
          console.log(
            `Extracted metadata from constructor args (with decimals): ${fetchedName} (${fetchedSymbol}), decimals: ${fetchedDecimals}`
          );
        }
      } catch {}

      if (fetchedName === "Unknown") {
        try {
          const ifaceWithoutDec = new Interface(ERC20_ABI_WITHOUT_DEC);
          parsed = ifaceWithoutDec.parseTransaction({ data: transaction.data });
          if (parsed && parsed.name === "constructor") {
            fetchedName = parsed.args.name;
            fetchedSymbol = parsed.args.symbol;
            console.log(
              `Extracted metadata from constructor args (without decimals): ${fetchedName} (${fetchedSymbol})`
            );
          }
        } catch {}
      }
    }

    // --- PRIORITIZE ON-CHAIN METADATA EXTRACTION (Cheap view calls) ---
    const contractAddr = finalData.tokenMint;
    const erc20Abi = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
    ];
    const tokenContract = new ethers.Contract(contractAddr, erc20Abi, provider);
    try {
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
      ]);
      fetchedName = name;
      fetchedSymbol = symbol;
      fetchedDecimals = Number(decimals);
      console.log(
        `Extracted runtime metadata: ${name} (${symbol}), decimals: ${decimals}`
      );
    } catch (e) {
      console.warn(`Failed on-chain metadata fetch: ${e}`);
      // Proceed to scraping fallback
    }

    // Fallback: Fetch/parse from BscScan if metadata still unknown (e.g., for decimals override)
    if (
      fetchedName === "Unknown" ||
      fetchedSymbol === "UNK" ||
      fetchedDecimals === DEFAULT_DECIMALS
    ) {
      // Use base URL for overview metadata (more reliable)
      const bscscanUrl = `https://bscscan.com/address/${contractAddr}`;
      try {
        const fetchOptions = {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)",
          }, // Helps with gateway compatibility
        };
        const response = await fetch(bscscanUrl, fetchOptions);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // Extract metadata from BscScan overview (refined regex for robustness)
        // Name: Matches "Contract Name:</span> Manyu" or similar variations (BscScan similar to Etherscan)
        let nameMatch = html.match(
          /Contract Name\s*[:<]?\s*<\/?span[^>]*>\s*([A-Za-z\s]+?)(?=<|<\/div>)/i
        );
        if (!nameMatch)
          nameMatch = html.match(
            /Contract Name[^:]*:\s*([A-Za-z\s]+?)(?=\s*<)/i
          );
        if (nameMatch && fetchedName === "Unknown") {
          fetchedName = nameMatch[1].trim();
          console.log(`Extracted name from overview: ${fetchedName}`);
        }

        // Symbol: Matches "Token Symbol:</span> MANYU" or "Symbol:</span> MANYU"
        let symbolMatch = html.match(
          /Symbol\s*[:<]?\s*<\/?span[^>]*>\s*([A-Z]{2,10})(?=<|<\/div>)/i
        );
        if (!symbolMatch)
          symbolMatch = html.match(/Symbol[^:]*:\s*([A-Z]{2,10})(?=\s*<)/i);
        if (symbolMatch && fetchedSymbol === "UNK") {
          fetchedSymbol = symbolMatch[1];
          console.log(`Extracted symbol from overview: ${fetchedSymbol}`);
        }

        // Decimals: Matches "Decimals:</span> 9"
        let decMatchOverview = html.match(
          /Decimals\s*[:<]?\s*<\/?span[^>]*>\s*(\d+)(?=<|<\/div>)/i
        );
        if (!decMatchOverview)
          decMatchOverview = html.match(/Decimals[^:]*:\s*(\d+)(?=\s*<)/i);
        if (decMatchOverview && fetchedDecimals === DEFAULT_DECIMALS) {
          fetchedDecimals = parseInt(decMatchOverview[1]);
          console.log(`Extracted decimals from overview: ${fetchedDecimals}`);
        }

        // If overview extraction succeeded, skip further fetching
        if (
          fetchedName !== "Unknown" &&
          fetchedSymbol !== "UNK" &&
          fetchedDecimals !== DEFAULT_DECIMALS
        ) {
          console.log("Metadata fully extracted from BscScan overview.");
        } else {
          // Fallback to source extraction (now fetch #code tab for embedded source)
          const codeUrl = `https://bscscan.com/address/${contractAddr}#code`;
          const codeResponse = await fetch(codeUrl, fetchOptions);
          if (codeResponse.ok) {
            const codeHtml = await codeResponse.text();
            // Extract protocol and hash from code tab
            const protocolMatch = codeHtml.match(
              /(ipfs|swarm|bzz):\/\/([a-f0-9]{64})/i
            );
            let source = "";
            if (protocolMatch) {
              const protocol = protocolMatch[1].toLowerCase();
              const hash = protocolMatch[2];
              console.log(
                `Found ${protocol.toUpperCase()} hash: ${hash}, attempting fetch...`
              );
              const gateways =
                protocol === "ipfs" ? IPFS_GATEWAYS : SWARM_GATEWAYS;
              for (const gw of gateways) {
                try {
                  const gwUrl = `${gw}${hash}`;
                  const gwResponse = await fetch(gwUrl, fetchOptions);
                  if (gwResponse.ok) {
                    source = await gwResponse.text();
                    console.log(`Fetched source from ${gw}`);
                    break;
                  } else {
                    console.warn(`Gateway ${gw} failed: ${gwResponse.status}`);
                  }
                } catch (gwErr) {
                  console.warn(`Gateway ${gw} error: ${gwErr}`);
                }
              }
            }

            // If no hash/fetch, extract embedded source from #code HTML
            if (!source) {
              const preRegex =
                /<pre[^>]*id=["']?contractSourceCode["']?[^>]*>([\s\S]*?)<\/pre>/i;
              let preMatch = preRegex.exec(codeHtml);
              if (!preMatch) {
                // Broader fallback
                const broadRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
                let broadMatch;
                while ((broadMatch = broadRegex.exec(codeHtml)) !== null) {
                  let candidate = broadMatch[1]
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, "&")
                    .replace(/&nbsp;/g, " ")
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/&\#xA;/g, "\n")
                    .trim();
                  if (
                    candidate.includes("pragma solidity") &&
                    !/^[0-9a-f]+$/i.test(candidate.replace(/\s/g, ""))
                  ) {
                    source = candidate;
                    console.log(
                      "Extracted embedded Solidity source from BscScan #code tab."
                    );
                    break;
                  }
                }
              } else {
                source = preMatch[1]
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, "&")
                  .replace(/&nbsp;/g, " ")
                  .replace(/<br\s*\/?>/gi, "\n")
                  .replace(/&\#xA;/g, "\n")
                  .trim();
                console.log("Extracted source from #contractSourceCode <pre>.");
              }
            }

            if (source && fetchedName === "Unknown") {
              // Fallback regex for hardcoded ERC20
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
            }

            if (source) {
              // Parse for decimals override
              const decMatch = source.match(
                /function\s+decimals\s*\(\)\s*(public|view|pure|external)?\s*(virtual\s+override\s+)?returns\s*\(\s*uint8\s*\)\s*\{?\s*return\s+(\d+);/i
              );
              if (
                decMatch &&
                (fetchedDecimals === DEFAULT_DECIMALS ||
                  fetchedDecimals === undefined)
              ) {
                fetchedDecimals = parseInt(decMatch[3]);
                console.log(
                  `Extracted decimals from source: ${fetchedDecimals}`
                );
              }
            } else if (fetchedName === "Unknown") {
              console.warn("No source code found on BscScan.");
            }
          } else {
            console.warn(`Failed to fetch #code tab: ${codeResponse.status}`);
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch/parse BscScan source: ${e}`);
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
      "\n✅ Token Creation Successfully Analyzed on BSC (No Metadata Contract Calls)"
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
    console.log(
      `PancakeSwap Liquidity Added: ${
        finalData.liquidityAdded ? "Yes ✅" : "No"
      }`
    );
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
