// uniswapV4.ts (Full Updated File)
import { ethers, Interface } from "ethers";
import {
  provider,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
  V4_SWAP_EVENT_TOPIC,
  TRANSFER_TOPIC,
  transferIface,
  v4SwapIface,
  UNKNOWN_TOKEN_INFO,
} from "./types/constants";
import { SwapEvent, Transfer, TokenInfo, TradeEvent } from "./types/types";
import { getTokenInfo, formatAmount, fetchEthPriceUsd } from "./utils/utils";
import * as uniswapV4PoolManagerAbi from "./abi/uniswapV4PoolManager.json";

// Add partial ParaSwap ABI for fallback decoding (from Etherscan)
const paraSwapAbi = [
  {
    inputs: [
      { internalType: "address", name: "executor", type: "address" },
      {
        components: [
          { internalType: "address", name: "srcToken", type: "address" },
          { internalType: "address", name: "destToken", type: "address" },
          { internalType: "uint256", name: "fromAmount", type: "uint256" },
          { internalType: "uint256", name: "toAmount", type: "uint256" },
          { internalType: "uint256", name: "quotedAmount", type: "uint256" },
          { internalType: "bytes32", name: "metadata", type: "bytes32" },
          {
            internalType: "address payable",
            name: "beneficiary",
            type: "address",
          },
        ],
        internalType: "struct AugustusV6_2.GenericData",
        name: "swapData",
        type: "tuple",
      },
      { internalType: "uint256", name: "partnerAndFee", type: "uint256" },
      { internalType: "bytes", name: "permit", type: "bytes" },
      { internalType: "bytes", name: "executorData", type: "bytes" },
    ],
    name: "swapExactAmountIn",
    outputs: [
      { internalType: "uint256", name: "receivedAmount", type: "uint256" },
      { internalType: "uint256", name: "paraswapShare", type: "uint256" },
      { internalType: "uint256", name: "partnerShare", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  // Add more if needed, e.g., swapExactAmountOut
];

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

    const iface = new Interface(uniswapV4PoolManagerAbi);
    const swapSelector = iface.getFunction("swap")!.selector;
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolIds = new Set<string>();
    const poolKeys: {
      [poolId: string]: { currency0: string; currency1: string };
    } = {};

    // Collect transfers to infer tokens if needed
    const transfers: Transfer[] = [];
    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed) {
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

    // Get transaction trace to find internal swap calls
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
        }
      } catch {
        console.warn(`Failed to parse direct swap call.`);
      }
    }

    // Parse Swap events from logs
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
              tick: parsedLog.args.tick,
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
      if (!poolKey) {
        // Skip the query entirely - go straight to enhanced inference
        console.log(`No poolKey from trace; inferring from transfers...`);
        console.log(`Inferring poolKey from transfers...`);
        const allTransfers = transfers; // Already collected
        const transferTokens = [
          ...new Set(allTransfers.map((t) => t.token.toLowerCase())),
        ];

        if (transferTokens.length < 2) {
          console.warn(`Insufficient transfers for inference. Skipping.`);
          continue;
        }

        // Match tokens to amounts (find transfer value matching |amount0| or |amount1|)
        let inputToken: string | null = null;
        let outputToken: string | null = null;
        const absAmount0 = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
        const absAmount1 = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;

        for (const t of allTransfers) {
          const absValue = t.value < 0n ? -t.value : t.value; // Assuming positive
          if (absValue === absAmount0) {
            inputToken = t.token.toLowerCase(); // Assume positive amount is input
          } else if (absValue === absAmount1) {
            outputToken = t.token.toLowerCase();
          }
        }

        if (!inputToken || !outputToken || inputToken === outputToken) {
          // Fallback: Assume first two tokens (common for simple swaps)
          [inputToken, outputToken] = transferTokens.slice(0, 2);
          console.warn(
            `Amount matching failed; assuming first two tokens: ${inputToken}/${outputToken}`
          );
        }

        // Sort: currency0 < currency1 (V4 order)
        const currencies = [inputToken!, outputToken!].sort();
        poolKey = { currency0: currencies[0], currency1: currencies[1] };

        // Optional: Verify PoolId (assume default fee=3000, tickSpacing=60, hooks=0x0 for Uniswap pools)
        const assumedFee = 3000; // uint24
        const assumedTickSpacing = 60; // int24
        const assumedHooks = "0x0000000000000000000000000000000000000000"; // address
        const testPoolId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [
              poolKey.currency0,
              poolKey.currency1,
              assumedFee,
              assumedTickSpacing,
              assumedHooks,
            ]
          )
        );
        if (testPoolId.toLowerCase() !== swap.pool.toLowerCase()) {
          console.warn(
            `Inferred PoolId ${testPoolId} != event PoolId ${swap.pool}; may be wrong fee/hooks.`
          );
        } else {
          console.log(`PoolId verified!`);
        }

        tokenAddresses.add(poolKey.currency0);
        tokenAddresses.add(poolKey.currency1);
        // Fetch missing token infos
        if (!tokenInfos[poolKey.currency0]) {
          const info = await getTokenInfo(poolKey.currency0);
          tokenInfos[poolKey.currency0] = info;
        }
        if (!tokenInfos[poolKey.currency1]) {
          const info = await getTokenInfo(poolKey.currency1);
          tokenInfos[poolKey.currency1] = info;
        }
      }

      const { currency0, currency1 } = poolKey!;
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

      // USD pricing
      let usdPrice = "0.00";
      const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"; // From constants
      if (
        outputTokenAddress.toLowerCase() === wethAddress.toLowerCase() &&
        ethUsd > 0
      ) {
        const usdNum = parseFloat(amountOutDecimal) * ethUsd;
        usdPrice = usdNum.toFixed(2);
      }

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
        usdPrice: `$${usdPrice}`,
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
