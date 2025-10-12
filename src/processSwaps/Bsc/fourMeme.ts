import { ethers, Interface as EthersInterface } from "ethers";
import {
  provider,
  WBNB_ADDRESS,
  TRANSFER_TOPIC,
} from "../../types/Bsc/constants";
import {
  Transfer,
  TokenInfo,
  TradeEvent,
  SwapEvent,
} from "../../types/Etherium/types";
import {
  getTokenInfo,
  fetchBnbPriceUsd,
  formatAmount,
  formatTinyNum,
} from "../../utils/bsc/utils";

import * as fourMemeAbi from "../../abi/bsc/Four.MemeAbi.json";

import TokenInfoModel from "../../models/tokenInfo.schema";

const FOURMEME_EXCHANGE_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";

// FIXED: Hardcoded ABI for Four.meme's sellToken (confirmed via selector 0xe63aaf36)
const FOURMEME_ROUTER_ABI = [
  "function sellToken(uint256 param1, address param2, address param3, uint256 param4, uint256 param5, uint256 param6, address param7) external",
];
const ROUTER_IFACE = new EthersInterface(FOURMEME_ROUTER_ABI);

export async function analyzeFourMemeTransaction(
  txHash: string
): Promise<void> {
  let externalCallCount = 0; // Counter for RPC/HTTP calls
  let additionalCalls = 0; // For sub-calls from utils

  try {
    // RPC Call 1: getTransactionReceipt
    externalCallCount++;
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      console.log(
        `Transaction ${
          receipt?.status === 0 ? "failed" : "not found"
        }: ${txHash}`
      );
      return;
    }
    console.log(`Transaction receipt fetched via RPC (external call).`);
    console.log(
      `Receipt details: blockNumber=${receipt.blockNumber}, status=${receipt.status}, gasUsed=${receipt.gasUsed}, logs.length=${receipt.logs.length}`
    );
    // RPC Call 2: getTransaction
    externalCallCount++;
    const transaction = await provider.getTransaction(txHash);
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    console.log(`Transaction details fetched via RPC (external call).`);
    console.log(
      `Transaction details: from=${transaction.from}, to=${transaction.to}, value=${transaction.value}, data.length=${transaction.data.length}`
    );

    const userWallet = transaction.from.toLowerCase();
    console.log(
      `User wallet extracted from tx: ${userWallet} (no external call).`
    );

    // FIXED: Detect Four.meme tx by checking logs or direct to proxy (handles routed txs via Binance DEX Router)
    const proxyAddress = FOURMEME_EXCHANGE_ADDRESS.toLowerCase();
    const isFourMemeTx =
      receipt.logs.some((log) => log.address.toLowerCase() === proxyAddress) ||
      transaction.to?.toLowerCase() === proxyAddress;
    if (!isFourMemeTx) {
      console.log(`Not a Four.meme exchange transaction: ${txHash}`);
      return;
    }
    const exchangeAddress = proxyAddress;
    console.log(
      `Four.meme tx confirmed (direct or routed): exchangeAddress=${exchangeAddress} (no external call).`
    );

    console.log(`\n--- checking Four.meme Transaction: ${txHash} ---`);
    console.log(
      `Status: Success ✅ | From: ${transaction.from} | To: ${transaction.to}`
    );
    console.log(
      `Block: ${receipt.blockNumber} | Value: ${ethers.formatEther(
        transaction.value
      )} BNB`
    );
    const gasPrice = receipt.gasPrice;
    console.log(
      `Fee: ${ethers.formatEther(receipt.gasUsed * gasPrice)} BNB | Gas Used: ${
        receipt.gasUsed
      } | Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`
    );
    console.log(`Gas used/price from receipt (no additional external call).`);

    // Initialize data structures
    const transfers: Transfer[] = [];
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const fourMemeIface = new EthersInterface(fourMemeAbi);

    // --- Log Parsing Loop ---
    for (const [logIndex, log] of receipt.logs.entries()) {
      console.log(
        `Processing log ${logIndex}: address=${log.address}, topics.length=${log.topics.length}`
      );
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      tokenAddresses.add(logAddrLower);
      console.log(
        `Log address extracted from log: ${logAddrLower} (no external call).`
      );
      if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = fourMemeIface.parseLog(log);
          if (parsed && parsed.name === "Transfer") {
            const transfer: Transfer = {
              token: logAddrLower,
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            };
            transfers.push(transfer);
            console.log(
              `Transfer parsed from log (no external call): from ${transfer.from} to ${transfer.to}, value ${transfer.value} of token ${transfer.token}.`
            );
            if (
              transfer.from === "0x0000000000000000000000000000000000000000"
            ) {
              console.log(
                `Mint detected: ${ethers.formatUnits(
                  transfer.value,
                  18
                )} of token ${transfer.token} to ${transfer.to}`
              );
            }
          } else {
            console.log(
              `Log ${logIndex} not a Transfer event or parse failed.`
            );
          }
        } catch (parseErr) {
          console.log(
            `Failed to parse log ${logIndex} as Transfer: ${
              (parseErr as Error).message
            }`
          );
        }
      } else {
        console.log(`Log ${logIndex} topic0=${topic0} not TRANSFER_TOPIC.`);
      }
    }
    console.log(
      `Log parsing complete: ${swaps.length} swaps, ${transfers.length} transfers from receipt (no additional external calls).`
    );
    // --- End Log Parsing Loop ---

    // --- Trade Detection ---
    console.log(
      `Trade detection: Scanning ${transfers.length} transfers for user-exchange interaction.`
    );
    let tradeTransfer: Transfer | null = null;
    for (const [transferIndex, transfer] of transfers.entries()) {
      const isExchangeInvolved =
        transfer.from === exchangeAddress || transfer.to === exchangeAddress;
      const isUserInvolved =
        transfer.from === userWallet || transfer.to === userWallet;
      console.log(
        `Transfer ${transferIndex}: token=${transfer.token}, from=${transfer.from}, to=${transfer.to}, isExchange=${isExchangeInvolved}, isUser=${isUserInvolved}`
      );
      if (
        isExchangeInvolved &&
        isUserInvolved &&
        transfer.token !== WBNB_ADDRESS.toLowerCase()
      ) {
        tradeTransfer = transfer;
        console.log(
          `Trade transfer found at index ${transferIndex}: ${JSON.stringify(
            tradeTransfer,
            (key, value) =>
              typeof value === "bigint" ? value.toString() : value
          )}`
        );
        break;
      }
    }

    if (!tradeTransfer) {
      console.log("No trade transfer found between user and exchange.");
      return;
    }

    const tokenAddress = tradeTransfer.token;
    console.log(`Trade token identified: ${tokenAddress} (no external call).`);

    // --- Concurrent Data Fetching ---
    const tokenInfos: { [address: string]: TokenInfo } = {};
    const tokenFetchPromises: Promise<any>[] = [];

    if (!tokenInfos[tokenAddress]) {
      console.log(
        `Fetching token info for ${tokenAddress}: checking DB first.`
      );
      tokenFetchPromises.push(
        (async () => {
          const dbToken = await TokenInfoModel.findOne({
            address: tokenAddress.toLowerCase(),
          });
          if (dbToken) {
            tokenInfos[tokenAddress] = {
              decimals: dbToken.decimals,
              symbol: dbToken.symbol,
              name: dbToken.name,
            };
            console.log(
              `Token info fetched from DB for ${tokenAddress}: decimals ${dbToken.decimals}, symbol ${dbToken.symbol} (no external call).`
            );
          } else {
            console.log(
              `Token not in DB, falling back to RPC for ${tokenAddress}.`
            );
            const result = await getTokenInfo(tokenAddress);
            tokenInfos[tokenAddress] = result.info;
            additionalCalls += result.callsMade;
            await new TokenInfoModel({
              address: tokenAddress.toLowerCase(),
              decimals: result.info.decimals,
              symbol: result.info.symbol,
              name: result.info.name,
            }).save();
            console.log(
              `Token info fetched from RPC for ${tokenAddress} (external call).`
            );
          }
        })()
      );
    } else {
      console.log(`Token info already cached for ${tokenAddress}.`);
    }

    await Promise.all(tokenFetchPromises);
    console.log(`Token info fetched (DB/RPC as needed).`);

    const tokenInfo = tokenInfos[tokenAddress] || {
      decimals: 18,
      symbol: "UNKNOWN",
      name: "Unknown",
    };
    console.log(
      `Token infos for ${tokenAddress}: decimals ${tokenInfo.decimals}, symbol ${tokenInfo.symbol} (from cache/external).`
    );

    // --- Amount Calculation ---
    const isBuy = transaction.value > 0n;
    console.log(
      `Trade type determined: isBuy=${isBuy} (based on tx.value > 0n).`
    );
    let inputAmount: bigint;
    let outputAmount: bigint;
    let inputSymbol = "BNB";
    let outputSymbol = tokenInfo.symbol;
    let inputDecimals = 18;
    let outputDecimals = tokenInfo.decimals;
    let inputAddress = WBNB_ADDRESS;
    let outputAddress = tokenAddress;
    const memeSymbol = tokenInfo.symbol;

    if (isBuy) {
      inputAmount = transaction.value;
      outputAmount = tradeTransfer.value;
      console.log(
        `Buy logic: inputAmount (BNB)=${inputAmount}, outputAmount (token)=${outputAmount}`
      );
      if (
        tradeTransfer.to !== userWallet ||
        tradeTransfer.from !== exchangeAddress
      ) {
        console.log(
          `Unexpected transfer direction for buy: expected from exchange to user, got from=${tradeTransfer.from} to=${tradeTransfer.to}`
        );
        return;
      }
      console.log(
        `Buy detected: BNB in ${inputAmount}, token out ${outputAmount} (from tx.value and transfer).`
      );
    } else {
      inputAmount = tradeTransfer.value;
      console.log(`Sell logic: inputAmount (token)=${inputAmount}`);
      if (
        tradeTransfer.from !== userWallet ||
        tradeTransfer.to !== exchangeAddress
      ) {
        console.log(
          `Unexpected transfer direction for sell: expected from user to exchange, got from=${tradeTransfer.from} to=${tradeTransfer.to}`
        );
        return;
      }
      inputSymbol = tokenInfo.symbol;
      outputSymbol = "BNB";
      inputDecimals = tokenInfo.decimals;
      outputDecimals = 18;
      inputAddress = tokenAddress;
      outputAddress = WBNB_ADDRESS;
      console.log(
        `Sell setup: inputSymbol=${inputSymbol}, outputSymbol=${outputSymbol}, inputDecimals=${inputDecimals}, outputDecimals=${outputDecimals}`
      );

      // FIXED: Parse calldata only for direct calls to proxy (routed sells default to 0)
      outputAmount = 0n;
      const isDirectToProxy = transaction.to?.toLowerCase() === exchangeAddress;
      if (isDirectToProxy) {
        try {
          console.log(
            `Parsing tx calldata for amountOutMin using sellToken signature (no external call).`
          );
          const parsedTx = ROUTER_IFACE.parseTransaction({
            data: transaction.data,
          });
          if (parsedTx && parsedTx.name === "sellToken") {
            // From analysis: param4 = amountIn (matches transfer.value), param5 = amountOutMin
            const calldataAmountIn = parsedTx.args.param4 as bigint;
            const amountOutMin = parsedTx.args.param5 as bigint;
            if (calldataAmountIn !== inputAmount) {
              console.warn(
                `Calldata amountIn (${calldataAmountIn}) does not match transfer (${inputAmount}); using transfer.`
              );
            }
            outputAmount = amountOutMin;
            console.log(
              `Calldata parsed: method=sellToken, amountIn (param4)=${calldataAmountIn}, amountOutMin (param5)=${amountOutMin}`
            );
            console.log(
              `Sell detected: token in ${inputAmount}, approx BNB out ${outputAmount} (from calldata amountOutMin). Note: Actual may be slightly higher due to slippage.`
            );
          } else {
            console.warn(`Failed to parse calldata as sellToken; using 0.`);
          }
        } catch (parseErr) {
          console.warn(
            `Calldata parse failed: ${
              (parseErr as Error).message
            }. Using 0 for output.`
          );
          outputAmount = 0n;
        }
      } else {
        console.log(
          `Routed sell tx detected; skipping calldata parse, using 0 for outputAmount (no external call).`
        );
      }
    }

    const amountInDecimal = parseFloat(
      ethers.formatUnits(inputAmount, inputDecimals)
    );
    const amountOutDecimal = parseFloat(
      ethers.formatUnits(outputAmount, outputDecimals)
    );
    console.log(
      `Decimal-formatted amounts: in ${amountInDecimal} ${inputSymbol}, out ${amountOutDecimal} ${outputSymbol} (using decimals).`
    );

    // --- Price Calculation ---
    let spotNum = 0;
    let bnbPerToken = 0;
    console.log(
      `Price calc inputs: amountInDecimal=${amountInDecimal}, amountOutDecimal=${amountOutDecimal}, isBuy=${isBuy}`
    );
    if (amountOutDecimal > 0) {
      spotNum = amountInDecimal / amountOutDecimal;
      bnbPerToken = isBuy ? spotNum : 1 / spotNum;
      console.log(
        `Price calc successful: spotNum (input/output)=${spotNum}, bnbPerToken=${bnbPerToken}`
      );
    } else {
      console.warn(
        `Unable to calculate price: output amount is 0. Setting price to 0.`
      );
      spotNum = 0;
      bnbPerToken = 0;
    }
    console.log(
      `Spot price calculated from amounts: ${spotNum} ${inputSymbol} per ${outputSymbol} (no external call).`
    );

    // --- USD CALCULATION ---
    console.log(`Starting USD calc.`);
    externalCallCount++;
    const bnbUsd = (await fetchBnbPriceUsd()) || 0;
    console.log(`BNB USD price fetched via HTTP (external call).`);

    const usdVolume = isBuy
      ? amountInDecimal * bnbUsd
      : amountOutDecimal * bnbUsd;
    const usdPerBaseToken = bnbPerToken * bnbUsd;
    const baseSymbol = memeSymbol;
    console.log(
      `USD volume: ${usdVolume} (${
        isBuy ? amountInDecimal : amountOutDecimal
      } * ${bnbUsd}), USD per ${baseSymbol}: ${usdPerBaseToken} (bnbPerToken ${bnbPerToken} * bnbUsd ${bnbUsd}) (using BNB price ${bnbUsd}, spot ${spotNum}).`
    );

    // Standardize native price as BNB per base (meme token)
    const quoteSymbol = "BNB";
    const nativePriceStr =
      bnbPerToken > 0
        ? `${formatTinyNum(bnbPerToken)} ${quoteSymbol} per ${baseSymbol}`
        : "0 BNB per " + baseSymbol;
    console.log(`Native price: ${nativePriceStr} (no external call).`);

    console.log(`\n--- Formatted Trade ---`);
    console.log(`Pair: ${inputSymbol}/${outputSymbol}`);
    console.log(
      `Input: ${formatAmount(inputAmount, inputDecimals, inputSymbol)}`
    );
    console.log(
      `Output: ${formatAmount(outputAmount, outputDecimals, outputSymbol)}`
    );
    console.log(
      `Spot Price: ${nativePriceStr} | USD per ${baseSymbol}: ${usdPerBaseToken.toFixed(
        6
      )} | Total Volume: ${usdVolume.toFixed(6)}`
    );

    // Construct TradeEvent
    const tradeEvents: TradeEvent[] = [
      {
        event: "Trade",
        status: "Success ✅",
        txHash,
        timestamp: receipt.blockNumber,
        usdPrice: usdPerBaseToken.toFixed(10),
        nativePrice: nativePriceStr,
        volume: usdVolume.toFixed(10),
        inputVolume: inputAmount.toString(),
        mint: tokenAddress,
        type: isBuy ? "BUY" : "SELL",
        pairAddress: FOURMEME_EXCHANGE_ADDRESS,
        programId: exchangeAddress,
        quoteToken: WBNB_ADDRESS,
        baseDecimals: tokenInfo.decimals,
        quoteDecimals: 18,
        tradeType: `${inputSymbol} -> ${outputSymbol}`,
        walletAddress: userWallet,
        protocol: "Four.meme",
      },
    ];
    console.log(`TradeEvent constructed from parsed data (no external call).`);
    console.log(
      `TradeEvent details: type=${tradeEvents[0].type}, volume=${tradeEvents[0].volume}, usdPrice=${tradeEvents[0].usdPrice}`
    );

    // --- Final Output ---
    if (tradeEvents.length > 0) {
      tradeEvents.forEach((event, index) => {
        console.log(
          `\n${"=".repeat(30)}\nFINAL TRADE EVENT ${index + 1}\n${"=".repeat(
            30
          )}`
        );
        console.log(
          JSON.stringify(
            event,
            (key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            2
          )
        );
      });
      console.log(
        `Trade events compiled from internal calculations (no external calls).`
      );
    } else {
      console.log("\n⚠️ No TradeEvents constructed: No valid trade found.");
    }
    // Final log for external calls
    const totalCalls = externalCallCount + additionalCalls;
    console.log(
      `\nTotal external calls made: ${totalCalls} (RPC: ~${
        totalCalls - 1
      }, HTTP: 1)`
    );
    console.log(
      `Debug summary: isBuy=${isBuy}, token=${tokenAddress} (${memeSymbol}), input=${amountInDecimal} ${inputSymbol}, output=${amountOutDecimal} ${outputSymbol}, spot=${spotNum}, bnbUsd=${bnbUsd}`
    );
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
    console.error(`Full error stack: ${err}`);
  }
}
