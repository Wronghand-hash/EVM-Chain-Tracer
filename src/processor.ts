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
} from "./types/constants";
import { Transfer, SwapEvent, TokenInfo, TradeEvent } from "./types/types";
import {
  isV2Pool,
  getTokenInfo,
  getPoolTokens,
  formatAmount,
} from "./utils/utils";
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
        commands = parsed.args.commands;
        inputs = parsed.args.inputs;
        console.log(`Universal Router Commands: ${commands}`);
      }
    }
    const transfers: Transfer[] = [];
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolAddresses = new Set<string>();
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
      const nativePrice =
        parseFloat(amountOutDecimal) > 0
          ? (
              parseFloat(amountInDecimal) / parseFloat(amountOutDecimal)
            ).toFixed(10)
          : "0";
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
        `Price: ${nativePrice} ${inputInfo.symbol}/${outputInfo.symbol}`
      );
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: "0.00",
        nativePrice,
        volume: amountOutDecimal,
        inputVolume: amountInDecimal,
        mint: outputTokenAddress,
        type:
          outputInfo.symbol === "WETH" || outputInfo.symbol === "USDC"
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

function collectSwapCalls(
  trace: any,
  poolManager: string,
  swapSelector: string
): any[] {
  const swaps: any[] = [];
  function recurse(call: any) {
    if (
      call.to?.toLowerCase() === poolManager &&
      call.input?.startsWith(swapSelector)
    ) {
      swaps.push(call);
    }
    if (call.calls) {
      call.calls.forEach(recurse);
    }
  }
  recurse(trace);
  return swaps;
}

