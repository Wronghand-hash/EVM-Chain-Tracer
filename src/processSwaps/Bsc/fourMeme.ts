import { ethers, Interface as EthersInterface } from "ethers";
import {
  provider,
  WBNB_ADDRESS,
  TRANSFER_TOPIC,
} from "../../types/Bsc/constants";
import { Transfer, TokenInfo, TradeEvent } from "../../types/Etherium/types";
import {
  getTokenInfo,
  fetchBnbPriceUsd,
  formatAmount,
  formatTinyNum,
} from "../../utils/bsc/utils";

import * as fourMemeAbi from "../../abi/bsc/Four.MemeAbi.json";

import TokenInfoModel from "../../models/tokenInfo.schema";

const FOURMEME_EXCHANGE_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";

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
    // RPC Call 2: getTransaction
    externalCallCount++;
    const transaction = await provider.getTransaction(txHash);
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    console.log(`Transaction details fetched via RPC (external call).`);

    const userWallet = transaction.from.toLowerCase();
    console.log(
      `User wallet extracted from tx: ${userWallet} (no external call).`
    );
    const exchangeAddress = transaction.to?.toLowerCase() || "0x";
    console.log(
      `Exchange address extracted from tx: ${exchangeAddress} (no external call).`
    );

    if (exchangeAddress !== FOURMEME_EXCHANGE_ADDRESS) {
      console.log(`Not a Four.meme exchange transaction: ${txHash}`);
      return;
    }

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
    const tokenAddresses = new Set<string>();
    const fourMemeIface = new EthersInterface(fourMemeAbi);

    // --- Log Parsing Loop ---
    for (const log of receipt.logs) {
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
          }
        } catch {} // Silent fail for non-matching transfers
      }
    }
    console.log(
      `Log parsing complete: ${transfers.length} transfers from receipt (no additional external calls).`
    );
    // --- End Log Parsing Loop ---

    // --- Trade Detection ---
    let tradeTransfer: Transfer | null = null;
    // Look for transfer involving the exchange and user
    for (const transfer of transfers) {
      const isExchangeInvolved =
        transfer.from === exchangeAddress || transfer.to === exchangeAddress;
      const isUserInvolved =
        transfer.from === userWallet || transfer.to === userWallet;
      if (
        isExchangeInvolved &&
        isUserInvolved &&
        transfer.token !== WBNB_ADDRESS
      ) {
        tradeTransfer = transfer;
        break; // Assume single main trade transfer
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

    // Fetch token info with DB fallback
    if (!tokenInfos[tokenAddress]) {
      tokenFetchPromises.push(
        (async () => {
          // Try DB first
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
            // Fallback to RPC
            const result = await getTokenInfo(tokenAddress);
            tokenInfos[tokenAddress] = result.info;
            additionalCalls += result.callsMade;
            console.log(
              `Token info fetched from RPC for ${tokenAddress} (external call).`
            );
          }
        })()
      );
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
    let isBuy = transaction.value > 0n;
    let inputAmount: bigint;
    let outputAmount: bigint;
    let inputSymbol = "BNB";
    let outputSymbol = tokenInfo.symbol;
    let inputDecimals = 18;
    let outputDecimals = tokenInfo.decimals;
    let inputAddress = WBNB_ADDRESS;
    let outputAddress = tokenAddress;

    if (isBuy) {
      // Buy: BNB in (from tx.value), token out (transfer to user from exchange)
      inputAmount = transaction.value;
      outputAmount = tradeTransfer.value;
      if (
        tradeTransfer.to !== userWallet ||
        tradeTransfer.from !== exchangeAddress
      ) {
        console.log("Unexpected transfer direction for buy.");
        return;
      }
      console.log(
        `Buy detected: BNB in ${inputAmount}, token out ${outputAmount} (from tx.value and transfer).`
      );
    } else {
      // Sell: token in (transfer from user to exchange), BNB out (via balance diff)
      inputAmount = tradeTransfer.value;
      if (
        tradeTransfer.from !== userWallet ||
        tradeTransfer.to !== exchangeAddress
      ) {
        console.log("Unexpected transfer direction for sell.");
        return;
      }
      inputSymbol = tokenInfo.symbol;
      outputSymbol = "BNB";
      inputDecimals = tokenInfo.decimals;
      outputDecimals = 18;
      inputAddress = tokenAddress;
      outputAddress = WBNB_ADDRESS;

      // Calculate BNB out using balance changes
      externalCallCount += 2; // Two getBalance calls
      const blockNum = receipt.blockNumber!;
      const effectiveGasPrice = receipt.gasPrice;
      const gasFee = receipt.gasUsed * effectiveGasPrice;
      const balanceBefore = await provider.getBalance(userWallet, blockNum - 1);
      const balanceAfter = await provider.getBalance(userWallet, blockNum);
      outputAmount = balanceAfter - balanceBefore + gasFee;
      console.log(
        `Sell detected: token in ${inputAmount}, BNB out ${outputAmount} (from balance diff and gas fee).`
      );
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
    let spotNum = amountOutDecimal > 0 ? amountInDecimal / amountOutDecimal : 0; // input per output
    console.log(
      `Spot price calculated from amounts: ${spotNum} ${inputSymbol} per ${outputSymbol} (no external call).`
    );

    // --- USD CALCULATION ---
    externalCallCount++;
    const bnbUsd = (await fetchBnbPriceUsd()) || 0;
    console.log(`BNB USD price fetched via HTTP (external call).`);

    const usdVolume = isBuy
      ? amountInDecimal * bnbUsd
      : amountOutDecimal * bnbUsd; // Volume in USD
    let usdPerBaseToken = 0;
    let baseSymbol = outputSymbol; // Base is the meme token
    if (isBuy) {
      // Buy: BNB in, token out -> price = BNB / token * bnbUsd
      usdPerBaseToken = spotNum * bnbUsd;
    } else {
      // Sell: token in, BNB out -> price = BNB / token * bnbUsd
      usdPerBaseToken = spotNum * bnbUsd;
    }
    console.log(
      `USD volume: ${usdVolume}, USD per ${baseSymbol}: ${usdPerBaseToken} (using BNB price ${bnbUsd}, spot ${spotNum}).`
    );
    // --- End USD CALCULATION ---

    // Standardize native price as BNB per base (meme token)
    const nativePriceNum = 1 / spotNum; // BNB per token if spot is token per BNB, wait no:
    // spotNum = input / output
    // For buy: input BNB / output token -> spotNum = BNB per token
    // For sell: input token / output BNB -> spotNum = token per BNB -> BNB per token = 1 / spotNum
    const bnbPerToken = isBuy ? spotNum : 1 / spotNum;
    const quoteSymbol = "BNB";
    console.log(
      `Native price: ${formatTinyNum(
        bnbPerToken
      )} ${quoteSymbol} per ${baseSymbol} (no external call).`
    );

    console.log(`\n--- Formatted Trade ---`);
    console.log(`Pair: ${inputSymbol}/${outputSymbol}`);
    console.log(
      `Input: ${formatAmount(inputAmount, inputDecimals, inputSymbol)}`
    );
    console.log(
      `Output: ${formatAmount(outputAmount, outputDecimals, outputSymbol)}`
    );
    console.log(
      `Spot Price: ${formatTinyNum(
        bnbPerToken
      )} ${quoteSymbol} per ${baseSymbol} | USD per ${baseSymbol}: ${usdPerBaseToken.toFixed(
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
        nativePrice: `${formatTinyNum(
          bnbPerToken
        )} ${quoteSymbol} per ${baseSymbol}`,
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
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
