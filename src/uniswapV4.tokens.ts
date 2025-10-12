// import { ethers, Interface } from "ethers";
// import {
//   DEFAULT_DECIMALS,
//   INITIALIZE_ABI,
//   provider,
//   TRANSFER_TOPIC_V4,
//   ZERO_HASH,
// } from "./types/Etherium/constants";
// import { formatAmount } from "./utils/utils";
// import { Log } from "ethers";
// import { PoolCreationData, TokenCreationData } from "./types/Etherium/types";

// function extractStringsFromInput(inputHex: string): {
//   name?: string;
//   symbol?: string;
// } {
//   if (!inputHex || inputHex === "0x") return {};
//   const bytes = ethers.getBytes(inputHex);
//   let strings: string[] = [];
//   let current = "";
//   for (const byte of bytes) {
//     const char = String.fromCharCode(byte);
//     if (/[\x20-\x7e]/.test(char)) {
//       current += char;
//     } else {
//       if (current.length > 4) strings.push(current);
//       current = "";
//     }
//   }
//   if (current.length > 4) strings.push(current);

//   let name: string | undefined;
//   let symbol: string | undefined;
//   for (const s of strings) {
//     const lower = s.toLowerCase();
//     if (lower.includes("token") && s.length > 10 && !name) name = s.trim();
//     if (/^[A-Z]{3,6}$/.test(s) && !symbol && !lower.includes("http"))
//       symbol = s;
//     if (name && symbol) break;
//   }
//   return { name, symbol };
// }

// function parseSourceForMetadata(source: string): {
//   name?: string;
//   symbol?: string;
//   decimals?: number;
// } {
//   const nameMatch =
//     source.match(
//       /function\s+name\s*\(\)\s*(?:public|view|pure|override|virtual)?\s*(?:returns\s*\([^)]*\))?\s*\{[^}]*return\s+["']([^"']+)["']/i
//     ) ||
//     source.match(/ERC20\s*\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*\)/) ||
//     source.match(/string\s+public\s+name\s*=\s*"([^"]+)";/i);
//   const symbolMatch =
//     source.match(
//       /function\s+symbol\s*\(\)\s*(?:public|view|pure|override|virtual)?\s*(?:returns\s*\([^)]*\))?\s*\{[^}]*return\s+["']([^"']+)["']/i
//     ) ||
//     source.match(/ERC20\s*\(\s*"[^"]+",\s*"([^"]+)"\s*\)/) ||
//     source.match(/string\s+public\s+symbol\s*=\s*"([^"]+)";/i);
//   const decMatch =
//     source.match(
//       /function\s+decimals\s*\(\)\s*(?:public|view|pure|override|virtual)?\s*(?:returns\s*\([^)]*\))?\s*\{[^}]*return\s+(\d+);/i
//     ) || source.match(/uint8\s+public\s+decimals\s*=\s*(\d+);/i);

//   const name = nameMatch ? nameMatch[1] : undefined;
//   const symbol = symbolMatch ? symbolMatch[1] : undefined;
//   const decimals = decMatch ? parseInt(decMatch[1], 10) : undefined;

//   return { name, symbol, decimals };
// }

// async function extractTokenMetadata(
//   contractAddr: string,
//   logs?: readonly Log[],
//   txInput?: string
// ): Promise<{
//   name: string;
//   symbol: string;
//   decimals: number;
//   totalSupply: string;
// }> {
//   let name = "Unknown";
//   let symbol = "UNK";
//   let decimals = DEFAULT_DECIMALS;
//   let totalSupply = "0"; // --- 1. Compute Initial Total Supply from Logs ---

//   if (logs && logs.length > 0) {
//     let initialSupply = 0n;
//     for (const log of logs) {
//       if (
//         log.address.toLowerCase() === contractAddr.toLowerCase() &&
//         log.topics[0]?.toLowerCase() === TRANSFER_TOPIC_V4.toLowerCase() &&
//         log.topics[2]?.toLowerCase() === ZERO_HASH.toLowerCase()
//       ) {
//         initialSupply += BigInt(log.data);
//       }
//     }
//     if (initialSupply > 0n) {
//       totalSupply = initialSupply.toString(); // Log info only if supply was determined
//       console.log(
//         `[INFO] Initial Supply determined from logs: ${formatAmount(
//           initialSupply,
//           decimals,
//           symbol
//         )}`
//       );
//     }
//   }

