// import { ethers } from "ethers";
// import {
//   provider,
//   WBNB_ADDRESS,
//   TRANSFER_TOPIC,
// } from "../../types/Bsc/constants";
// import { Transfer, TokenInfo, TradeEvent } from "../../types/Etherium/types";
// import {
//   getTokenInfo,
//   fetchBnbPriceUsd,
//   formatAmount,
//   formatTinyNum,
// } from "../../utils/bsc/utils";

// import * as fourMemeAbi from "../../abi/bsc/Four.MemeAbi.json";

// import TokenInfoModel from "../../models/tokenInfo.schema";

// const FOURMEME_EXCHANGE_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";

// // FIXED: Hardcoded ABI for Four.meme's sellToken (confirmed via selector 0xe63aaf36)
// const FOURMEME_ROUTER_ABI = [
//   "function sellToken(uint256 param1, address param2, address param3, uint256 param4, uint256 param5, uint256 param6, address param7) external",
// ];
// const ROUTER_IFACE = new ethers.utils.Interface(FOURMEME_ROUTER_ABI);

// export async function analyzeFourMemeTransaction(
//   txHash: string
// ): Promise<void> {
//   let externalCallCount = 0; // Counter for RPC/HTTP calls
//   let additionalCalls = 0; // For sub-calls from utils

//   try {
//     // RPC Call 1: getTransactionReceipt
//     externalCallCount++;
//     const receipt = await provider.getTransactionReceipt(txHash);
//     if (!receipt || receipt.status !== 1) {
//       console.log(
//         `Transaction ${
//           receipt?.status === 0 ? "failed" : "not found"
//         }: ${txHash}`
//       );
//       return;
//     }

//     // RPC Call 2: getTransaction
//     externalCallCount++;
//     const transaction = await provider.getTransaction(txHash);
//     if (!transaction) throw new Error(`Transaction not found: ${txHash}`);

//     const userWallet = transaction.from.toLowerCase();

//     // Detect Four.meme tx
//     const proxyAddress = FOURMEME_EXCHANGE_ADDRESS.toLowerCase();
//     const isFourMemeTx =
//       receipt.logs.some(
//         (log: any) => log.address.toLowerCase() === proxyAddress
//       ) || transaction.to?.toLowerCase() === proxyAddress;
//     if (!isFourMemeTx) {
//       console.log(`Not a Four.meme exchange transaction: ${txHash}`);
//       return;
//     }
//     const exchangeAddress = proxyAddress;

//     // Initialize data structures
//     const transfers: Transfer[] = [];
//     const fourMemeIface = new ethers.utils.Interface(fourMemeAbi);

//     // --- Log Parsing Loop (Transfers) ---
//     for (const log of receipt.logs) {
//       if (!log.topics[0]) continue;
//       const topic0 = log.topics[0].toLowerCase();
//       const logAddrLower = log.address.toLowerCase();

//       if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
//         try {
//           const parsed = fourMemeIface.parseLog(log);
//           if (parsed && parsed.name === "Transfer") {
//             const transfer: Transfer = {
//               token: logAddrLower,
//               from: parsed.args.from.toLowerCase(),
//               to: parsed.args.to.toLowerCase(),
//               value: parsed.args.value,
//             };
//             transfers.push(transfer);
//           }
//         } catch (parseErr) {
//           // Intentionally silent failure for log parsing, as ABI might not cover all events
//         }
//       }
//     }

//     // --- Trade Detection ---
//     let tradeTransfer: Transfer | null = null;
//     for (const transfer of transfers) {
//       const isExchangeInvolved =
//         transfer.from === exchangeAddress || transfer.to === exchangeAddress;
//       const isUserInvolved =
//         transfer.from === userWallet || transfer.to === userWallet;

//       if (
//         isExchangeInvolved &&
//         isUserInvolved &&
//         transfer.token !== WBNB_ADDRESS.toLowerCase()
//       ) {
//         tradeTransfer = transfer;
//         break;
//       }
//     }

//     if (!tradeTransfer) {
//       console.log("No trade transfer found between user and exchange.");
//       return;
//     }

//     const tokenAddress = tradeTransfer.token;

//     // --- Concurrent Data Fetching ---
//     const tokenInfos: { [address: string]: TokenInfo } = {};

//     const dbToken = await TokenInfoModel.findOne({
//       address: tokenAddress.toLowerCase(),
//     });
//     if (dbToken) {
//       tokenInfos[tokenAddress] = {
//         decimals: dbToken.decimals,
//         symbol: dbToken.symbol,
//         name: dbToken.name,
//       };
//     } else {
//       const result = await getTokenInfo(tokenAddress); // May contain RPC calls
//       tokenInfos[tokenAddress] = result.info;
//       additionalCalls += result.callsMade;

//       // Save to DB (no external call)
//       await new TokenInfoModel({
//         address: tokenAddress.toLowerCase(),
//         decimals: result.info.decimals,
//         symbol: result.info.symbol,
//         name: result.info.name,
//       }).save();
//     }

//     const tokenInfo = tokenInfos[tokenAddress] || {
//       decimals: 18,
//       symbol: "UNKNOWN",
//       name: "Unknown",
//     };

