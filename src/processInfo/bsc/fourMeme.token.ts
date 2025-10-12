import { ethers } from "ethers";
import {
  provider,
  TRANSFER_TOPIC,
  transferIface,
} from "../../types/Bsc/constants";
import { Transfer } from "../../types/Etherium/types";
import { formatAmount } from "../../utils/bsc/utils";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
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
  "https://bee.troopers.io/bzz:/",
];
const FOURMEME_FACTORY = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";

interface TokenCreationData {
  tokenMint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  programId: string;
  decimals?: number;
  tokenBalanceChanges?: string;
  tokenChanges?: {
    from: string;
    to: string;
    value: string;
  };
  hash: string;
  totalSupply?: string;
  liquidityAdded?: boolean;
}

export async function analyzeTokenCreationFourMeme(
  txHash: string
): Promise<void> {
  let finalData: Partial<TokenCreationData> = { hash: txHash };
  let externalCalls = 0;
  try {
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
    const userWallet = transaction.from.toLowerCase();
    const txTo = transaction.to?.toLowerCase() || "0x";
    finalData.creatorAddress = userWallet;
    finalData.programId =
      txTo === "0x"
        ? receipt.contractAddress?.toLowerCase() || "N/A (Direct Deploy)"
        : txTo;
    console.log(
      `\n--- Checking Token Creation on BSC (Four.meme): ${txHash} ---`
    );
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Deployer: ${userWallet}`);

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
            break;
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
    finalData.tokenMint = firstMint.token;
    finalData.tokenChanges = {
      from: firstMint.from,
      to: firstMint.to,
      value: firstMint.value.toString(),
    };
    let liquidityAdded = false;
    if (txTo === FOURMEME_FACTORY.toLowerCase() && transaction.data) {
      liquidityAdded = true;
      console.log(
        "Detected Four.meme token creation with liquidity addition in tx."
      );
    }
    finalData.liquidityAdded = liquidityAdded;
    let fetchedName = "Unknown";
    let fetchedSymbol = "UNK";
    let fetchedDecimals = DEFAULT_DECIMALS;
    let fetchedTotalSupply = firstMint.value.toString();
    if (txTo === "0x" && transaction.data && transaction.data.length > 10) {
      const FOURMEME_CONSTRUCTOR_ABI = [
        "constructor(string name, string symbol, bytes32 maxSupply)",
      ];
      try {
        const iface = new ethers.utils.Interface(FOURMEME_CONSTRUCTOR_ABI);
        const parsed = iface.parseTransaction({
          data: transaction.data,
        });
        if (parsed && parsed.name === "constructor") {
          fetchedName = parsed.args.name;
          fetchedSymbol = parsed.args.symbol;
          const maxSupplyHex = parsed.args.maxSupply as string;
          fetchedTotalSupply = BigInt(maxSupplyHex).toString();
          fetchedDecimals = DEFAULT_DECIMALS;
          console.log(
            `Extracted metadata from constructor args: ${fetchedName} (${fetchedSymbol}), total supply from maxSupply`
          );
          finalData.name = fetchedName;
          finalData.symbol = fetchedSymbol;
          finalData.decimals = fetchedDecimals;
          finalData.totalSupply = fetchedTotalSupply;
          finalData.tokenBalanceChanges = formatAmount(
            firstMint.value,
            fetchedDecimals,
            fetchedSymbol
          );
          console.log(
            "\n✅ Token Creation Successfully Analyzed on BSC (Four.meme - Constructor Metadata)"
          );
          console.log(`External Calls Made: 0 (beyond initial tx/receipt)`);
          console.log(
            "-------------------------------------------------------"
          );
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
            `Four.meme Liquidity Added: ${
              finalData.liquidityAdded ? "Yes ✅" : "No"
            }`
          );
          console.log(`Contract/Factory ID:  ${finalData.programId}`);
          console.log(`Creator Address:      ${finalData.creatorAddress}`);
          console.log(`Transaction Hash:     ${finalData.hash}`);
          console.log(
            "-------------------------------------------------------"
          );
          return;
        }
      } catch {}
    }

    // --- PRIORITIZE ON-CHAIN METADATA EXTRACTION (3 cheap view calls) ---
    const contractAddr = finalData.tokenMint;
    const erc20Abi = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
    ];
    const tokenContract = new ethers.Contract(contractAddr, erc20Abi, provider);
    let onChainSuccess = false;
    try {
      externalCalls += 3; // 3 parallel view calls
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
      onChainSuccess = true;
    } catch (e) {
      console.warn(
        `Failed on-chain metadata fetch: ${e} - Falling back to scraping`
      );
    }

    // --- FALLBACK SCRAPING ONLY IF ON-CHAIN FAILED ---
    if (!onChainSuccess) {
      const bscscanUrl = `https://bscscan.com/address/${contractAddr}`;
      try {
        externalCalls += 1;
        const fetchOptions = {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)",
          },
        };
        const response = await fetch(bscscanUrl, fetchOptions);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // Extract from overview
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

        let symbolMatch = html.match(
          /Symbol\s*[:<]?\s*<\/?span[^>]*>\s*([A-Z]{2,10})(?=<|<\/div>)/i
        );
        if (!symbolMatch)
          symbolMatch = html.match(/Symbol[^:]*:\s*([A-Z]{2,10})(?=\s*<)/i);
        if (symbolMatch && fetchedSymbol === "UNK") {
          fetchedSymbol = symbolMatch[1];
          console.log(`Extracted symbol from overview: ${fetchedSymbol}`);
        }

        let decMatchOverview = html.match(
          /Decimals\s*[:<]?\s*<\/?span[^>]*>\s*(\d+)(?=<|<\/div>)/i
        );
        if (!decMatchOverview)
          decMatchOverview = html.match(/Decimals[^:]*:\s*(\d+)(?=\s*<)/i);
        if (decMatchOverview && fetchedDecimals === DEFAULT_DECIMALS) {
          fetchedDecimals = parseInt(decMatchOverview[1]);
          console.log(`Extracted decimals from overview: ${fetchedDecimals}`);
        }

        if (
          fetchedName !== "Unknown" &&
          fetchedSymbol !== "UNK" &&
          fetchedDecimals !== DEFAULT_DECIMALS
        ) {
          console.log("Metadata fully extracted from BscScan overview.");
        } else {
          // Source extraction if needed
          const codeUrl = `https://bscscan.com/address/${contractAddr}#code`;
          externalCalls += 1;
          const codeResponse = await fetch(codeUrl, fetchOptions);
          if (codeResponse.ok) {
            const codeHtml = await codeResponse.text();
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
                    externalCalls += 1;
                    break;
                  } else {
                    console.warn(`Gateway ${gw} failed: ${gwResponse.status}`);
                  }
                } catch (gwErr) {
                  console.warn(`Gateway ${gw} error: ${gwErr}`);
                }
              }
            }

            if (!source) {
              // Embedded source extraction
              const preRegex =
                /<pre[^>]*id=["']?contractSourceCode["']?[^>]*>([\s\S]*?)<\/pre>/i;
              let preMatch = preRegex.exec(codeHtml);
              if (preMatch) {
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
              } else {
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
              }
            }

            if (source && fetchedName === "Unknown") {
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

            if (source && fetchedDecimals === DEFAULT_DECIMALS) {
              const decMatch = source.match(
                /function\s+decimals\s*\(\)\s*(public|view|pure|external)?\s*(virtual\s+override\s+)?returns\s*\(\s*uint8\s*\)\s*\{?\s*return\s+(\d+);/i
              );
              if (decMatch) {
                fetchedDecimals = parseInt(decMatch[3]);
                console.log(
                  `Extracted decimals from source: ${fetchedDecimals}`
                );
              }
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
    const successMsg = onChainSuccess
      ? " (On-Chain Metadata)"
      : " (Scraping Fallback)";
    console.log(
      `\n✅ Token Creation Successfully Analyzed on BSC (Four.meme)${successMsg}`
    );
    console.log(
      `External Calls Made: ${externalCalls} (beyond initial tx/receipt)`
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
      `Four.meme Liquidity Added: ${finalData.liquidityAdded ? "Yes ✅" : "No"}`
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