//   if (txInput) {
//     const inputMeta = extractStringsFromInput(txInput);
//     if (inputMeta.name) name = inputMeta.name;
//     if (inputMeta.symbol) symbol = inputMeta.symbol;
//     if (name !== "Unknown" && symbol !== "UNK") {
//       decimals = 18;
//     }
//   }

//   const codeUrl = `https://etherscan.io/address/${contractAddr}#code`;
//   try {
//     const fetchOptions = {
//       headers: { "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)" },
//     };
//     const response = await fetch(codeUrl, fetchOptions);
//     if (!response.ok) throw new Error(`HTTP ${response.status}`);
//     const codeHtml = await response.text();

//     let source = "";
//     const preRegex =
//       /<pre[^>]*id=["']?contractSourceCode["']?[^>]*>([\s\S]*?)<\/pre>/i;
//     let preMatch = preRegex.exec(codeHtml);

//     if (!preMatch) {
//       const broadRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
//       let broadMatch;
//       while ((broadMatch = broadRegex.exec(codeHtml)) !== null) {
//         let candidate = broadMatch[1]
//           .replace(/&lt;/g, "<")
//           .replace(/&gt;/g, ">")
//           .replace(/&quot;/g, '"')
//           .replace(/&amp;/g, "&")
//           .replace(/&nbsp;/g, " ")
//           .replace(/<br\s*\/?>/gi, "\n")
//           .replace(/&\#xA;/g, "\n")
//           .trim();
//         if (
//           candidate.includes("pragma solidity") &&
//           !/^[0-9a-f]+$/i.test(candidate.replace(/\s/g, ""))
//         ) {
//           source = candidate;
//           break;
//         }
//       }
//     } else {
//       source = preMatch[1]
//         .replace(/&lt;/g, "<")
//         .replace(/&gt;/g, ">")
//         .replace(/&quot;/g, '"')
//         .replace(/&amp;/g, "&")
//         .replace(/&nbsp;/g, " ")
//         .replace(/<br\s*\/?>/gi, "\n")
//         .replace(/&\#xA;/g, "\n")
//         .trim();
//     }

//     if (source) {
//       console.log(
//         `[INFO] Source code for ${contractAddr} successfully extracted from Etherscan.`
//       );
//     }

//     if (source && name === "Unknown") {
//       const parsed = parseSourceForMetadata(source);
//       if (parsed.name) name = parsed.name;
//       if (parsed.symbol) symbol = parsed.symbol;
//       if (parsed.decimals !== undefined) decimals = parsed.decimals;
//     }
//   } catch (e) {
//     console.warn(
//       `[WARNING] Etherscan #code fetch/parse failed for ${contractAddr}.`
//     );
//   }

//   const needsScraping =
//     name === "Unknown" ||
//     symbol === "UNK" ||
//     decimals === DEFAULT_DECIMALS ||
//     totalSupply === "0";
//   if (needsScraping) {
//     const overviewUrl = `https://etherscan.io/address/${contractAddr}`;
//     try {
//       const fetchOptions = {
//         headers: {
//           "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)",
//         },
//       };
//       const response = await fetch(overviewUrl, fetchOptions);
//       if (!response.ok) throw new Error(`HTTP ${response.status}`);
//       const html = await response.text(); // Name/Symbol from title or h1

