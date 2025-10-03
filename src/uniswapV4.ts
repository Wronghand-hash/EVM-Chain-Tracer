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

    // Get transaction trace to find internal swap calls (unchanged)
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

    // Fallback: Direct parsing if to PoolManager (unchanged)
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
        }
      } catch {
        console.warn(`Failed to parse direct swap call.`);
      }
    }

    // Parse Swap events from logs (unchanged)
    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      console.log(
        `Debug: Log from address ${logAddrLower} with topic0 ${topic0}`
      );
      if (
        logAddrLower === UNISWAP_V4_POOL_MANAGER_ADDRESS.toLowerCase() &&
        topic0 === V4_SWAP_EVENT_TOPIC.toLowerCase()
      ) {
        console.log(`Debug: Address matches PoolManager`);
        console.log(`Debug: Topic matches V4_SWAP_EVENT_TOPIC`);
        console.log(`Debug: Matched V4 Swap log at index ${log.index}`);
        try {
          const parsedLog = v4SwapIface.parseLog(log);
          if (parsedLog) {
            const poolId = parsedLog.args.id.toLowerCase();
            swaps.push({
              pool: poolId,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: parsedLog.args.recipient?.toLowerCase() || userWallet,
              amount0: parsedLog.args.amount0,
              amount1: parsedLog.args.amount1,
              protocol: "V4",
              tick: Number(parsedLog.args.tick),
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: parsedLog.args.liquidity,
            });
            poolIds.add(poolId);
            console.log(
              `Debug: Successfully parsed Swap event - poolId: ${poolId}`
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
      } else {
        console.log(`Debug: Log skipped (address or topic mismatch)`);
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

    // Fetch ETH USD price once
    const ethUsd = (await fetchEthPriceUsd()) || 0;

    // Process each swap
    const tradeEvents: TradeEvent[] = [];
    for (const [index, swap] of swaps.entries()) {
      console.log(`\n===== V4 Swap ${index + 1} (PoolId: ${swap.pool}) =====`);
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${swap.tick}`
      );

      let poolKey: { currency0: string; currency1: string } | null =
        poolKeys[swap.pool];
      let inputTokenAddress: string = "";
      let outputTokenAddress: string = "";
      let swapAmountIn: bigint = 0n;
      let swapAmountOut: bigint = 0n;
      let inputInfo: TokenInfo = UNKNOWN_TOKEN_INFO;
      let outputInfo: TokenInfo = UNKNOWN_TOKEN_INFO;
      let isToken0In: boolean = false;

      if (!poolKey) {
        console.log(`No poolKey from trace; inferring from transfers...`);
        if (transfers.length > 0) {
          // Use net outgoing/incoming transfers from user
          const tokenOutgoing: { [token: string]: bigint } = {};
          const tokenIncoming: { [token: string]: bigint } = {};
          for (const t of transfers) {
            const tk = t.token.toLowerCase();
            if (t.from === userWallet) {
              if (!tokenOutgoing[tk]) tokenOutgoing[tk] = 0n;
              tokenOutgoing[tk] += t.value;
            }
            if (t.to === userWallet) {
              if (!tokenIncoming[tk]) tokenIncoming[tk] = 0n;
              tokenIncoming[tk] += t.value;
            }
          }

          const outgoingTokens = Object.keys(tokenOutgoing).filter(
            (tk) => tokenOutgoing[tk] > 0n
          );
          const incomingTokens = Object.keys(tokenIncoming).filter(
            (tk) => tokenIncoming[tk] > 0n
          );

          if (
            outgoingTokens.length === 1 &&
            incomingTokens.length === 1 &&
            outgoingTokens[0] !== incomingTokens[0]
          ) {
            inputTokenAddress = outgoingTokens[0];
            outputTokenAddress = incomingTokens[0];
            swapAmountIn = tokenOutgoing[inputTokenAddress];
            swapAmountOut = tokenIncoming[outputTokenAddress];
          } else {
            console.warn(
              `Ambiguous transfers: outgoing ${outgoingTokens.length}, incoming ${incomingTokens.length}. Falling back to event-based inference.`
            );
          }
        }

        if (transfers.length === 0 || inputTokenAddress === "") {
          // Ultimate fallback: Smart option-based assignment using formatted amounts and WETH preference
          console.log(
            `Debug: Transfers empty or ambiguous; using smart event-based inference.`
          );
          const transferTopicHash =
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
          const potentialTokens = Array.from(
            new Set(
              receipt.logs
                .filter((l) => l.topics[0]?.toLowerCase() === transferTopicHash)
                .map((l) => l.address.toLowerCase())
            )
          );
          if (potentialTokens.length < 2) {
            console.warn(`No potential tokens found. Skipping.`);
            continue;
          }

          // Fetch infos for both
          const [tokenA, tokenB] = potentialTokens.sort(); // Lex sort for reference
          const infoA = await getTokenInfo(tokenA);
          const infoB = await getTokenInfo(tokenB);
          tokenInfos[tokenA] = infoA;
          tokenInfos[tokenB] = infoB;

          // Abs raw amounts
          const absAmount0 = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
          const absAmount1 = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;

          // Option 1: currency0 = tokenA, currency1 = tokenB
          const formatted_abs0_opt1 = parseFloat(
            ethers.formatUnits(absAmount0, infoA.decimals)
          );
          const formatted_abs1_opt1 = parseFloat(
            ethers.formatUnits(absAmount1, infoB.decimals)
          );
          const input_is0_opt1 = swap.amount0 < 0n;
          const input_formatted_opt1 = input_is0_opt1
            ? formatted_abs0_opt1
            : formatted_abs1_opt1;
          const output_formatted_opt1 = input_is0_opt1
            ? formatted_abs1_opt1
            : formatted_abs0_opt1;
          const ratio_opt1 = input_formatted_opt1 / output_formatted_opt1 || 0;
          const output_token_opt1 = input_is0_opt1 ? tokenB : tokenA;
          const is_weth_output_opt1 =
            output_token_opt1.toLowerCase() === WETH_ADDRESS;
          const small_output_opt1 = output_formatted_opt1 < 1;

          // Option 2: currency0 = tokenB, currency1 = tokenA (reverse for order)
          const formatted_abs0_opt2 = parseFloat(
            ethers.formatUnits(absAmount0, infoB.decimals)
          );
          const formatted_abs1_opt2 = parseFloat(
            ethers.formatUnits(absAmount1, infoA.decimals)
          );
          const input_is0_opt2 = swap.amount0 < 0n;
          const input_formatted_opt2 = input_is0_opt2
            ? formatted_abs0_opt2
            : formatted_abs1_opt2;
          const output_formatted_opt2 = input_is0_opt2
            ? formatted_abs1_opt2
            : formatted_abs0_opt2;
          const ratio_opt2 = input_formatted_opt2 / output_formatted_opt2 || 0;
          const output_token_opt2 = input_is0_opt2 ? tokenA : tokenB;
          const is_weth_output_opt2 =
            output_token_opt2.toLowerCase() === WETH_ADDRESS;
          const small_output_opt2 = output_formatted_opt2 < 1;

          // Choose option: prefer large input ratio (>10), small output (<1), and WETH as output if present
          let chosen_opt = 1;
          let score_opt1 =
            (ratio_opt1 > 10 ? 1 : 0) +
            (small_output_opt1 ? 1 : 0) +
            (is_weth_output_opt1 ? 2 : 0);
          let score_opt2 =
            (ratio_opt2 > 10 ? 1 : 0) +
            (small_output_opt2 ? 1 : 0) +
            (is_weth_output_opt2 ? 2 : 0);
          if (score_opt2 > score_opt1) chosen_opt = 2;

          let chosen_currency0,
            chosen_currency1,
            chosen_input_formatted,
            chosen_output_formatted,
            chosen_isToken0In,
            chosen_input_token,
            chosen_output_token,
            chosen_input_info,
            chosen_output_info,
            chosen_swapAmountIn,
            chosen_swapAmountOut;

          if (chosen_opt === 1) {
            chosen_currency0 = tokenA;
            chosen_currency1 = tokenB;
            chosen_isToken0In = input_is0_opt1;
            chosen_input_token = chosen_isToken0In ? tokenA : tokenB;
            chosen_output_token = chosen_isToken0In ? tokenB : tokenA;
            chosen_input_info = chosen_isToken0In ? infoA : infoB;
            chosen_output_info = chosen_isToken0In ? infoB : infoA;
            chosen_swapAmountIn = chosen_isToken0In
              ? swap.amount0 < 0n
                ? -swap.amount0
                : 0n
              : swap.amount1 < 0n
              ? -swap.amount1
              : 0n;
            chosen_swapAmountOut = chosen_isToken0In
              ? swap.amount1
              : swap.amount0;
            chosen_input_formatted = input_formatted_opt1;
            chosen_output_formatted = output_formatted_opt1;
          } else {
            chosen_currency0 = tokenB;
            chosen_currency1 = tokenA;
            chosen_isToken0In = input_is0_opt2;
            chosen_input_token = chosen_isToken0In ? tokenB : tokenA;
            chosen_output_token = chosen_isToken0In ? tokenA : tokenB;
            chosen_input_info = chosen_isToken0In ? infoB : infoA;
            chosen_output_info = chosen_isToken0In ? infoA : infoB;
            chosen_swapAmountIn = chosen_isToken0In
              ? swap.amount0 < 0n
                ? -swap.amount0
                : 0n
              : swap.amount1 < 0n
              ? -swap.amount1
              : 0n;
            chosen_swapAmountOut = chosen_isToken0In
              ? swap.amount1
              : swap.amount0;
            chosen_input_formatted = input_formatted_opt2;
            chosen_output_formatted = output_formatted_opt2;
          }

          poolKey = {
            currency0: chosen_currency0,
            currency1: chosen_currency1,
          };
          inputTokenAddress = chosen_input_token;
          outputTokenAddress = chosen_output_token;
          inputInfo = chosen_input_info;
          outputInfo = chosen_output_info;
          swapAmountIn = chosen_swapAmountIn;
          swapAmountOut = chosen_swapAmountOut;
          isToken0In = chosen_isToken0In;

          console.log(
            `Debug: Chose option ${chosen_opt} with input ratio ${
              chosen_input_formatted / chosen_output_formatted || 0
            }, WETH output: ${is_weth_output_opt2 || is_weth_output_opt1}`
          );
        } else {
          console.warn(`No potential tokens found. Skipping.`);
          continue;
        }
      } else {
        // If poolKey from trace, use event deltas for direction and amounts, validate with transfers
        const { currency0, currency1 } = poolKey;
        const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
        const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;

        // Determine from event: negative delta = input, positive = output
        isToken0In = swap.amount0 < 0n;
        if (swap.amount0 < 0n && swap.amount1 > 0n) {
          isToken0In = true;
        } else if (swap.amount1 < 0n && swap.amount0 > 0n) {
          isToken0In = false;
        } else {
          // Rare case, use abs comparison
          const abs0 = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
          const abs1 = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;
          isToken0In = abs0 > abs1 ? swap.amount0 < 0n : swap.amount1 < 0n;
        }
        inputTokenAddress = isToken0In ? currency0 : currency1;
        outputTokenAddress = isToken0In ? currency1 : currency0;
        inputInfo = isToken0In ? token0Info : token1Info;
        outputInfo = isToken0In ? token1Info : token0Info;
        swapAmountIn = isToken0In ? -swap.amount0 : -swap.amount1;
        swapAmountOut = isToken0In ? swap.amount1 : swap.amount0;

        // Validate/override with net transfers
        const netInSum = transfers
          .filter(
            (t) =>
              t.token.toLowerCase() === inputTokenAddress &&
              t.from === userWallet
          )
          .reduce((sum, t) => sum + t.value, 0n);
        if (netInSum > 0n) swapAmountIn = netInSum;
        const netOutSum = transfers
          .filter(
            (t) =>
              t.token.toLowerCase() === outputTokenAddress &&
              t.to === userWallet
          )
          .reduce((sum, t) => sum + t.value, 0n);
        if (netOutSum > 0n) swapAmountOut = netOutSum;
      }

      // Guard: Ensure variables are assigned before proceeding
      if (inputTokenAddress === "" || outputTokenAddress === "") {
        console.warn(`Failed to determine input/output tokens. Skipping swap.`);
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

      // Native price: input per output (e.g., PEPE per WETH)
      const nativePriceNum =
        parseFloat(amountInDecimal) / parseFloat(amountOutDecimal) || 0;
      const nativePrice = nativePriceNum.toFixed(10);

      // Spot price from sqrtPriceX96: input per output
      let spotNum = nativePriceNum;
      if (swap.sqrtPriceX96 && poolKey) {
        const token0Info = tokenInfos[poolKey.currency0] || UNKNOWN_TOKEN_INFO;
        const token1Info = tokenInfos[poolKey.currency1] || UNKNOWN_TOKEN_INFO;
        const sqrtPrice = Number(swap.sqrtPriceX96) / Math.pow(2, 96);
        const rawPriceToken1PerToken0 = sqrtPrice ** 2;
        const decDiff = token0Info.decimals - token1Info.decimals;
        const adjustedPriceToken1PerToken0 =
          rawPriceToken1PerToken0 * Math.pow(10, decDiff);
        if (isToken0In) {
          // Input token0, output token1: input per output = token0 per token1 = 1 / (token1 per token0)
          spotNum = 1 / adjustedPriceToken1PerToken0;
        } else {
          // Input token1, output token0: input per output = token1 per token0
          spotNum = adjustedPriceToken1PerToken0;
        }
      }
      const spotNativePrice = spotNum.toFixed(10);

      // USD per output symbol
      let usdPerOutput = 0;
      if (outputTokenAddress.toLowerCase() === WETH_ADDRESS) {
        usdPerOutput = ethUsd;
      } else if (inputTokenAddress.toLowerCase() === WETH_ADDRESS) {
        // If input WETH, USD per output = (output per input WETH) * ethUsd = (1 / spotNum) * ethUsd
        usdPerOutput = (1 / spotNum) * ethUsd;
      }
      const usdPriceStr = `$${usdPerOutput.toFixed(2)}`;

      // Trade USD value (total output value)
      const tradeUsdValue =
        outputTokenAddress.toLowerCase() === WETH_ADDRESS
          ? parseFloat(amountOutDecimal) * ethUsd
          : usdPerOutput * parseFloat(amountOutDecimal);

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
        `Effective Price: ${nativePrice} ${inputInfo.symbol} per ${outputInfo.symbol}`
      );
      console.log(
        `Spot Price: ${spotNativePrice} ${inputInfo.symbol} per ${
          outputInfo.symbol
        } | USD per ${
          outputInfo.symbol
        }: ${usdPriceStr} | Trade Value: $${tradeUsdValue.toFixed(2)}`
      );

      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPriceStr,
        nativePrice: nativePrice, // Use effective for TradeEvent
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

export function collectSwapCalls(
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