export async function analyzeV4Transaction(txHash: string): Promise<void> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      console.log(`Transaction failed or not found: ${txHash}`);
      return;
    }
    const transaction = await provider.getTransaction(txHash);
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    const block = await provider.getBlock(receipt.blockNumber);
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);
    const userWallet = transaction.from.toLowerCase();
    const contractAddress = transaction.to?.toLowerCase() || "0x";
    console.log(`\n--- Analyzing V4 Transaction: ${txHash} ---`);
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

    const iface = new Interface(uniswapV4PoolManagerAbi);
    const swapSelector = iface.getFunction("swap")!.selector;
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolIds = new Set<string>();
    const poolKeys: {
      [poolId: string]: { currency0: string; currency1: string };
    } = {};

    // Get transaction trace to find internal swap calls
    let trace;
    try {
      trace = await provider.send("debug_traceTransaction", [
        txHash,
        { tracer: "callTracer" },
      ]);
      const swapCalls = collectSwapCalls(
        trace,
        UNISWAP_V4_POOL_MANAGER_ADDRESS,
        swapSelector
      );
      for (const swapCall of swapCalls) {
        try {
          const decoded = iface.decodeFunctionData("swap", swapCall.input);
          const key = decoded[0]; // PoolKey
          const poolId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "address", "uint24", "int24", "address"],
              [
                key.currency0,
                key.currency1,
                key.fee,
                key.tickSpacing,
                key.hooks,
              ]
            )
          );
          poolKeys[poolId] = {
            currency0: key.currency0.toLowerCase(),
            currency1: key.currency1.toLowerCase(),
          };
          tokenAddresses.add(key.currency0.toLowerCase());
          tokenAddresses.add(key.currency1.toLowerCase());
        } catch (e) {
          console.warn(
            `Failed to decode swap call in trace: ${(e as Error).message}`
          );
        }
      }
    } catch (e) {
      console.warn(
        `Failed to get transaction trace: ${
          (e as Error).message
        }. Falling back to direct parsing.`
      );
      // Fallback to direct parsing if trace not available
      try {
        const parsed = iface.parseTransaction({ data: transaction.data });
        if (parsed?.name === "swap") {
          const key = parsed.args.key;
          const poolId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "address", "uint24", "int24", "address"],
              [
                key.currency0,
                key.currency1,
                key.fee,
                key.tickSpacing,
                key.hooks,
              ]
            )
          );
          poolKeys[poolId] = {
            currency0: key.currency0.toLowerCase(),
            currency1: key.currency1.toLowerCase(),
          };
          tokenAddresses.add(key.currency0.toLowerCase());
          tokenAddresses.add(key.currency1.toLowerCase());
        }
      } catch {}
    }

    // Collect all Swap events from PoolManager
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === UNISWAP_V4_POOL_MANAGER_ADDRESS &&
        log.topics[0]?.toLowerCase() === V4_SWAP_EVENT_TOPIC?.toLowerCase()
      ) {
        try {
          const parsedLog = v4SwapIface.parseLog(log);
          if (parsedLog) {
            const poolId = ethers.hexlify(parsedLog.args.id);
            swaps.push({
              pool: poolId,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: parsedLog.args.recipient?.toLowerCase() || userWallet,
              amount0: parsedLog.args.amount0,
              amount1: parsedLog.args.amount1,
              protocol: "V4",
              tick: parsedLog.args.tick,
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: parsedLog.args.liquidity,
            });
            poolIds.add(poolId);
          }
        } catch (e) {
          console.warn(
            `Failed to parse V4 Swap event for log: ${log.transactionHash}`
          );
        }
      }
    }

    if (swaps.length === 0) {
      console.log("No V4 Swap events found.");
      return;
    }

    // Fetch token info
    const tokenInfos: { [address: string]: TokenInfo } = {};
    await Promise.all(
      Array.from(tokenAddresses).map((t) =>
        getTokenInfo(t).then((info) => (tokenInfos[t] = info))
      )
    );

    // Process each swap
    const tradeEvents: TradeEvent[] = [];
    for (const [index, swap] of swaps.entries()) {
      console.log(`\n===== V4 Swap ${index + 1} (PoolId: ${swap.pool}) =====`);
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${swap.tick}`
      );

      const poolKey = poolKeys[swap.pool];
      if (!poolKey) {
        console.warn(
          `No pool key found for poolId: ${swap.pool}. Skipping token pair resolution.`
        );
        continue;
      }
      const { currency0, currency1 } = poolKey;

      const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;
      const isToken0In = swap.amount0 > 0n;
      const inputTokenAddress = isToken0In ? currency0 : currency1;
      const outputTokenAddress = isToken0In ? currency1 : currency0;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;
      const swapAmountIn = isToken0In ? swap.amount0 : swap.amount1;
      const swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0;

      const amountInDecimal = ethers.formatUnits(
        swapAmountIn,
        inputInfo.decimals
      );
      const amountOutDecimal = ethers.formatUnits(
        swapAmountOut,
        outputInfo.decimals
      );
      const nativePrice =
        parseFloat(amountOutDecimal) > 0
          ? (
              parseFloat(amountInDecimal) / parseFloat(amountOutDecimal)
            ).toFixed(10)
          : "0";

      console.log(`\n--- Formatted V4 Swap ${index + 1} ---`);
      console.log(`Pair: ${inputInfo.symbol}/${outputInfo.symbol}`);
      console.log(
        `Input: ${formatAmount(
          swapAmountIn,
          inputInfo.decimals,
          inputInfo.symbol
        )}`
      );
      console.log(
        `Output: ${formatAmount(
          swapAmountOut,
          outputInfo.decimals,
          outputInfo.symbol
        )}`
      );
      console.log(
        `Price: ${nativePrice} ${inputInfo.symbol}/${outputInfo.symbol}`
      );

      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: "0.00",
        nativePrice,
        volume: amountOutDecimal,
        inputVolume: amountInDecimal,
        mint: outputTokenAddress,
        type:
          outputInfo.symbol === "WETH" || outputInfo.symbol === "USDC"
            ? "BUY"
            : "SELL",
        pairAddress: swap.pool,
        programId: contractAddress,
        quoteToken: inputTokenAddress,
        baseDecimals: outputInfo.decimals,
        quoteDecimals: inputInfo.decimals,
        tradeType: `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
        protocol: "V4",
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
      console.log("\n⚠️ No valid V4 TradeEvents constructed.");
    }
  } catch (err) {
    console.error(
      `Error analyzing V4 transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