//       if (name === "Unknown" || symbol === "UNK") {
//         const titleMatch = html.match(
//           /<title>([^|]+?)\s*\([^)]+\)\s*\|\s*[^<]*<\/title>/i
//         );
//         if (titleMatch) {
//           const titleText = titleMatch[1].trim();
//           const parenMatch = titleText.match(/^(.*?) \(([A-Z]+)\)$/);
//           if (parenMatch) {
//             name = parenMatch[1].trim();
//             symbol = parenMatch[2];
//           }
//         }
//         if (name === "Unknown") {
//           const h1Match = html.match(/<h1[^>]*>([^<]+?)\s*\([^)]+\)<\/h1>/i);
//           if (h1Match) {
//             const h1Text = h1Match[1].trim();
//             const parenMatch = h1Text.match(/^(.*?) \(([A-Z]+)\)$/);
//             if (parenMatch) {
//               name = parenMatch[1];
//               symbol = parenMatch[2];
//             }
//           }
//         }
//       } // Decimals

//       if (decimals === DEFAULT_DECIMALS) {
//         let decMatch = html.match(/Decimals\s*:\s*(\d{1,2})/i);
//         if (!decMatch)
//           decMatch = html.match(
//             /function\s+decimals\s*\(\)\s*\{[^}]*return\s+(\d+);/i
//           );
//         if (decMatch) {
//           decimals = parseInt(decMatch[1], 10);
//         }
//       }

//       if (totalSupply === "0") {
//         let supplyMatch = html.match(
//           /title\s*=\s*["']([\d,\. \s]+?)(?:\.\d+)?["']/is
//         );
//         if (supplyMatch) {
//           let fullNumber = supplyMatch[1].trim();
//           totalSupply = fullNumber.split(".")[0].replace(/[, \s]/g, "");
//         }
//       }
//     } catch (e) {
//       console.warn(
//         `[WARNING] Etherscan overview scraping failed for ${contractAddr}.`
//       );
//     }
//   }

//   return { name, symbol, decimals, totalSupply };
// }