//     // --- Amount Calculation ---
//     const isBuy = transaction.value > 0n;
//     let inputAmount: bigint;
//     let outputAmount: bigint;
//     let inputSymbol: string;
//     let outputSymbol: string;
//     let inputDecimals: number;
//     let outputDecimals: number;
//     const memeSymbol = tokenInfo.symbol;

//     if (isBuy) {
//       inputAmount = transaction.value;
//       outputAmount = tradeTransfer.value;
//       inputSymbol = "BNB";
//       outputSymbol = tokenInfo.symbol;
//       inputDecimals = 18;
//       outputDecimals = tokenInfo.decimals;
//     } else {
//       inputAmount = tradeTransfer.value;
//       outputAmount = 0n; // Default for sell
//       inputSymbol = tokenInfo.symbol;
//       outputSymbol = "BNB";
//       inputDecimals = tokenInfo.decimals;
//       outputDecimals = 18;

//       // Parse calldata for `amountOutMin` if direct call
//       const isDirectToProxy = transaction.to?.toLowerCase() === exchangeAddress;
//       if (isDirectToProxy) {
//         try {
//           const parsedTx = ROUTER_IFACE.parseTransaction({
//             data: transaction.data,
//           });
//           if (parsedTx && parsedTx.name === "sellToken") {
//             // param5 = amountOutMin
//             outputAmount = parsedTx.args.param5 as bigint;
//           }
//         } catch {
//           // Ignore calldata parse failures
//         }
//       }
//     }

//     const amountInDecimal = parseFloat(
//       ethers.utils.formatUnits(inputAmount, inputDecimals)
//     );
//     const amountOutDecimal = parseFloat(
//       ethers.utils.formatUnits(outputAmount, outputDecimals)
//     );

//     // --- Price Calculation ---
//     let bnbPerToken = 0;
//     if (amountOutDecimal > 0 && amountInDecimal > 0) {
//       const spotNum = amountInDecimal / amountOutDecimal;
//       bnbPerToken = isBuy ? spotNum : 1 / spotNum;
//     }

//     // --- USD CALCULATION ---
//     externalCallCount++;
//     const bnbUsd = (await fetchBnbPriceUsd()) || 0; // HTTP Call

//     const volumeAmount = isBuy ? amountInDecimal : amountOutDecimal;
//     const usdVolume = volumeAmount * bnbUsd;
//     const usdPerBaseToken = bnbPerToken * bnbUsd;
//     const baseSymbol = memeSymbol;

//     // Standardize native price as BNB per base (meme token)
//     const quoteSymbol = "BNB";
//     const nativePriceStr =
//       bnbPerToken > 0
//         ? `${formatTinyNum(bnbPerToken)} ${quoteSymbol} per ${baseSymbol}`
//         : "0 BNB per " + baseSymbol;

//     // Construct TradeEvent
//     const gasPrice = receipt.gasPrice;
//     const tradeEvents: TradeEvent[] = [
//       {
//         event: "Trade",
//         status: "Success ✅",
//         txHash,
//         timestamp: receipt.blockNumber,
//         usdPrice: usdPerBaseToken.toFixed(10),
//         nativePrice: nativePriceStr,
//         volume: usdVolume.toFixed(10),
//         inputVolume: inputAmount.toString(),
//         mint: tokenAddress,
//         type: isBuy ? "BUY" : "SELL",
//         pairAddress: FOURMEME_EXCHANGE_ADDRESS,
//         programId: exchangeAddress,
//         quoteToken: WBNB_ADDRESS,
//         baseDecimals: tokenInfo.decimals,
//         quoteDecimals: 18,
//         tradeType: `${inputSymbol} -> ${outputSymbol}`,
//         walletAddress: userWallet,
//         protocol: "Four.meme",
//       },
//     ];

//     // --- Final Output ---
//     if (tradeEvents.length > 0) {
//       tradeEvents.forEach((event, index) => {
//         console.log(`\n--- Four.meme Trade Summary ${index + 1} ---`);
//         console.log(`TX Hash: ${event.txHash}`);
//         console.log(
//           `Type: ${event.type} | Wallet: ${event.walletAddress} | Block: ${event.timestamp}`
//         );
//         console.log(
//           `Trade: ${event.tradeType} (${event.mint}) | Protocol: ${event.protocol}`
//         );
//         console.log(
//           `Amount In: ${formatAmount(inputAmount, inputDecimals, inputSymbol)}`
//         );
//         console.log(
//           JSON.stringify(
//             event,
//             (key, value) =>
//               typeof value === "bigint" ? value.toString() : value,
//             2
//           )
//         );
//       });
//     } else {
//       console.log("\n⚠️ No TradeEvents constructed: No valid trade found.");
//     }

//     // Final log for external calls
//     const totalCalls = externalCallCount + additionalCalls;
//     console.log(
//       `\nTotal external calls made: ${totalCalls} (RPC: ~${
//         totalCalls - 1
//       }, HTTP: 1)`
//     );
//   } catch (err) {
//     console.error(
//       `Error analyzing transaction ${txHash}: ${(err as Error).message}`
//     );
//   }
// }
