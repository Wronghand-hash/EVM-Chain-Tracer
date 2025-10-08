import { ethers } from "ethers";
import {
  provider,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
  V4_SWAP_EVENT_TOPIC,
  transferIface,
  v4SwapIface,
  UNKNOWN_TOKEN_INFO,
  WETH_ADDRESS,
} from "./types/constants";
import { SwapEvent, Transfer, TokenInfo, TradeEvent } from "./types/types";
import { getTokenInfo, formatAmount, fetchEthPriceUsd } from "./utils/utils";
import * as uniswapV4PoolManagerAbi from "./abi/uniswapV4PoolManager.json";

const V4_INITIALIZE_EVENT_TOPIC =
  "0x5d5d851e58a74e64f849a2636f29e1f579979965d1b32d56a7c390500e281561";
const initializeIface = new ethers.Interface(
  uniswapV4PoolManagerAbi.filter((item: any) => item.name === "Initialize")
);
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

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

    const iface = new ethers.Interface(uniswapV4PoolManagerAbi);
    const swapSelector = iface.getFunction("swap")!.selector;
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolIds = new Set<string>();
    const poolKeys: {
      [poolId: string]: { currency0: string; currency1: string };
    } = {};

    const transfers: Transfer[] = [];
    const transferTopicHash =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() === transferTopicHash) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed && parsed.name === "Transfer") {
            transfers.push({
              token: log.address.toLowerCase(),
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            });
            tokenAddresses.add(log.address.toLowerCase());
          }
        } catch {}
      }
    }

    try {
      const parsed = iface.parseTransaction({ data: transaction.data });
      if (parsed?.name === "swap") {
        const key = parsed.args.key;
        const poolId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
          )
        );
        poolKeys[poolId] = {
          currency0: key.currency0.toLowerCase(),
          currency1: key.currency1.toLowerCase(),
        };
        tokenAddresses.add(key.currency0.toLowerCase());
        tokenAddresses.add(key.currency1.toLowerCase());
        poolIds.add(poolId);
      }
    } catch {
      console.warn(`Failed to parse direct swap call.`);
    }

    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      const logAddrLower = log.address.toLowerCase();

      if (
        logAddrLower === UNISWAP_V4_POOL_MANAGER_ADDRESS.toLowerCase() &&
        topic0 === V4_SWAP_EVENT_TOPIC.toLowerCase()
      ) {
        try {
          const parsedLog = v4SwapIface.parseLog(log);
          if (parsedLog) {
            const poolId = parsedLog.args.id.toLowerCase();
            swaps.push({
              pool: poolId,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: userWallet,
              amount0: parsedLog.args.amount0,
              amount1: parsedLog.args.amount1,
              protocol: "V4",
              tick: Number(parsedLog.args.tick),
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: parsedLog.args.liquidity,
            });
            poolIds.add(poolId);
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

    // FIX 1: Infer Pool Keys from Initialize Event
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
          }
        } catch (e) {
          console.warn(
            `Failed to parse V4 Initialize event: ${(e as Error).message}`
          );
        }
      }
    }

    // FIX 2: Enhanced Fallback Inference Logic with WETH->ETH heuristic
    for (const poolId of poolIds) {
      if (!poolKeys[poolId]) {
        const hasEthInput = transaction.value > 0n;
        const potentialTokensSet = new Set(
          receipt.logs
            .filter((l) => l.topics[0]?.toLowerCase() === transferTopicHash)
            .map((l) => l.address.toLowerCase())
        );
        const wethLower = WETH_ADDRESS.toLowerCase();
        if (potentialTokensSet.has(wethLower)) {
          potentialTokensSet.delete(wethLower);
          potentialTokensSet.add(ETH_ADDRESS);
        }
        const adjustedPotentialTokens = Array.from(potentialTokensSet);
        let currency0, currency1;
        if (adjustedPotentialTokens.length === 1 && hasEthInput) {
          const tokenA = adjustedPotentialTokens[0];
          currency0 = ETH_ADDRESS;
          currency1 = tokenA;
        } else if (adjustedPotentialTokens.length === 2) {
          [currency0, currency1] = adjustedPotentialTokens.sort();
        } else if (adjustedPotentialTokens.length === 1 && !hasEthInput) {
          const tokenA = adjustedPotentialTokens[0];
          if (tokenA === ETH_ADDRESS) {
            console.warn(`Pure ETH pool inferred for ${poolId}. Skipping.`);
            continue;
          }
          const wethForHeuristic = WETH_ADDRESS.toLowerCase();
          const pair = [tokenA, wethForHeuristic].sort();
          currency0 = pair[0];
          currency1 = pair[1];
          console.warn(
            `Inferred poolKey (HEURISTIC: 1 ERC20 + WETH) for ${poolId}: ${currency0}/${currency1}`
          );
        } else {
          console.warn(`Cannot infer poolKey for ${poolId}. Skipping pool.`);
          continue;
        }
        poolKeys[poolId] = { currency0, currency1 };
        tokenAddresses.add(currency0);
        tokenAddresses.add(currency1);
      }
    }

    const hasEthInput = transaction.value > 0n;
    if (hasEthInput) {
      tokenAddresses.add(ETH_ADDRESS);
    }

    const tokenInfos: { [address: string]: TokenInfo } = {};
    tokenInfos[ETH_ADDRESS] = {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: ETH_ADDRESS,
    } as TokenInfo;

    await Promise.all(
      Array.from(tokenAddresses)
        .filter((t) => t !== ETH_ADDRESS)
        .map((t) => getTokenInfo(t).then((info) => (tokenInfos[t] = info)))
    );

    const ethUsd = (await fetchEthPriceUsd()) || 0;
    const tradeEvents: TradeEvent[] = [];

    for (const [index, swap] of swaps.entries()) {
      const poolKey = poolKeys[swap.pool];
      if (!poolKey) {
        console.warn(`No poolKey for swap ${index + 1}. Skipping.`);
        continue;
      }

      const { currency0, currency1 } = poolKey;
      const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;

      const isEthSideCurrency0 =
        currency0 === ETH_ADDRESS || currency0 === WETH_ADDRESS;
      const baseAddress = isEthSideCurrency0 ? currency1 : currency0;
      const baseInfo = tokenInfos[baseAddress] || UNKNOWN_TOKEN_INFO;

      let isToken0In: boolean;
      let eventAmountIn: bigint = 0n;
      let eventAmountOut: bigint = 0n;

      // Corrected direction detection based on pool delta signs
      if (swap.amount0 > 0n && swap.amount1 < 0n) {
        // Input token0, output token1
        isToken0In = true;
        eventAmountIn = swap.amount0;
        eventAmountOut = -swap.amount1;
      } else if (swap.amount0 < 0n && swap.amount1 > 0n) {
        // Input token1, output token0
        isToken0In = false;
        eventAmountIn = swap.amount1;
        eventAmountOut = -swap.amount0;
      } else {
        console.warn(`Invalid swap deltas for swap ${index + 1}. Skipping.`);
        continue;
      }

      const inputTokenAddress = isToken0In ? currency0 : currency1;
      const outputTokenAddress = isToken0In ? currency1 : currency0;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;

      // Debug logs
      console.log(`\nDebug for swap ${index + 1}:`);
      console.log(
        `Pool deltas: amount0=${ethers.formatUnits(
          swap.amount0,
          token0Info.decimals || 18
        )} ${token0Info.symbol || "token0"}, amount1=${ethers.formatUnits(
          swap.amount1,
          token1Info.decimals || 18
        )} ${token1Info.symbol || "token1"}`
      );
      console.log(`Pool key: ${currency0} / ${currency1}`);
      console.log(`Detected direction: isToken0In=${isToken0In}`);

      // Prefer event amounts, override with net only if event is zero
      let swapAmountIn = eventAmountIn;
      let swapAmountOut = eventAmountOut;

      const netInSum = transfers
        .filter(
          (t) =>
            t.token.toLowerCase() === inputTokenAddress && t.from === userWallet
        )
        .reduce((sum, t) => sum + t.value, 0n);

      if (
        swapAmountIn === 0n &&
        inputTokenAddress !== ETH_ADDRESS &&
        netInSum > 0n
      ) {
        swapAmountIn = netInSum;
      }

      const netOutSum = transfers
        .filter(
          (t) =>
            t.token.toLowerCase() === outputTokenAddress && t.to === userWallet
        )
        .reduce((sum, t) => sum + t.value, 0n);

      if (
        swapAmountOut === 0n &&
        outputTokenAddress !== ETH_ADDRESS &&
        netOutSum > 0n
      ) {
        swapAmountOut = netOutSum;
      }

      if (inputTokenAddress === ETH_ADDRESS && swapAmountIn === 0n) {
        swapAmountIn = transaction.value;
      }

      console.log(
        `Event amounts: in=${ethers.formatUnits(
          eventAmountIn,
          inputInfo.decimals || 18
        )} ${inputInfo.symbol || inputTokenAddress}, out=${ethers.formatUnits(
          eventAmountOut,
          outputInfo.decimals || 18
        )} ${outputInfo.symbol || outputTokenAddress}`
      );
      console.log(
        `Net in sum: ${ethers.formatUnits(netInSum, inputInfo.decimals || 18)}`
      );
      console.log(
        `Net out sum: ${ethers.formatUnits(
          netOutSum,
          outputInfo.decimals || 18
        )}`
      );
      console.log(
        `Final amounts: in=${ethers.formatUnits(
          swapAmountIn,
          inputInfo.decimals || 18
        )} ${inputInfo.symbol || inputTokenAddress}, out=${ethers.formatUnits(
          swapAmountOut,
          outputInfo.decimals || 18
        )} ${outputInfo.symbol || outputTokenAddress}`
      );

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

      // Corrected ETH/Base amounts for price calc
      const isEthOrWethInput =
        inputTokenAddress === ETH_ADDRESS || inputTokenAddress === WETH_ADDRESS;
      const isEthOrWethOutput =
        outputTokenAddress === ETH_ADDRESS ||
        outputTokenAddress === WETH_ADDRESS;
      let ethSideAmount: bigint;
      let baseSideAmount: bigint;
      if (isEthOrWethInput) {
        ethSideAmount = swapAmountIn;
        baseSideAmount = swapAmountOut;
      } else if (isEthOrWethOutput) {
        ethSideAmount = swapAmountOut;
        baseSideAmount = swapAmountIn;
      } else {
        console.warn(`No ETH/WETH side in swap ${index + 1}. Skipping.`);
        continue;
      }
      const ethDeltaDecimal = ethers.formatUnits(ethSideAmount, 18);
      const baseDeltaDecimal = ethers.formatUnits(
        baseSideAmount,
        baseInfo.decimals
      );

      const effectiveEthPerBaseNum =
        parseFloat(ethDeltaDecimal) / parseFloat(baseDeltaDecimal) || 0;
      const effectiveEthPerBase = effectiveEthPerBaseNum.toFixed(10);

      let spotEthPerBaseNum = 0;
      if (swap.sqrtPriceX96) {
        const sqrtPrice = Number(swap.sqrtPriceX96) / Math.pow(2, 96);
        const rawPriceToken1PerToken0 = sqrtPrice ** 2;
        const decDiff = token0Info.decimals - token1Info.decimals;
        const adjustedPriceToken1PerToken0 =
          rawPriceToken1PerToken0 * Math.pow(10, decDiff);
        const isEthSideToken0 =
          currency0 === ETH_ADDRESS || currency0 === WETH_ADDRESS;
        spotEthPerBaseNum = isEthSideToken0
          ? 1 / adjustedPriceToken1PerToken0
          : adjustedPriceToken1PerToken0;
      }
      const spotEthPerBase = spotEthPerBaseNum.toFixed(10);

      const usdPerBase = ethUsd * spotEthPerBaseNum;
      const usdPriceStr = `$${usdPerBase.toFixed(4)}`;

      const inputPrice = isEthOrWethInput ? ethUsd : usdPerBase;
      const tradeUsdValue = parseFloat(amountInDecimal) * inputPrice;

      const usdVolumeNum = tradeUsdValue;
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
        `Effective Price: ${effectiveEthPerBase} ETH per ${baseInfo.symbol}`
      );
      console.log(
        `Spot Price: ${spotEthPerBase} ETH per ${baseInfo.symbol} | USD per ${
          baseInfo.symbol
        }: ${usdPriceStr} | Trade Value: $${tradeUsdValue.toFixed(
          2
        )} | Volume USD: ${usdVolumeStr}`
      );

      const isBuy =
        outputTokenAddress !== ETH_ADDRESS &&
        outputTokenAddress !== WETH_ADDRESS;
      const isNativeInput =
        inputTokenAddress === ETH_ADDRESS || inputTokenAddress === WETH_ADDRESS;
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPriceStr,
        nativePrice: effectiveEthPerBase,
        volume: usdVolumeStr,
        inputVolume: amountInDecimal,
        mint: baseAddress,
        type: isBuy ? "BUY" : "SELL",
        pairAddress: swap.pool,
        programId: contractAddress,
        quoteToken: ETH_ADDRESS,
        baseDecimals: baseInfo.decimals,
        quoteDecimals: 18,
        tradeType: isNativeInput
          ? `ETH -> ${outputInfo.symbol}`
          : `${inputInfo.symbol} -> ETH`,
        walletAddress: userWallet,
        protocol: "V4",
        targetTokenMint: "",
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
