import { ethers } from "ethers";
import {
  provider,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
  V4_SWAP_EVENT_TOPIC,
  TRANSFER_TOPIC,
  transferIface,
  v4SwapIface,
  UNKNOWN_TOKEN_INFO,
  WETH_ADDRESS,
} from "./types/constants";
import { SwapEvent, Transfer, TokenInfo, TradeEvent } from "./types/types";
import { getTokenInfo, formatAmount, fetchEthPriceUsd } from "./utils/utils";
import * as uniswapV4PoolManagerAbi from "./abi/uniswapV4PoolManager.json";
// --- NEW CONSTANTS & INTERFACES ---
// Initialize Event Signature: Initialize(PoolId,Currency,Currency,uint24,int24,address,uint160,int24)
// This topic hash must be calculated from the signature:
// keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")
const V4_INITIALIZE_EVENT_TOPIC =
  "0x5d5d851e58a74e64f849a2636f29e1f579979965d1b32d56a7c390500e281561";
const initializeIface = new ethers.Interface(
  // Filter the ABI to only include the Initialize event for parsing efficiency
  uniswapV4PoolManagerAbi.filter((item: any) => item.name === "Initialize")
);
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
// --- END NEW CONSTANTS & INTERFACES ---
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
    // Debug: Print constants for verification
    console.log(
      `Debug: UNISWAP_V4_POOL_MANAGER_ADDRESS = ${UNISWAP_V4_POOL_MANAGER_ADDRESS}`
    );
    console.log(`Debug: V4_SWAP_EVENT_TOPIC = ${V4_SWAP_EVENT_TOPIC}`);
    console.log(
      `Debug: V4_INITIALIZE_EVENT_TOPIC = ${V4_INITIALIZE_EVENT_TOPIC}`
    );
    const iface = new ethers.Interface(uniswapV4PoolManagerAbi);
    const swapSelector = iface.getFunction("swap")!.selector;
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolIds = new Set<string>();
    const poolKeys: {
      [poolId: string]: { currency0: string; currency1: string };
    } = {};
    // Collect transfers to infer tokens, direction, and amounts - with debug
    const transfers: Transfer[] = [];
    const transferTopicHash =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Hardcoded for reliability
    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() === transferTopicHash) {
        console.log(
          `Debug: Found potential Transfer log at index ${
            log.index
          } for token ${log.address.toLowerCase()}, topic0 ${log.topics[0]}`
        );
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed && parsed.name === "Transfer") {
            console.log(
              `Debug: Parsed Transfer: from ${parsed.args.from.toLowerCase()} to ${parsed.args.to.toLowerCase()} value ${parsed.args.value.toString()}`
            );
            transfers.push({
              token: log.address.toLowerCase(),
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            });
            tokenAddresses.add(log.address.toLowerCase());
          } else {
            console.log(`Debug: parseLog returned null or not Transfer event`);
          }
        } catch (e) {
          console.log(
            `Debug: parseLog error for Transfer log ${log.index}: ${
              (e as Error).message
            }`
          );
        }
      }
    }
    console.log(`Debug: Total transfers collected: ${transfers.length}`);
    // Get transaction trace to find internal swap calls (original logic)
    let usedTrace = false;
    try {
      const trace = await provider.send("debug_traceTransaction", [
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
          poolIds.add(poolId);
          console.log(`Debug: Populated poolKey from Trace: ${poolId}`);
        } catch {
          console.warn(`Failed to decode swap call in trace.`);
        }
      }
      usedTrace = true;
    } catch {
      console.warn(
        `Failed to get transaction trace. Falling back to direct parsing and logs.`
      );
    }
    // Fallback: Direct parsing if to PoolManager
    if (!usedTrace) {
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
          poolIds.add(poolId);
          console.log(`Debug: Populated poolKey from Direct Call: ${poolId}`);
        }
      } catch {
        console.warn(`Failed to parse direct swap call.`);
      }
    }
    // Parse Swap events from logs
    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      // Check for Swap Event
      if (
        logAddrLower === UNISWAP_V4_POOL_MANAGER_ADDRESS.toLowerCase() &&
        topic0 === V4_SWAP_EVENT_TOPIC.toLowerCase()
      ) {
        console.log(`Debug: Matched V4 Swap log at index ${log.index}`);
        try {
          const parsedLog = v4SwapIface.parseLog(log);
          if (parsedLog) {
            const poolId = parsedLog.args.id.toLowerCase();
            swaps.push({
              pool: poolId,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: userWallet, // Default to user wallet; no recipient in ABI
              amount0: parsedLog.args.amount0,
              amount1: parsedLog.args.amount1,
              protocol: "V4",
              tick: Number(parsedLog.args.tick),
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: parsedLog.args.liquidity,
            });
            poolIds.add(poolId);
            console.log(
              `Debug: Successfully parsed Swap event - poolId: ${poolId}, sender: ${parsedLog.args.sender.toLowerCase()}`
            );
          } else {
            console.log(`Debug: parseLog returned null/undefined`);
          }
        } catch (e) {
          console.warn(
            `Failed to parse V4 Swap event for log ${log.index}: ${
              (e as Error).message
            }`
          );
        }
      }
    }
    if (swaps.length === 0) {
      console.log("No V4 Swap events found.");
      return;
    }
    // FIX 1: Infer Pool Keys from Initialize Event (Most reliable fallback)
    const poolManagerAddress = UNISWAP_V4_POOL_MANAGER_ADDRESS.toLowerCase();
    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      if (
        logAddrLower === poolManagerAddress &&
        topic0 === V4_INITIALIZE_EVENT_TOPIC.toLowerCase()
      ) {
        try {
          const parsedLog = initializeIface.parseLog(log);
          if (parsedLog && parsedLog.name === "Initialize") {
            const poolId = parsedLog.args.id.toLowerCase();
            const currency0 = parsedLog.args.currency0.toLowerCase();
            const currency1 = parsedLog.args.currency1.toLowerCase();
            poolKeys[poolId] = { currency0, currency1 };
            tokenAddresses.add(currency0);
            tokenAddresses.add(currency1);
            poolIds.add(poolId);
            console.log(
              `Debug: Populated poolKey from Initialize event: ${poolId}`
            );
          }
        } catch (e) {
          console.warn(
            `Failed to parse V4 Initialize event: ${(e as Error).message}`
          );
        }
      }
    }
    // END FIX 1
    // FIX 2: Enhanced Fallback Inference Logic (to catch Token-WETH swaps)
    for (const poolId of poolIds) {
      if (!poolKeys[poolId]) {
        console.log(`Inferring poolKey for poolId: ${poolId}`);
        const hasEthInput = transaction.value > 0n;
        const transferTopicHash =
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const potentialTokens = Array.from(
          new Set(
            receipt.logs
              .filter((l) => l.topics[0]?.toLowerCase() === transferTopicHash)
              .map((l) => l.address.toLowerCase())
          )
        );
        let currency0, currency1;
        if (potentialTokens.length === 1 && hasEthInput) {
          // Case: ETH-Token swap (TokenA)
          const tokenA = potentialTokens[0];
          currency0 = ETH_ADDRESS;
          currency1 = tokenA.toLowerCase();
        } else if (potentialTokens.length === 2) {
          // Case: Token-Token swap (TokenA & TokenB)
          [currency0, currency1] = potentialTokens.sort();
        }
        // NEW HEURISTIC: Case: Only one ERC20 token found, no ETH sent (Assume Token-WETH)
        else if (potentialTokens.length === 1 && !hasEthInput) {
          const tokenA = potentialTokens[0];
          const wethAddress = WETH_ADDRESS.toLowerCase();
          // Assume the two pool currencies are the one transferred ERC20 and WETH
          [currency0, currency1] = [tokenA, wethAddress].sort();
          console.warn(
            `Inferred poolKey (HEURISTIC: 1 ERC20 + WETH) for ${poolId}: ${currency0}/${currency1}`
          );
        }
        // END NEW HEURISTIC
        else {
          console.warn(`Cannot infer poolKey for ${poolId}. Skipping pool.`);
          continue;
        }
        poolKeys[poolId] = { currency0, currency1 };
        tokenAddresses.add(currency0);
        tokenAddresses.add(currency1);
        console.log(
          `Inferred poolKey: currency0=${currency0}, currency1=${currency1}`
        );
      }
    }
    // END FIX 2
    // Add ETH if value sent
    const hasEthInput = transaction.value > 0n;
    if (hasEthInput) {
      tokenAddresses.add(ETH_ADDRESS);
    }
    // Fetch token info
    const tokenInfos: { [address: string]: TokenInfo } = {};
    // Always set ETH info
    tokenInfos[ETH_ADDRESS] = {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: ETH_ADDRESS,
    } as TokenInfo;
    // Fetch others
    await Promise.all(
      Array.from(tokenAddresses)
        .filter((t) => t !== ETH_ADDRESS)
        .map((t) => getTokenInfo(t).then((info) => (tokenInfos[t] = info)))
    );
    // Fetch ETH USD price once
    const ethUsd = (await fetchEthPriceUsd()) || 0;
    // Process each swap individually
    const tradeEvents: TradeEvent[] = [];
    for (const [index, swap] of swaps.entries()) {
      console.log(`\n===== V4 Swap ${index + 1} (PoolId: ${swap.pool}) =====`);
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${swap.tick}`
      );
      const poolKey = poolKeys[swap.pool];
      if (!poolKey) {
        console.warn(`No poolKey for swap ${index + 1}. Skipping.`);
        continue;
      }
      const { currency0, currency1 } = poolKey;
      const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;
      const tokenSymbol = token1Info.symbol;
      // Determine direction: negative = input, positive = output
      let isToken0In: boolean;
      let swapAmountIn: bigint = 0n;
      let swapAmountOut: bigint = 0n;
      if (swap.amount0 < 0n && swap.amount1 > 0n) {
        isToken0In = true;
        swapAmountIn = -swap.amount0;
        swapAmountOut = swap.amount1;
      } else if (swap.amount1 < 0n && swap.amount0 > 0n) {
        isToken0In = false;
        swapAmountIn = -swap.amount1;
        swapAmountOut = swap.amount0;
      } else {
        // Rare case: both positive/negative or zero - skip or use abs
        console.warn(`Invalid swap deltas for swap ${index + 1}. Skipping.`);
        continue;
      }
      const inputTokenAddress = isToken0In ? currency0 : currency1;
      const outputTokenAddress = isToken0In ? currency1 : currency0;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;
      // Override with net transfers only as fallback if event amounts are zero (user-level adjustment)
      const netInSum = transfers
        .filter(
          (t) =>
            t.token.toLowerCase() === inputTokenAddress && t.from === userWallet
        )
        .reduce((sum, t) => sum + t.value, 0n);
      if (swapAmountIn === 0n && netInSum > 0n) swapAmountIn = netInSum;
      const netOutSum = transfers
        .filter(
          (t) =>
            t.token.toLowerCase() === outputTokenAddress && t.to === userWallet
        )
        .reduce((sum, t) => sum + t.value, 0n);
      if (swapAmountOut === 0n && netOutSum > 0n) swapAmountOut = netOutSum;
      // Special handling for ETH input
      if (inputTokenAddress === ETH_ADDRESS && swapAmountIn === 0n) {
        swapAmountIn = transaction.value;
      }
      if (swapAmountIn === 0n && swapAmountOut === 0n) {
        console.warn(
          `Both swap amounts are zero for swap ${index + 1}. Skipping.`
        );
        continue;
      }
      const amountInDecimal = ethers.formatUnits(
        swapAmountIn,
        inputInfo.decimals
      );
      const amountOutDecimal = ethers.formatUnits(
        swapAmountOut,
        outputInfo.decimals
      );
      // ETH and token amounts for pricing (ETH per token)
      const ethAmount = isToken0In ? swapAmountIn : swapAmountOut;
      const tokenAmount = isToken0In ? swapAmountOut : swapAmountIn;
      const ethDeltaDecimal = ethers.formatUnits(ethAmount, 18);
      const tokenDeltaDecimal = ethers.formatUnits(
        tokenAmount,
        token1Info.decimals
      );
      // Native price: ETH per token (effective)
      const nativePriceNum =
        parseFloat(ethDeltaDecimal) / parseFloat(tokenDeltaDecimal) || 0;
      const nativePrice = nativePriceNum.toFixed(10);
      // Spot price from sqrtPriceX96: ETH per token
      let spotNum = nativePriceNum;
      if (swap.sqrtPriceX96) {
        const sqrtPrice = Number(swap.sqrtPriceX96) / Math.pow(2, 96);
        const rawPriceToken1PerToken0 = sqrtPrice ** 2;
        const decDiff = token0Info.decimals - token1Info.decimals;
        const adjustedPriceToken1PerToken0 =
          rawPriceToken1PerToken0 * Math.pow(10, decDiff);
        // This logic seems to assume Token0 is ETH (or is used as the quote token)
        // Let's stick to the convention in the original code for now.
        spotNum = 1 / adjustedPriceToken1PerToken0;
      }
      const spotNativePrice = spotNum.toFixed(10);
      // USD per token (using spot)
      const usdPerToken = spotNum * ethUsd;
      const usdPriceStr = `$${usdPerToken.toFixed(2)}`;
      // Trade USD value (value of ETH leg)
      const tradeUsdValue = parseFloat(ethDeltaDecimal) * ethUsd;
      // USD volume (output token value in USD)
      const usdVolumeNum = parseFloat(tokenDeltaDecimal) * usdPerToken;
      const usdVolumeStr = `$${usdVolumeNum.toFixed(2)}`;
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
        `Effective Price: ${nativePrice} ${token0Info.symbol} per ${tokenSymbol}`
      );
      console.log(
        `Spot Price: ${spotNativePrice} ${
          token0Info.symbol
        } per ${tokenSymbol} | USD per ${tokenSymbol}: ${usdPriceStr} | Trade Value: $${tradeUsdValue.toFixed(
          2
        )} | Volume USD: ${usdVolumeStr}`
      );
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPriceStr,
        nativePrice: nativePrice, // Use effective for TradeEvent
        volume: usdVolumeStr,
        inputVolume: ethDeltaDecimal,
        mint: currency1,
        type: isToken0In ? "BUY" : "SELL",
        pairAddress: swap.pool,
        programId: contractAddress,
        quoteToken: ETH_ADDRESS,
        baseDecimals: token1Info.decimals,
        quoteDecimals: 18,
        tradeType: isToken0In
          ? `ETH -> ${token1Info.symbol}`
          : `${token1Info.symbol} -> ETH`,
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
export function collectSwapCalls(
  trace: any,
  poolManager: string,
  swapSelector: string
): any[] {
  const swaps: any[] = [];
  function recurse(call: any) {
    if (
      call.to?.toLowerCase() === poolManager.toLowerCase() &&
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
