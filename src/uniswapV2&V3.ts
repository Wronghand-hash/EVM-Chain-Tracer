import { ethers, Interface } from "ethers";
import {
  provider,
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  V2_SWAP_EVENT_TOPIC,
  V3_SWAP_EVENT_TOPIC,
  v2SwapIface,
  v3SwapIface,
  TRANSFER_TOPIC,
  transferIface,
  UNKNOWN_TOKEN_INFO,
  V4_SWAP_EVENT_TOPIC,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
  v4SwapIface,
  WETH_ADDRESS,
  V2_SYNC_EVENT_TOPIC,
  v2SyncIface,
} from "./types/constants";
import { Transfer, SwapEvent, TokenInfo, TradeEvent } from "./types/types";
import {
  isV2Pool,
  getTokenInfo,
  getPoolTokens,
  formatAmount,
  fetchEthPriceUsd,
} from "./utils/utils";
// UPDATE: Using the uploaded ABI directly for Universal Router
import * as uniswapUniversalAbi from "./abi/uniswapUniversalAbi.json";
import * as uniswapV4PoolManagerAbi from "./abi/uniswapV4PoolManager.json";

export async function analyzeTransaction(txHash: string): Promise<void> {
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
    const ethUsd = (await fetchEthPriceUsd()) || 0;
    console.log(`\n--- Analyzing Transaction: ${txHash} ---`);
    console.log(
      `Status: Success ✅ | From: ${transaction.from} | To: ${transaction.to}`
    );
    console.log(
      `Block: ${receipt.blockNumber} | Value: ${ethers.formatEther(
        transaction.value
      )} ETH`
    );
    console.log(
      `Fee: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`
    );
    const isUniversalRouter =
      routerAddress === UNISWAP_UNIVERSAL_ROUTER_ADDRESS;
    let commands: string = "";
    let inputs: string[] = [];
    if (isUniversalRouter) {
      const iface = new Interface(uniswapUniversalAbi);
      const parsed = iface.parseTransaction({ data: transaction.data });
      if (parsed?.name === "execute") {
        // Universal Router's `execute` function has two overloads:
        // 1. execute(bytes commands, bytes[] inputs)
        // 2. execute(bytes commands, bytes[] inputs, uint256 deadline)
        // We handle both by accessing the named arguments `commands` and `inputs`.
        commands = parsed.args.commands;
        inputs = parsed.args.inputs;
        console.log(`Universal Router Commands: ${commands}`);
      }
    }
    const transfers: Transfer[] = [];
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolAddresses = new Set<string>();
    const poolReserves: {
      [pool: string]: { reserve0: bigint; reserve1: bigint };
    } = {};
    for (const log of receipt.logs) {
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      tokenAddresses.add(logAddrLower);
      if (
        topic0 === V2_SWAP_EVENT_TOPIC?.toLowerCase() ||
        topic0 === V3_SWAP_EVENT_TOPIC?.toLowerCase()
      ) {
        try {
          const isV2 = await isV2Pool(logAddrLower);
          const iface = isV2 ? v2SwapIface : v3SwapIface;
          const parsed = iface.parseLog(log);
          if (parsed) {
            const protocol = isV2 ? "V2" : "V3";
            const swapEvent: SwapEvent = {
              pool: logAddrLower,
              sender: parsed.args.sender.toLowerCase(),
              recipient:
                parsed.args.recipient?.toLowerCase() ||
                parsed.args.to?.toLowerCase(),
              amount0:
                protocol === "V3"
                  ? parsed.args.amount0
                  : parsed.args.amount0In > 0
                  ? parsed.args.amount0In
                  : -parsed.args.amount0Out,
              amount1:
                protocol === "V3"
                  ? parsed.args.amount1
                  : parsed.args.amount1In > 0
                  ? parsed.args.amount1In
                  : -parsed.args.amount1Out,
              protocol,
              tick: parsed.args.tick,
              sqrtPriceX96: parsed.args.sqrtPriceX96,
              liquidity: parsed.args.liquidity,
            };
            swaps.push(swapEvent);
            poolAddresses.add(logAddrLower);
          }
        } catch (e) {
          console.warn(
            `Failed to parse Swap event for log: ${log.transactionHash}`
          );
        }
      } else if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed) {
            transfers.push({
              token: logAddrLower,
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            });
          }
        } catch {}
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
    const tokenInfos: { [address: string]: TokenInfo } = {};
    const poolTokens: { [pool: string]: { token0: string; token1: string } } =
      {};
    await Promise.all([
      ...Array.from(tokenAddresses).map((t) =>
        getTokenInfo(t).then((info) => (tokenInfos[t] = info))
      ),
      ...Array.from(poolAddresses).map((p) =>
        getPoolTokens(p).then((tokens) => (poolTokens[p] = tokens))
      ),
    ]);
    const tradeEvents: TradeEvent[] = [];
    for (const [index, swap] of swaps.entries()) {
      console.log(
        `\n===== Swap ${index + 1} (${swap.protocol}, Pool: ${swap.pool}) =====`
      );
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${
          swap.tick || "N/A"
        }`
      );
      const { token0, token1 } = poolTokens[swap.pool] || {
        token0: "",
        token1: "",
      };
      if (!token0 || !token1) continue;
      const token0Info = tokenInfos[token0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[token1] || UNKNOWN_TOKEN_INFO;
      let isToken0In: boolean;
      let inputTokenAddress: string;
      let outputTokenAddress: string;
      let inputInfo: TokenInfo;
      let outputInfo: TokenInfo;
      let swapAmountIn: bigint;
      let swapAmountOut: bigint;
      if (swap.protocol === "V3") {
        isToken0In = swap.amount0 > 0n;
        inputTokenAddress = isToken0In ? token0 : token1;
        outputTokenAddress = isToken0In ? token1 : token0;
        inputInfo = isToken0In ? token0Info : token1Info;
        outputInfo = isToken0In ? token1Info : token0Info;
        swapAmountIn = isToken0In ? swap.amount0 : swap.amount1;
        swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0;
      } else {
        isToken0In = swap.amount0 > 0n;
        inputTokenAddress = isToken0In ? token0 : token1;
        outputTokenAddress = isToken0In ? token1 : token0;
        inputInfo = isToken0In ? token0Info : token1Info;
        outputInfo = isToken0In ? token1Info : token0Info;
        swapAmountIn = isToken0In ? swap.amount0 : swap.amount1;
        swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0;
      }
      const finalAmountIn = swapAmountIn;
      const finalAmountOut = swapAmountOut;
      const amountInDecimal = ethers.formatUnits(
        finalAmountIn,
        inputInfo.decimals
      );
      const amountOutDecimal = ethers.formatUnits(
        finalAmountOut,
        outputInfo.decimals
      );

      // Helper for human-readable formatting
      const formatTinyNum = (num: number, isUsd: boolean = false): string => {
        if (num === 0) return isUsd ? "$0.00" : "0";
        if (num >= 0.01) {
          // Standard formatting for values > $0.01 or 0.01
          return isUsd ? `$${num.toFixed(2)}` : num.toFixed(4);
        } else if (num >= 1e-6) {
          // Keep 6 significant figures for values between 1e-6 and 0.01
          return isUsd ? `$${num.toFixed(6)}` : num.toPrecision(6);
        } else {
          // For very tiny numbers, use toPrecision(3) to avoid rounding to zero,
          // which will use scientific notation if necessary (e.g., 1.40e-7)
          return isUsd ? `$${num.toPrecision(3)}` : num.toPrecision(6);
        }
      };

      let spotNum =
        parseFloat(amountInDecimal) / parseFloat(amountOutDecimal) || 0; // Default to effective

      // Spot price calc for V2
      if (swap.protocol === "V2") {
        const reserves = poolReserves[swap.pool];
        if (reserves) {
          let reserveInRaw: bigint, reserveOutRaw: bigint;

          // Determine which reserve corresponds to the input/output token
          if (inputTokenAddress === token0) {
            reserveInRaw = reserves.reserve0;
            reserveOutRaw = reserves.reserve1;
          } else {
            // inputTokenAddress === token1
            reserveInRaw = reserves.reserve1;
            reserveOutRaw = reserves.reserve0;
          }

          // Convert raw BigInt reserves to adjusted floating-point numbers
          // This gives the reserves in the tokens' true, human-readable quantities.
          const reserveInAdjusted = parseFloat(
            ethers.formatUnits(reserveInRaw, inputInfo.decimals)
          );
          const reserveOutAdjusted = parseFloat(
            ethers.formatUnits(reserveOutRaw, outputInfo.decimals)
          );

          // Calculate the spot price of 1 OUTPUT token, expressed in INPUT tokens (P_OUT_in_IN)
          // P = Reserve_INPUT_Adjusted / Reserve_OUTPUT_Adjusted
          // For WETH(In) -> BABYMANYU(Out), this is WETH per BABYMANYU.
          if (reserveOutAdjusted > 0) {
            spotNum = reserveInAdjusted / reserveOutAdjusted;
          } else {
            spotNum = 0;
          }
        } else {
          console.log(
            "Debug: No reserves found for V2 pool, using effective price"
          );
        }
      } else if (swap.protocol === "V3" && swap.sqrtPriceX96) {
        // V3 Price Calculation: P = (1/ (sqrtPriceX96^2 / 2^192)) * 10^(decimals1 - decimals0)
        const sqrtPrice = Number(swap.sqrtPriceX96) / Math.pow(2, 96);
        const priceToken1PerToken0 = sqrtPrice ** 2;
        const decDiff = token1Info.decimals - token0Info.decimals;
        const adjustedPriceToken1PerToken0 =
          priceToken1PerToken0 * Math.pow(10, decDiff);
        let spotPriceOutputInInput: number;

        if (isToken0In) {
          // Price is T1 per T0. If T0 is input, we need T0 per T1, so invert.
          spotPriceOutputInInput = 1 / adjustedPriceToken1PerToken0;
        } else {
          // Price is T1 per T0. If T1 is input, we need T1 per T0, no invert.
          const adjustedPriceToken0PerToken1 =
            (1 / priceToken1PerToken0) * Math.pow(10, -decDiff);
          spotPriceOutputInInput = adjustedPriceToken0PerToken1;
        }
        spotNum = spotPriceOutputInInput;
      }

      // Calculate effective price as a fallback if spotNum is 0 (due to division by zero or no reserves)
      if (spotNum === 0 && parseFloat(amountOutDecimal) > 0) {
        spotNum = parseFloat(amountInDecimal) / parseFloat(amountOutDecimal);
      }

      let spotNativePrice = formatTinyNum(spotNum);

      // --- USD CALCULATION ---
      let totalUsdVolume = 0;
      let usdPerOutputToken = 0;

      const isInputWETH = inputTokenAddress.toLowerCase() === WETH_ADDRESS;
      const isOutputWETH = outputTokenAddress.toLowerCase() === WETH_ADDRESS;

      // 1. Calculate Total USD Volume based on the stable/known token (WETH/ETH)
      if (ethUsd > 0) {
        if (isInputWETH) {
          // Best calculation: Total USD is the value of the WETH input
          totalUsdVolume = parseFloat(amountInDecimal) * ethUsd;
        } else if (isOutputWETH) {
          // Next best calculation: Total USD is the value of the WETH output
          totalUsdVolume = parseFloat(amountOutDecimal) * ethUsd;
        }
      }

      // 2. Calculate USD per Output Token (The REKT price)
      if (totalUsdVolume > 0 && parseFloat(amountOutDecimal) > 0) {
        usdPerOutputToken = totalUsdVolume / parseFloat(amountOutDecimal);
      } else if (isInputWETH && spotNum > 0 && ethUsd > 0) {
        // Final fallback: Use the native spot price and current ETH/USD rate
        // USD per Output Token = (WETH per REKT) * (USD per WETH)
        usdPerOutputToken = spotNum * ethUsd;
        totalUsdVolume = parseFloat(amountOutDecimal) * usdPerOutputToken;
      }

      const totalUsdVolumeFormatted = formatTinyNum(totalUsdVolume, true);
      const usdPerOutputTokenFormatted = formatTinyNum(usdPerOutputToken, true);

      // --- END USD CALCULATION ---

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

      console.log(
        `Spot Price: ${spotNativePrice} ${inputInfo.symbol} per ${outputInfo.symbol} | USD per ${outputInfo.symbol}: ${usdPerOutputTokenFormatted} | Total Volume: ${totalUsdVolumeFormatted}`
      );

      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        // The USD Price field MUST represent the Total USD Volume
        usdPrice: totalUsdVolumeFormatted,
        nativePrice: `${spotNativePrice} ${inputInfo.symbol}/${outputInfo.symbol}`,
        volume: formatAmount(
          finalAmountOut,
          outputInfo.decimals,
          outputInfo.symbol
        ),
        inputVolume: formatAmount(
          finalAmountIn,
          inputInfo.decimals,
          inputInfo.symbol
        ),
        mint: outputTokenAddress,
        type:
          outputInfo.symbol !== "WETH" && outputInfo.symbol !== "USDC"
            ? "BUY"
            : "SELL",
        pairAddress: swap.pool,
        programId: routerAddress,
        quoteToken: inputTokenAddress,
        baseDecimals: outputInfo.decimals,
        quoteDecimals: inputInfo.decimals,
        tradeType: `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
        protocol: swap.protocol,
      });
    }
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