// export async function analyzeUniswapV4Pool(txHash: string): Promise<void> {
//   let finalData: Partial<PoolCreationData> = { hash: txHash };
//   try {
//     const [receipt, transaction] = await Promise.all([
//       provider.getTransactionReceipt(txHash),
//       provider.getTransaction(txHash),
//     ]);
//     if (!receipt || receipt.status !== 1) {
//       console.log(
//         `Transaction ${
//           receipt?.status === 0 ? "failed" : "not found"
//         }: ${txHash}`
//       );
//       return;
//     }
//     if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
//     const userWallet = transaction.from.toLowerCase();
//     const txTo = transaction.to?.toLowerCase() || "0x";
//     finalData.creatorAddress = userWallet;
//     console.log(`\n--- Checking Uniswap V4 Pool Creation: ${txHash} ---`);
//     console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
//     console.log(`Block: ${receipt.blockNumber} | Creator: ${userWallet}`);
//     console.log(
//       `Transaction Fee: ${ethers.formatEther(
//         receipt.gasUsed * receipt.gasPrice
//       )} ETH`
//     );
//     const initializeIface = new Interface(INITIALIZE_ABI);
//     let firstInit: any = null;
//     for (const log of receipt.logs) {
//       try {
//         const parsed = initializeIface.parseLog(log);
//         if (parsed && parsed.name === "Initialize") {
//           firstInit = {
//             poolId: parsed.args.id,
//             currency0: parsed.args.currency0.toLowerCase(),
//             currency1: parsed.args.currency1.toLowerCase(),
//             fee: Number(parsed.args.fee),
//             tickSpacing: Number(parsed.args.tickSpacing),
//             hooks: parsed.args.hooks.toLowerCase(),
//             sqrtPriceX96: parsed.args.sqrtPriceX96.toString(),
//             tick: Number(parsed.args.tick),
//           };
//           break;
//         }
//       } catch {}
//     }
//     if (!firstInit) {
//       console.log(
//         "No Initialize event found. Falling back to token creation analysis..."
//       );
//       const contractAddr = receipt.contractAddress?.toLowerCase();
//       if (!contractAddr || txTo !== "0x") {
//         console.log(
//           "No contract created in this transaction. Not a token deployment."
//         );
//         return;
//       } // Check for Transfer events emitted by the new contract
//       let hasTransfers = false;
//       let transferCount = 0;
//       for (const log of receipt.logs) {
//         if (
//           log.address.toLowerCase() === contractAddr &&
//           log.topics[0]?.toLowerCase() === TRANSFER_TOPIC_V4.toLowerCase()
//         ) {
//           hasTransfers = true;
//           transferCount++;
//         }
//       }
//       if (!hasTransfers) {
//         console.log(
//           "Contract created but no Transfer events found. Assuming token creation and attempting metadata extraction."
//         );
//       }
//       const tokenData: Partial<TokenCreationData> = {
//         hash: txHash,
//         creatorAddress: userWallet,
//         programId: "N/A (Direct Deploy)",
//         tokenMint: contractAddr,
//       }; // --- METADATA EXTRACTION ---
//       const {
//         name: fetchedName,
//         symbol: fetchedSymbol,
//         decimals: fetchedDecimals,
//         totalSupply: fetchedTotalSupply,
//       } = await extractTokenMetadata(
//         contractAddr,
//         receipt.logs,
//         transaction.data
//       );
//       tokenData.name = fetchedName;
//       tokenData.symbol = fetchedSymbol;
//       tokenData.decimals = fetchedDecimals;
//       tokenData.totalSupply = fetchedTotalSupply;
//       if (hasTransfers) {
//         tokenData.tokenBalanceChanges = `Batch initial distribution via ${transferCount} transfers (see total supply)`;
//       } else {
//         tokenData.tokenBalanceChanges = `Initial distribution could not be determined (0 Transfer events). See Total Supply.`;
//       }
//       console.log(
//         "\n✅ Token Creation Successfully Analyzed (Fallback from V4 Check)"
//       );
//       console.log("-------------------------------------------------------");
//       console.log(`Token Address (Mint): ${tokenData.tokenMint}`);
//       console.log(
//         `Token Name/Symbol:    ${tokenData.name} (${tokenData.symbol})`
//       );
//       console.log(`Decimals:             ${tokenData.decimals}`);
//       console.log(`Total Supply:         ${tokenData.totalSupply}`);
//       console.log(`Initial Mint Amount:  ${tokenData.tokenBalanceChanges}`);
//       console.log(`Contract/Factory ID:  ${tokenData.programId}`);
//       console.log(`Creator Address:      ${tokenData.creatorAddress}`);
//       console.log(`Transaction Hash:     ${tokenData.hash}`);
//       console.log("-------------------------------------------------------");
//       return;
//     }
//     finalData.poolId = firstInit.poolId;
//     finalData.currency0 = firstInit.currency0;
//     finalData.currency1 = firstInit.currency1;
//     finalData.fee = firstInit.fee;
//     finalData.tickSpacing = firstInit.tickSpacing;
//     finalData.hooks = firstInit.hooks;
//     finalData.sqrtPriceX96 = firstInit.sqrtPriceX96;
//     finalData.tick = firstInit.tick;
//     const tokens = [firstInit.currency0, firstInit.currency1];
//     const [token0Data, token1Data] = await Promise.all(
//       tokens.map(async (addr) => extractTokenMetadata(addr))
//     );
//     finalData.token0Name = token0Data.name;
//     finalData.token0Symbol = token0Data.symbol;
//     finalData.token0Decimals = token0Data.decimals;
//     finalData.token1Name = token1Data.name;
//     finalData.token1Symbol = token1Data.symbol;
//     finalData.token1Decimals = token1Data.decimals;
//     finalData.creatorAddress = userWallet;
//     finalData.hash = txHash;

//     console.log("\n✅ Uniswap V4 Pool Creation Analyzed");
//     console.log(`Pool ID: ${finalData.poolId}`);
//     console.log(
//       `Tokens: ${finalData.token0Name} (${finalData.token0Symbol}) / ${finalData.token1Name} (${finalData.token1Symbol})`
//     );
//   } catch (err) {
//     console.error(
//       `[ERROR] Error analyzing transaction ${txHash}: ${(err as Error).message}`
//     );
//   }
// }
