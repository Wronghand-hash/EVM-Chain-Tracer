// filename: uniswapV2&V3Bsc.ts
import { ethers, Interface as EthersInterface } from "ethers";
import { WBNB_ADDRESS } from "../../types/Bsc/constants";
import {
  provider,
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  TRANSFER_TOPIC,
  transferIface,
  V2_SWAP_EVENT_TOPIC,
  v2SwapIface,
  V3_SWAP_EVENT_TOPIC,
  v3SwapIface,
  V2_SYNC_EVENT_TOPIC,
  v2SyncIface,
  UNKNOWN_TOKEN_INFO,
} from "../../types/Bsc/constants";
import {
  fetchBnbPriceUsd,
  getTokenInfo,
  getPoolTokens,
  formatAmount,
} from "../../utils/utils";
import {
  SwapEvent,
  TokenInfo,
  TradeEvent,
  Transfer,
} from "../../types/Etherium/types";
import * as uniswapUniversalAbi from "../../abi/bsc/universalUniswapAbi.json";

// TODO: For full USD Volume/Price accuracy for non-BNB assets (BUSD, etc.) Stable token selection required

export async function analyzeBscTransaction(txHash: string): Promise<void> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      console.log(
        `Transaction ${
          receipt?.status === 0 ? "failed" : "not found"
        }: ${txHash}`
      );
      return;
    }
    const transaction = await provider.getTransaction(txHash);
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    const block = await provider.getBlock(receipt.blockNumber);
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);
    const userWallet = transaction.from.toLowerCase();
    const routerAddress = transaction.to?.toLowerCase() || "0x";

    const bnbUsd = (await fetchBnbPriceUsd()) || 0;

    console.log(`\n--- checking V2/V3 Transaction: ${txHash} ---`);
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
    // --- Universal Router Parsing (Simplified) ---
    if (routerAddress === UNISWAP_UNIVERSAL_ROUTER_ADDRESS) {
      const iface = new EthersInterface(uniswapUniversalAbi);
      const parsed = iface.parseTransaction({ data: transaction.data });
      if (parsed?.name === "execute") {
        const commands: string = parsed.args.commands;
        const inputs: string[] = parsed.args.inputs;
        console.log(`Universal Router Commands: ${commands}`);
        // `inputs` are available but not currently used in this script
      }
    }
    // --- End Universal Router Parsing ---

    // Initialize all data structures
    const swaps: SwapEvent[] = [];
    const transfers: Transfer[] = []; // Transfers are collected but not used in the final trade logic
    const tokenAddresses = new Set<string>();
    const poolAddresses = new Set<string>();
    const poolReserves: {
      [pool: string]: { reserve0: bigint; reserve1: bigint };
    } = {};
    const poolTokens: {
      [pool: string]: { token0: string; token1: string };
    } = {};

    // --- Log Parsing Loop ---
    for (const log of receipt.logs) {
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      tokenAddresses.add(logAddrLower);

      // Early detection for token mints (Transfers from 0x0)
      if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed) {
            const transfer: Transfer = {
              token: logAddrLower,
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            };
            transfers.push(transfer);

            // Flag mints (from zero address)
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
        } catch {} // Silent fail for non-ERC20/unknown transfers
      }

      if (topic0 === V2_SWAP_EVENT_TOPIC?.toLowerCase()) {
        try {
          const parsed = v2SwapIface.parseLog(log);
          if (parsed) {
            const swapEvent: SwapEvent = {
              pool: logAddrLower,
              sender: parsed.args.sender.toLowerCase(),
              recipient: parsed.args.to.toLowerCase(),
              amount0:
                parsed.args.amount0In > 0n
                  ? parsed.args.amount0In
                  : -parsed.args.amount0Out,
              amount1:
                parsed.args.amount1In > 0n
                  ? parsed.args.amount1In
                  : -parsed.args.amount1Out,
              protocol: "V2",
              sqrtPriceX96: 0n,
              liquidity: 0n,
            };
            swaps.push(swapEvent);
            poolAddresses.add(logAddrLower);
          }
        } catch (e) {
          console.warn(`Failed to parse V2 Swap event: ${log.transactionHash}`);
        }
      } else if (topic0 === V3_SWAP_EVENT_TOPIC?.toLowerCase()) {
        try {
          const parsed = v3SwapIface.parseLog(log);
          if (parsed) {
            const swapEvent: SwapEvent = {
              pool: logAddrLower,
              sender: parsed.args.sender.toLowerCase(),
              recipient: parsed.args.recipient.toLowerCase(),
              amount0: parsed.args.amount0,
              amount1: parsed.args.amount1,
              protocol: "V3",
              tick: parsed.args.tick,
              sqrtPriceX96: parsed.args.sqrtPriceX96,
              liquidity: parsed.args.liquidity,
            };
            swaps.push(swapEvent);
            poolAddresses.add(logAddrLower);
          }
        } catch (e) {
          console.warn(`Failed to parse V3 Swap event: ${log.transactionHash}`);
        }
      } else if (topic0 === V2_SYNC_EVENT_TOPIC?.toLowerCase()) {
        try {
          const parsed = v2SyncIface.parseLog(log);
          if (parsed) {
            poolReserves[logAddrLower] = {
              reserve0: parsed.args.reserve0,
              reserve1: parsed.args.reserve1,
            };
            poolAddresses.add(logAddrLower);
            console.log(
              `Sync reserves for ${logAddrLower}: reserve0=${poolReserves[logAddrLower].reserve0}, reserve1=${poolReserves[logAddrLower].reserve1}`
            );
          }
        } catch (e) {
          console.warn(`Failed to parse Sync event: ${e}`);
        }
      }
    }
    // --- End Log Parsing Loop ---

    // --- Mint Filtering (post-parsing for target token checks later) ---
    const mints: Transfer[] = transfers.filter(
      (t) => t.from === "0x0000000000000000000000000000000000000000"
    );

    // --- Concurrent Data Fetching ---
    const tokenInfos: { [address: string]: TokenInfo } = {};
    const fetchPromises: Promise<any>[] = [];

    // 1. Fetch token info for all token addresses found
    Array.from(tokenAddresses).forEach((t) =>
      fetchPromises.push(
        getTokenInfo(t).then((info: any) => (tokenInfos[t] = info))
      )
    );

    // 2. Fetch token pair for pools
    Array.from(poolAddresses).forEach((p) =>
      fetchPromises.push(
        getPoolTokens(p).then((tokens: any) => (poolTokens[p] = tokens))
      )
    );

    await Promise.all(fetchPromises);
    // --- End Concurrent Data Fetching ---

    // --- Debug: Log all mints (after tokenInfos is populated) ---
    if (mints.length > 0) {
      console.log(
        `All mints in tx: ${mints
          .map(
            (m) =>
              `${ethers.formatUnits(
                m.value,
                tokenInfos[m.token]?.decimals || 18
              )} of ${tokenInfos[m.token]?.symbol || m.token} to ${m.to}`
          )
          .join(", ")}`
      );
    }
    // --- End Debug ---

    const tradeEvents: TradeEvent[] = [];

    // Helper for human-readable formatting (moved outside the loop to be defined once)
    const formatTinyNum = (num: number, isUsd: boolean = false): string => {
      if (num === 0) return isUsd ? "$0.00" : "0";
      if (num >= 0.01) {
        return isUsd ? `$${num.toFixed(2)}` : num.toFixed(4);
      } else if (num >= 1e-6) {
        return isUsd ? `$${num.toFixed(6)}` : num.toPrecision(6);
      } else {
        return isUsd ? `$${num.toPrecision(3)}` : num.toPrecision(6);
      }
    };

    // --- Swap Analysis Loop ---
    for (const [index, swap] of swaps.entries()) {
      const poolTokensInfo = poolTokens[swap.pool];
      if (!poolTokensInfo) continue;

      const { token0: token0Addr, token1: token1Addr } = poolTokensInfo;
      const token0Info = tokenInfos[token0Addr] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[token1Addr] || UNKNOWN_TOKEN_INFO;

      let isToken0In: boolean;

      if (swap.protocol === "V3") {
        isToken0In = swap.amount0 > 0n;
      } else {
        // V2
        isToken0In = swap.amount0 > 0n;
      }

      // Consolidate token assignment logic
      const inputTokenAddress = isToken0In ? token0Addr : token1Addr;
      const outputTokenAddress = isToken0In ? token1Addr : token0Addr;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;

      const swapAmountIn = isToken0In ? swap.amount0 : swap.amount1;
      const swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0;

      const finalAmountIn = swapAmountIn;
      const finalAmountOut = swapAmountOut;

      const amountInDecimal = parseFloat(
        ethers.formatUnits(finalAmountIn, inputInfo.decimals)
      );
      const amountOutDecimal = parseFloat(
        ethers.formatUnits(finalAmountOut, outputInfo.decimals)
      );

      // --- Price Calculation ---
      let spotNum =
        amountOutDecimal > 0 ? amountInDecimal / amountOutDecimal : 0;

      if (swap.protocol === "V2") {
        const reserves = poolReserves[swap.pool];
        if (reserves) {
          const reserveInRaw = isToken0In
            ? reserves.reserve0
            : reserves.reserve1;
          const reserveOutRaw = isToken0In
            ? reserves.reserve1
            : reserves.reserve0;

          if (reserveOutRaw > 0n) {
            const decDiff = outputInfo.decimals - inputInfo.decimals;
            const adjustment = Math.pow(10, decDiff);
            spotNum =
              (Number(reserveInRaw) / Number(reserveOutRaw)) * adjustment;
            if (isNaN(spotNum) || !isFinite(spotNum)) spotNum = 0;
          }
        }
      } else if (swap.protocol === "V3" && swap.sqrtPriceX96) {
        // V3 Price Calculation
        const Q96 = 2 ** 96;
        const sqrtPrice = Number(swap.sqrtPriceX96) / Q96;
        const rawPrice_token1_per_token0 = sqrtPrice ** 2;

        const decDiff = token0Info.decimals - token1Info.decimals;
        const poolPrice_adjusted =
          rawPrice_token1_per_token0 * Math.pow(10, decDiff);

        // spotNum = input per output
        spotNum = isToken0In ? 1 / poolPrice_adjusted : poolPrice_adjusted;
        if (isNaN(spotNum) || !isFinite(spotNum)) spotNum = 0;
      }
      // --- End Price Calculation ---

      // --- USD CALCULATION (Standardized to base token pricing) ---
      let totalUsdVolume = 0;
      let usdPerBaseToken = 0;
      let spotNumWbnbPerBase = 0;
      let baseSymbol = "";
      let baseTokenAddress = "";
      let baseInfo: TokenInfo = UNKNOWN_TOKEN_INFO;
      let isBuy = false;
      let amountBaseDecimal = 0;

      const isInputWBNB = inputTokenAddress.toLowerCase() === WBNB_ADDRESS;
      const isOutputWBNB = outputTokenAddress.toLowerCase() === WBNB_ADDRESS;
      const isWbnbInvolved = isInputWBNB || isOutputWBNB;

      if (isWbnbInvolved && bnbUsd > 0 && spotNum > 0) {
        if (isInputWBNB) {
          // BUY: WBNB in, base out
          baseTokenAddress = outputTokenAddress;
          baseInfo = outputInfo;
          amountBaseDecimal = amountOutDecimal;
          isBuy = true;
          spotNumWbnbPerBase = spotNum; // Already WBNB per base
        } else {
          // SELL: base in, WBNB out
          baseTokenAddress = inputTokenAddress;
          baseInfo = inputInfo;
          amountBaseDecimal = amountInDecimal;
          isBuy = false;
          spotNumWbnbPerBase = 1 / spotNum; // Invert base per WBNB to WBNB per base
        }
        usdPerBaseToken = spotNumWbnbPerBase * bnbUsd;
        totalUsdVolume = amountBaseDecimal * usdPerBaseToken;
        baseSymbol = baseInfo.symbol;
      } else if (!isWbnbInvolved) {
        // Neither is WBNB. Total volume approximation warning logged.
        console.log(
          "Warning: USD volume is approximated as WBNB/BNB is not in this pair."
        );
        // Fallback: use effective price if possible, but for now set to 0
      }

      // Secondary Fallback for Price (if needed, e.g., spotNum invalid)
      if (
        usdPerBaseToken === 0 &&
        totalUsdVolume > 0 &&
        amountBaseDecimal > 0
      ) {
        usdPerBaseToken = totalUsdVolume / amountBaseDecimal;
      }
      // --- End USD CALCULATION ---

      // --- Target Token Mint Detection ---
      let targetTokenMintAmount: bigint | null = null;
      const targetMints = mints.filter(
        (m) => m.token.toLowerCase() === baseTokenAddress.toLowerCase()
      );
      if (targetMints.length > 0) {
        // Sum mints for target token if multiple
        targetTokenMintAmount = targetMints.reduce(
          (acc, m) => acc + m.value,
          0n
        );
        console.log(
          `Target token (${baseSymbol}) mint detected: ${ethers.formatUnits(
            baseInfo.decimals
          )} tokens`
        );
      }
      // --- End Target Token Mint Detection ---

      console.log(
        `\n===== Swap ${index + 1} (${swap.protocol}, Pool: ${swap.pool}) =====`
      );
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${
          swap.tick || "N/A"
        }`
      );
      console.log(`\n--- Formatted Swap ${index + 1} ---`);
      console.log(`Pair: ${inputInfo.symbol}/${outputInfo.symbol}`);
      console.log(
        `Input: ${formatAmount(
          finalAmountIn,
          inputInfo.decimals,
          inputInfo.symbol
        )}`
      );
      console.log(
        `Output: ${formatAmount(
          finalAmountOut,
          outputInfo.decimals,
          outputInfo.symbol
        )}`
      );
      if (isWbnbInvolved) {
        console.log(
          `Spot Price: ${formatTinyNum(
            spotNumWbnbPerBase
          )} WBNB per ${baseSymbol} | USD per ${baseSymbol}: ${usdPerBaseToken.toFixed(
            6
          )} | Total Volume: ${totalUsdVolume.toFixed(6)}`
        );
      } else {
        console.log(
          `Spot Price: ${formatTinyNum(spotNum)} ${inputInfo.symbol} per ${
            outputInfo.symbol
          } | USD per ${outputInfo.symbol}: ${usdPerBaseToken.toFixed(
            6
          )} | Total Volume: ${totalUsdVolume.toFixed(6)}`
        );
      }
      // Construct TradeEvent
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPerBaseToken.toFixed(10),
        nativePrice: isWbnbInvolved
          ? `${formatTinyNum(spotNumWbnbPerBase)} WBNB/${baseSymbol}`
          : `${formatTinyNum(spotNum)} ${inputInfo.symbol}/${
              outputInfo.symbol
            }`,
        volume: totalUsdVolume.toFixed(10),
        inputVolume: finalAmountIn.toString(),
        mint: isWbnbInvolved ? baseTokenAddress : outputTokenAddress,
        targetTokenMint: targetTokenMintAmount
          ? targetTokenMintAmount.toString()
          : "",
        type: isWbnbInvolved
          ? isBuy
            ? "BUY"
            : "SELL"
          : outputInfo.symbol !== "WBNB" &&
            outputInfo.symbol !== "USDC" &&
            outputInfo.symbol !== "USDT"
          ? "BUY"
          : "SELL",
        pairAddress: swap.pool,
        programId: routerAddress,
        quoteToken: isWbnbInvolved ? WBNB_ADDRESS : inputTokenAddress,
        baseDecimals: isWbnbInvolved ? baseInfo.decimals : outputInfo.decimals,
        quoteDecimals: isWbnbInvolved ? 18 : inputInfo.decimals,
        tradeType: isWbnbInvolved
          ? isBuy
            ? `WBNB -> ${baseSymbol}`
            : `${baseSymbol} -> WBNB`
          : `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
        protocol: swap.protocol,
      });
    }
    // --- End Swap Analysis Loop ---

    // Net BNB Inflow Calculation (bulletproof)
    console.log("Calculating net BNB flow...");
    let netBnbInflow = 0n;
    let netInflowMsg = "N/A (skipped - use archive RPC for old blocks)";
    try {
      const blockNum = BigInt(receipt.blockNumber);
      // Double-check chain before query
      const network = await provider.getNetwork();
      if (network.chainId !== 56n) {
        throw new Error(
          `Wrong chain! Expected BSC (56), got ${network.chainId}`
        );
      }
      const preBalance = await provider.getBalance(userWallet, blockNum - 1n);
      const postBalance = await provider.getBalance(userWallet, blockNum);
      const balanceChange = postBalance - preBalance;
      const gasCost = receipt.gasUsed * gasPrice;
      netBnbInflow = balanceChange + gasCost;
      const inflowBnb = ethers.formatEther(netBnbInflow);
      const inflowUsd = (Number(inflowBnb) * bnbUsd).toFixed(2);
      netInflowMsg =
        netBnbInflow > 0n
          ? `${inflowBnb} BNB inflow (~$${inflowUsd}) ✅`
          : `${inflowBnb} BNB (outflow)`;
    } catch (error: any) {
      console.warn(
        `Net flow skipped (${
          error.message?.includes("trie")
            ? "old block state unavailable"
            : error.message
        }): ${netInflowMsg}`
      );
    }
    console.log(`Net BNB Flow: ${netInflowMsg}`);

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
    } else {
      console.log(
        "\n⚠️ No TradeEvents constructed: No valid swaps or transfers found."
      );
    }
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
