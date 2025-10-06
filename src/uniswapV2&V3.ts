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
import * as uniswapUniversalAbi from "./abi/uniswapUniversalAbi.json";
import * as uniswapV4PoolManagerAbi from "./abi/uniswapV4PoolManager.json";

// TODO: For full USD Volume/Price accuracy for non-ETH assets (WBTC, cbBTC) Stable token selection required

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

    console.log(`\n--- checking V2/V3/V4 Transaction: ${txHash} ---`);
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

    // --- Universal Router Parsing (Simplified) ---
    if (routerAddress === UNISWAP_UNIVERSAL_ROUTER_ADDRESS) {
      const iface = new Interface(uniswapUniversalAbi);
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
    const v4PoolIds = new Set<string>();
    const poolReserves: {
      [pool: string]: { reserve0: bigint; reserve1: bigint };
    } = {};
    const poolTokens: {
      [pool: string]: { token0: string; token1: string };
    } = {};
    const v4Iface = new Interface(uniswapV4PoolManagerAbi);

    // --- Log Parsing Loop ---
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
          console.warn(`Failed to parse Swap event: ${log.transactionHash}`);
        }
      } else if (topic0 === V4_SWAP_EVENT_TOPIC?.toLowerCase()) {
        try {
          const parsed = v4SwapIface.parseLog(log);
          if (parsed && parsed.args) {
            const poolKey = parsed.args.key;
            // Keccak256 hash of the RLP-encoded PoolKey struct (as bytes) is the pool ID
            const poolKeyBytes = v4Iface.encodeStruct("PoolKey", [poolKey]);
            const poolId = ethers.keccak256(poolKeyBytes);

            const swapEvent: SwapEvent = {
              pool: poolId,
              sender: parsed.args.sender.toLowerCase(),
              recipient: parsed.args.recipient.toLowerCase(),
              amount0: parsed.args.amount0,
              amount1: parsed.args.amount1,
              protocol: "V4",
              tick: Number(parsed.args.tick),
              sqrtPriceX96: 0n,
              liquidity: 0n,
            };
            swaps.push(swapEvent);

            const token0 = poolKey.currency0.toLowerCase();
            const token1 = poolKey.currency1.toLowerCase();
            poolTokens[poolId] = { token0, token1 }; // Save V4 token info here
            poolAddresses.add(poolId);
            v4PoolIds.add(poolId);
            tokenAddresses.add(token0);
            tokenAddresses.add(token1);
          }
        } catch (e) {
          console.warn(`Failed to parse V4 Swap event: ${e}`);
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
        } catch {} // Silent fail for non-ERC20/unknown transfers
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

    // --- Concurrent Data Fetching ---
    const tokenInfos: { [address: string]: TokenInfo } = {};
    const fetchPromises: Promise<any>[] = [];

    // 1. Fetch token info for all token addresses found
    Array.from(tokenAddresses).forEach((t) =>
      fetchPromises.push(getTokenInfo(t).then((info) => (tokenInfos[t] = info)))
    );

    // 2. Fetch token pair for non-V4 pools (V4 tokens were determined during log parsing)
    Array.from(poolAddresses)
      .filter((p) => !v4PoolIds.has(p))
      .forEach((p) =>
        fetchPromises.push(
          getPoolTokens(p).then((tokens) => (poolTokens[p] = tokens))
        )
      );

    await Promise.all(fetchPromises);
    // --- End Concurrent Data Fetching ---

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

      if (swap.protocol === "V3" || swap.protocol === "V4") {
        isToken0In = swap.amount0 > 0n;
      } else {
        // V2 (amount0In > 0)
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

        const decDiff = token1Info.decimals - token0Info.decimals;
        const poolPrice_adjusted =
          rawPrice_token1_per_token0 * Math.pow(10, decDiff);

        // spotNum = input per output
        spotNum = isToken0In ? 1 / poolPrice_adjusted : poolPrice_adjusted;
        if (isNaN(spotNum) || !isFinite(spotNum)) spotNum = 0;
      } else if (swap.protocol === "V4" && typeof swap.tick === "number") {
        // V4 Price Calculation from tick
        const log1p = Math.log(1.0001);
        const exponent = swap.tick * log1p;
        const rawPrice_token1_per_token0 = Math.exp(exponent);

        const decDiff = token1Info.decimals - token0Info.decimals;
        const poolPrice_adjusted =
          rawPrice_token1_per_token0 * Math.pow(10, decDiff);

        // spotNum = input per output
        spotNum = isToken0In ? 1 / poolPrice_adjusted : poolPrice_adjusted;
        if (isNaN(spotNum) || !isFinite(spotNum)) spotNum = 0;
      }
      // --- End Price Calculation ---

      const spotNativePrice = formatTinyNum(spotNum);

      // --- USD CALCULATION ---
      let totalUsdVolume = 0;
      let usdPerOutputToken = 0;

      const isInputWETH = inputTokenAddress.toLowerCase() === WETH_ADDRESS;
      const isOutputWETH = outputTokenAddress.toLowerCase() === WETH_ADDRESS;

      if (ethUsd > 0) {
        if (isInputWETH) {
          // Input is WETH, price output token in USD
          usdPerOutputToken = spotNum * ethUsd;
          totalUsdVolume = amountInDecimal * ethUsd;
        } else if (isOutputWETH) {
          // Output is WETH, price WETH in USD (ethUsd)
          usdPerOutputToken = ethUsd;
          totalUsdVolume = amountOutDecimal * ethUsd;
        } else {
          // Neither is WETH. Total volume approximation warning logged.
          console.log(
            "Warning: USD volume is approximated as WETH/ETH is not in this pair."
          );
        }

        // Secondary Fallback for Price
        if (
          usdPerOutputToken === 0 &&
          totalUsdVolume > 0 &&
          amountOutDecimal > 0
        ) {
          usdPerOutputToken = totalUsdVolume / amountOutDecimal;
        }
      }
      // --- End USD CALCULATION ---

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
      console.log(
        `Spot Price: ${spotNativePrice} ${inputInfo.symbol} per ${
          outputInfo.symbol
        } | USD per ${outputInfo.symbol}: ${usdPerOutputToken.toFixed(
          6
        )} | Total Volume: ${totalUsdVolume.toFixed(6)}`
      );

      // Construct TradeEvent
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPerOutputToken.toFixed(6),
        nativePrice: `${spotNativePrice} ${inputInfo.symbol}/${outputInfo.symbol}`,
        volume: totalUsdVolume.toFixed(6),
        inputVolume: finalAmountIn.toString(),
        mint: outputTokenAddress,
        type:
          outputInfo.symbol !== "WETH" &&
          outputInfo.symbol !== "USDC" &&
          outputInfo.symbol !== "USDT"
            ? "BUY"
            : "SELL", // Logic for BUY/SELL remains the same
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
    // --- End Swap Analysis Loop ---

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
