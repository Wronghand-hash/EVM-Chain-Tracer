import { ethers } from "ethers";
import {
  provider,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
  V4_SWAP_EVENT_TOPIC,
  transferIface,
  v4SwapIface,
  UNKNOWN_TOKEN_INFO,
  WETH_ADDRESS,
  V3_SWAP_EVENT_TOPIC,
  v3SwapIface,
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
    const v4Swaps: SwapEvent[] = [];
    const v3Swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const v4PoolIds = new Set<string>();
    const v3PoolIds = new Set<string>();
    const poolKeysV4: {
      [poolId: string]: { currency0: string; currency1: string };
    } = {};
    const poolKeysV3: {
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
        poolKeysV4[poolId] = {
          currency0: key.currency0.toLowerCase(),
          currency1: key.currency1.toLowerCase(),
        };
        tokenAddresses.add(key.currency0.toLowerCase());
        tokenAddresses.add(key.currency1.toLowerCase());
        v4PoolIds.add(poolId);
      }
    } catch {
      console.warn(`Failed to parse direct swap call.`);
    }
    const poolManagerAddress = UNISWAP_V4_POOL_MANAGER_ADDRESS.toLowerCase();
    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      if (
        logAddrLower === poolManagerAddress &&
        topic0 === V4_SWAP_EVENT_TOPIC.toLowerCase()
      ) {
        try {
          const parsedLog = v4SwapIface.parseLog(log);
          if (parsedLog) {
            const { amount0, amount1 } = parsedLog.args;
            if (amount0 === 0n && amount1 === 0n) continue;
            const poolId = parsedLog.args.id.toLowerCase();
            v4Swaps.push({
              pool: poolId,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: parsedLog.args.recipient?.toLowerCase() || userWallet,
              amount0,
              amount1,
              protocol: "V4",
              tick: Number(parsedLog.args.tick),
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: parsedLog.args.liquidity,
            });
            v4PoolIds.add(poolId);
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
    if (v4Swaps.length === 0) {
      console.log("No V4 Swap events found.");
    }
    // Infer V4 Pool Keys from Initialize Event
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
            poolKeysV4[poolId] = { currency0, currency1 };
            tokenAddresses.add(currency0);
            tokenAddresses.add(currency1);
            v4PoolIds.add(poolId);
          }
        } catch (e) {
          console.warn(
            `Failed to parse V4 Initialize event: ${(e as Error).message}`
          );
        }
      }
    }
    // Build valueToTokens map for transfer matching
    const valueToTokens: { [valueStr: string]: string[] } = {};
    for (const t of transfers) {
      const valStr = t.value.toString();
      if (!valueToTokens[valStr]) {
        valueToTokens[valStr] = [];
      }
      if (!valueToTokens[valStr].includes(t.token)) {
        valueToTokens[valStr].push(t.token);
      }
    }
    const hasEthInput = transaction.value > 0n;

    // --- START: V4 Pool Key Inference (Updated) ---
    const poolToSwapsV4: { [poolId: string]: SwapEvent[] } = {};
    for (const swap of v4Swaps) {
      if (!poolToSwapsV4[swap.pool]) {
        poolToSwapsV4[swap.pool] = [];
      }
      poolToSwapsV4[swap.pool].push(swap);
    }

    for (const swap of v4Swaps) {
      const poolId = swap.pool;
      if (poolKeysV4[poolId]) continue; // Skip if already inferred from Initialize or call data
      let inAmount: bigint;
      let outAmount: bigint;
      if (swap.amount0 > 0n && swap.amount1 < 0n) {
        inAmount = swap.amount0;
        outAmount = -swap.amount1;
      } else if (swap.amount0 < 0n && swap.amount1 > 0n) {
        inAmount = swap.amount1;
        outAmount = -swap.amount0;
      } else {
        continue;
      }
      let inputToken: string | null = null;
      const inValStr = inAmount.toString();
      if (valueToTokens[inValStr]) {
        const cands = valueToTokens[inValStr].filter(
          (t) => t !== WETH_ADDRESS.toLowerCase()
        );
        inputToken = cands.length > 0 ? cands[0] : valueToTokens[inValStr][0];
      }
      let outputToken: string | null = null;
      const outValStr = outAmount.toString();
      if (valueToTokens[outValStr]) {
        const cands = valueToTokens[outValStr].filter(
          (t) => t !== WETH_ADDRESS.toLowerCase()
        );
        outputToken = cands.length > 0 ? cands[0] : valueToTokens[outValStr][0];
      }
      let currencies: string[] = [];
      if (inputToken && outputToken && inputToken !== outputToken) {
        currencies = [inputToken, outputToken].sort();
      } else if (inputToken && inputToken !== WETH_ADDRESS.toLowerCase()) {
        currencies = [inputToken, WETH_ADDRESS].sort();
      } else if (outputToken && outputToken !== WETH_ADDRESS.toLowerCase()) {
        currencies = [outputToken, WETH_ADDRESS].sort();
      }
      if (currencies.length === 2) {
        poolKeysV4[poolId] = {
          currency0: currencies[0],
          currency1: currencies[1],
        };
        tokenAddresses.add(currencies[0]);
        tokenAddresses.add(currencies[1]);
        console.log(
          `Inferred V4 poolKey from transfer values for ${poolId}: ${currencies[0]}/${currencies[1]}`
        );
      }
    }
    // Fallback for V4 pool key inference
    for (const poolId of v4PoolIds) {
      if (poolKeysV4[poolId]) continue;
      if (!poolToSwapsV4[poolId]) continue;
      const relevantValues = new Set<string>();
      for (const swap of poolToSwapsV4[poolId]) {
        relevantValues.add(swap.amount0.toString().replace("-", ""));
        relevantValues.add(swap.amount1.toString().replace("-", ""));
      }
      const matchedTokens = new Set<string>();
      for (const valStr of relevantValues) {
        if (valueToTokens[valStr]) {
          for (const tok of valueToTokens[valStr]) {
            matchedTokens.add(tok);
          }
        }
      }
      let currency0: string, currency1: string;
      const matchedArray = Array.from(matchedTokens);
      if (matchedArray.length === 2) {
        [currency0, currency1] = matchedArray.sort();
      } else if (matchedArray.length === 1) {
        const tokenA = matchedArray[0];
        if (tokenA === WETH_ADDRESS.toLowerCase()) continue;
        const pair = [tokenA, WETH_ADDRESS].sort();
        currency0 = pair[0];
        currency1 = pair[1];
        console.warn(
          `Inferred V4 poolKey (HEURISTIC: 1 matched + WETH) for ${poolId}: ${currency0}/${currency1}`
        );
      } else {
        console.warn(`Cannot infer V4 poolKey for ${poolId}. Skipping pool.`);
        continue;
      }
      poolKeysV4[poolId] = { currency0, currency1 };
      tokenAddresses.add(currency0);
      tokenAddresses.add(currency1);
    }
    // --- END: V4 Pool Key Inference ---

    // Process V3 inference (unchanged, as V3 is typically a single swap per log)
    for (const swap of v3Swaps) {
      const poolId = swap.pool;
      if (poolKeysV3[poolId]) continue;
      let inAmount: bigint;
      let outAmount: bigint;
      if (swap.amount0 > 0n && swap.amount1 < 0n) {
        inAmount = swap.amount0;
        outAmount = -swap.amount1;
      } else if (swap.amount0 < 0n && swap.amount1 > 0n) {
        inAmount = swap.amount1;
        outAmount = -swap.amount0;
      } else {
        continue;
      }
      const poolAddress = poolId;
      let inputToken: string | null = null;
      const inValStr = inAmount.toString();
      if (valueToTokens[inValStr]) {
        const cands = valueToTokens[inValStr].filter(
          (t) => t !== WETH_ADDRESS.toLowerCase()
        );
        inputToken = cands.length > 0 ? cands[0] : valueToTokens[inValStr][0];
      }
      let outputToken: string | null = null;
      const outValStr = outAmount.toString();
      if (valueToTokens[outValStr]) {
        const cands = valueToTokens[outValStr].filter(
          (t) => t !== WETH_ADDRESS.toLowerCase()
        );
        outputToken = cands.length > 0 ? cands[0] : valueToTokens[outValStr][0];
      }
      let currencies: string[] = [];
      if (inputToken && outputToken && inputToken !== outputToken) {
        currencies = [inputToken, outputToken].sort();
      } else if (inputToken && inputToken !== WETH_ADDRESS.toLowerCase()) {
        currencies = [inputToken, WETH_ADDRESS].sort();
      } else if (outputToken && outputToken !== WETH_ADDRESS.toLowerCase()) {
        currencies = [outputToken, WETH_ADDRESS].sort();
      }
      if (currencies.length === 2) {
        poolKeysV3[poolId] = {
          currency0: currencies[0],
          currency1: currencies[1],
        };
        tokenAddresses.add(currencies[0]);
        tokenAddresses.add(currencies[1]);
        console.log(
          `Inferred V3 poolKey from transfer values for ${poolId}: ${currencies[0]}/${currencies[1]}`
        );
      }
    }
    // Fallback for V3
    for (const poolId of v3PoolIds) {
      if (poolKeysV3[poolId]) continue;
      const relevantValues = new Set<string>();
      relevantValues.add(
        v3Swaps
          .find((s) => s.pool === poolId)
          ?.amount0.toString()
          .replace("-", "") || "0"
      );
      relevantValues.add(
        v3Swaps
          .find((s) => s.pool === poolId)
          ?.amount1.toString()
          .replace("-", "") || "0"
      );
      const matchedTokens = new Set<string>();
      for (const valStr of relevantValues) {
        if (valueToTokens[valStr]) {
          for (const tok of valueToTokens[valStr]) {
            matchedTokens.add(tok);
          }
        }
      }
      let currency0: string, currency1: string;
      const matchedArray = Array.from(matchedTokens);
      if (matchedArray.length === 2) {
        [currency0, currency1] = matchedArray.sort();
      } else if (matchedArray.length === 1) {
        const tokenA = matchedArray[0];
        if (tokenA === WETH_ADDRESS.toLowerCase()) continue;
        const pair = [tokenA, WETH_ADDRESS].sort();
        currency0 = pair[0];
        currency1 = pair[1];
        console.warn(
          `Inferred V3 poolKey (HEURISTIC: 1 matched + WETH) for ${poolId}: ${currency0}/${currency1}`
        );
      } else {
        console.warn(`Cannot infer V3 poolKey for ${poolId}. Skipping pool.`);
        continue;
      }
      poolKeysV3[poolId] = { currency0, currency1 };
      tokenAddresses.add(currency0);
      tokenAddresses.add(currency1);
    }
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
    // --- DEBUGGING: Log Decimals ---
    for (const addr in tokenInfos) {
      const info = tokenInfos[addr];
      console.log(
        `[DEBUG] Token ${info.symbol} (${addr}) Decimals: ${info.decimals}`
      );
    }
    // --- END DEBUGGING ---
    const ethUsd = (await fetchEthPriceUsd()) || 0;
    const tradeEvents: TradeEvent[] = [];
    // --- START: V4 Trade Event Processing (Fixed to process individual swaps) ---
    let v4Index = 1;
    for (const swap of v4Swaps) {
      const poolId = swap.pool;
      const poolKey = poolKeysV4[poolId];
      if (!poolKey) {
        console.warn(`No V4 poolKey for swap ${v4Index}. Skipping.`);
        v4Index++;
        continue;
      }
      const { currency0, currency1 } = poolKey;
      const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;
      const isEthSideCurrency0 =
        currency0 === ETH_ADDRESS || currency0 === WETH_ADDRESS.toLowerCase();
      const baseAddress = isEthSideCurrency0 ? currency1 : currency0;
      const baseInfo = tokenInfos[baseAddress] || UNKNOWN_TOKEN_INFO;
      let isToken0In: boolean;
      let eventAmountIn: bigint = 0n;
      let eventAmountOut: bigint = 0n;
      // Determine IN/OUT based on the pool deltas
      if (swap.amount0 > 0n && swap.amount1 < 0n) {
        // Pool received Token 0, sent Token 1
        isToken0In = true;
        eventAmountIn = swap.amount0;
        eventAmountOut = -swap.amount1;
      } else if (swap.amount0 < 0n && swap.amount1 > 0n) {
        // Pool sent Token 0, received Token 1
        isToken0In = false;
        eventAmountIn = swap.amount1;
        eventAmountOut = -swap.amount0;
      } else {
        console.warn(`Invalid V4 swap deltas for swap ${v4Index}. Skipping.`);
        v4Index++;
        continue;
      }
      const inputTokenAddress = isToken0In ? currency0 : currency1;
      const outputTokenAddress = isToken0In ? currency1 : currency0;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;
      // Determine the user's trade direction (BUY/SELL)
      // If Base Token is output, it's a BUY. If Base Token is input, it's a SELL.
      const isBuy = outputTokenAddress === baseAddress;
      // Use the event amounts as the trade amounts.
      const swapAmountIn = eventAmountIn;
      const swapAmountOut = eventAmountOut;
      if (swapAmountIn === 0n || swapAmountOut === 0n) {
        console.warn(`V4 swap amounts are zero for swap ${v4Index}. Skipping.`);
        v4Index++;
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
      // Determine ETH-side and Base-side for price calculation
      let ethSideAmount: bigint;
      let baseSideAmount: bigint;
      let baseSideInfo: TokenInfo;
      const isInputEthSide =
        inputTokenAddress === ETH_ADDRESS ||
        inputTokenAddress === WETH_ADDRESS.toLowerCase();
      if (isInputEthSide) {
        ethSideAmount = swapAmountIn;
        baseSideAmount = swapAmountOut;
        baseSideInfo = outputInfo;
      } else {
        ethSideAmount = swapAmountOut;
        baseSideAmount = swapAmountIn;
        baseSideInfo = inputInfo;
      }
      const ethDeltaDecimal = ethers.formatUnits(ethSideAmount, 18);
      const baseDeltaDecimal = ethers.formatUnits(
        baseSideAmount,
        baseSideInfo.decimals
      );
      // --- Price Calculation (Updated for robustness and clarity) ---
      // 1. Effective Price (calculated directly from trade amounts)
      const effectiveEthPerBaseNum =
        parseFloat(ethDeltaDecimal) / parseFloat(baseDeltaDecimal) || 0;
      const effectiveBasePerEthNum =
        effectiveEthPerBaseNum > 0 ? 1 / effectiveEthPerBaseNum : 0;
      // 2. Spot Price (calculated from sqrtPriceX96 log)
      let spotEthPerBaseNum = 0;
      if (swap.sqrtPriceX96 && swap.sqrtPriceX96 !== 0n) {
        const Q96 = Math.pow(2, 96);
        const sqrtPriceNum = Number(swap.sqrtPriceX96) / Q96;
        // Price of token1 expressed in terms of token0 (P_{1/0})
        const price1Per0 = sqrtPriceNum * sqrtPriceNum;
        // Account for decimals
        // price1Per0 is in units of token0 per token1.
        // Assuming currency0 is token0 and currency1 is token1
        let token0PerToken1 = price1Per0;
        if (token0Info.decimals !== token1Info.decimals) {
          const diff = token1Info.decimals - token0Info.decimals;
          token0PerToken1 = token0PerToken1 * Math.pow(10, diff);
        }
        let isEthSideCurrency0Spot = isEthSideCurrency0;
        let ethPerBaseSpot: number;
        let basePerEthSpot: number;
        if (isEthSideCurrency0Spot) {
          // currency0 is ETH, currency1 is BASE
          // price1Per0 is BASE per ETH (P_BASE/ETH)
          basePerEthSpot = token0PerToken1;
          ethPerBaseSpot = basePerEthSpot > 0 ? 1 / basePerEthSpot : 0;
        } else {
          // currency1 is ETH, currency0 is BASE
          // price1Per0 is ETH per BASE (P_ETH/BASE)
          ethPerBaseSpot = token0PerToken1;
          basePerEthSpot = ethPerBaseSpot > 0 ? 1 / ethPerBaseSpot : 0;
        }
        spotEthPerBaseNum = ethPerBaseSpot;
      }

      const spotBasePerEthNum =
        spotEthPerBaseNum > 0 ? 1 / spotEthPerBaseNum : 0;

      // --- Price Inversion Logic for Display ---
      const NATIVE_PRICE_THRESHOLD = 1000;
      let isPriceInverted = false;
      let finalNativePriceStr: string;
      let finalSpotPriceStr: string;
      let finalPriceLabel: string;
      let finalUsdPrice: number;
      let usdPriceLabel: string;

      if (effectiveEthPerBaseNum > NATIVE_PRICE_THRESHOLD) {
        // Price of 1 BASE is extremely high (e.g., > 1000 ETH), so display the inverse (BASE per ETH)
        isPriceInverted = true;
        finalNativePriceStr = effectiveBasePerEthNum.toPrecision(10); // P_BASE/ETH (Effective)
        finalSpotPriceStr = spotBasePerEthNum.toPrecision(10); // P_BASE/ETH (Spot)

        finalPriceLabel = `${baseInfo.symbol} per ETH`;

        // FIX: Override USD Price Calculation to use the user's desired formula:
        // P_USD = P_USD/ETH * P_NATIVE (where P_NATIVE is the small displayed price P_BASE/ETH)
        // This gives the USD per BASE price expected for a low-value token.
        finalUsdPrice = spotBasePerEthNum * ethUsd;
        usdPriceLabel = `USD per ${baseInfo.symbol}`;
      } else {
        // Standard case: display ETH per BASE
        isPriceInverted = false;
        finalNativePriceStr = effectiveEthPerBaseNum.toPrecision(10); // P_ETH/BASE (Effective)
        finalSpotPriceStr = spotEthPerBaseNum.toPrecision(10); // P_ETH/BASE (Spot)
        finalPriceLabel = `ETH per ${baseInfo.symbol}`;
        usdPriceLabel = `USD per ${baseInfo.symbol}`;
        // The USD price of the Base Token (BASE)
        finalUsdPrice = spotEthPerBaseNum * ethUsd; // USD per BASE
      }

      // Update final USD price string format
      const finalUsdPriceStr = `$${finalUsdPrice.toFixed(4)}`; // Use 4 decimal places for small USD prices

      // Calculate trade value and volume
      const usdPerBase = spotEthPerBaseNum * ethUsd;
      const inputPrice = isInputEthSide ? ethUsd : usdPerBase;
      const tradeUsdValue = parseFloat(amountInDecimal) * inputPrice;
      const volumeUsdStr = `$${tradeUsdValue.toFixed(2)}`;
      const tradeUsdValueStr = `$${tradeUsdValue.toFixed(2)}`;

      // Console Log Output
      console.log(
        `\n--- Formatted V4 Swap ${v4Index} (${isBuy ? "BUY" : "SELL"}) ---`
      );
      console.log(
        `Pair: ${inputInfo.symbol}/${outputInfo.symbol}\nInput: ${amountInDecimal} ${inputInfo.symbol}\nOutput: ${amountOutDecimal} ${outputInfo.symbol}`
      );
      console.log(`Effective Price: ${finalNativePriceStr} ${finalPriceLabel}`);
      console.log(
        `Spot Price: ${finalSpotPriceStr} ${finalPriceLabel} | ${usdPriceLabel}: ${finalUsdPriceStr} | Trade Value: ${tradeUsdValueStr} | Volume USD: ${volumeUsdStr}`
      );

      // Final Trade Event JSON
      tradeEvents.push({
        event: `V4-Swap${v4Index}`,
        status: "Success ✅",
        txHash: txHash,
        timestamp: timestamp,
        usdPrice: finalUsdPriceStr,
        nativePrice: finalNativePriceStr,
        volume: tradeUsdValueStr,
        inputVolume: amountInDecimal,
        mint: baseAddress,
        type: isBuy ? "BUY" : "SELL",
        pairAddress: swap.pool,
        programId: contractAddress,
        quoteToken: ETH_ADDRESS,
        baseDecimals: baseInfo.decimals,
        quoteDecimals: 18,
        tradeType: `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
        protocol: "V4",
        targetTokenMint: "",
      });
      v4Index++;
    }
    // --- END: V4 Trade Event Processing ---

    // Process V3 Swaps
    let v3Index = 1;
    for (const log of receipt.logs) {
      const topic0 = log.topics[0]?.toLowerCase();
      if (topic0 === V3_SWAP_EVENT_TOPIC?.toLowerCase()) {
        try {
          const parsedLog = v3SwapIface.parseLog(log);
          if (parsedLog) {
            const { amount0, amount1 } = parsedLog.args;
            if (amount0 === 0n && amount1 === 0n) continue;
            const poolAddress = log.address.toLowerCase();
            v3Swaps.push({
              pool: poolAddress,
              sender: parsedLog.args.sender.toLowerCase(),
              recipient: parsedLog.args.recipient.toLowerCase() || userWallet,
              amount0,
              amount1,
              protocol: "V3",
              tick: Number(parsedLog.args.tick),
              sqrtPriceX96: parsedLog.args.sqrtPriceX96,
              liquidity: 0n, // Not available in V3 Swap event
            });
            v3PoolIds.add(poolAddress);
          }
        } catch (e) {
          console.warn(
            `Failed to parse V3 Swap event for log ${log.index}: ${
              (e as Error).message
            }`
          );
        }
      }
    }
    for (const swap of v3Swaps) {
      const poolId = swap.pool;
      const poolKey = poolKeysV3[poolId];
      if (!poolKey) {
        console.warn(`No V3 poolKey for swap ${v3Index}. Skipping.`);
        v3Index++;
        continue;
      }
      const { currency0, currency1 } = poolKey;
      const token0Info = tokenInfos[currency0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[currency1] || UNKNOWN_TOKEN_INFO;
      const isEthSideCurrency0 =
        currency0 === ETH_ADDRESS || currency0 === WETH_ADDRESS.toLowerCase();
      const baseAddress = isEthSideCurrency0 ? currency1 : currency0;
      const baseInfo = tokenInfos[baseAddress] || UNKNOWN_TOKEN_INFO;
      let isToken0In: boolean;
      let eventAmountIn: bigint = 0n;
      let eventAmountOut: bigint = 0n;
      // Determine IN/OUT based on the pool deltas
      if (swap.amount0 > 0n && swap.amount1 < 0n) {
        // Pool received Token 0, sent Token 1
        isToken0In = true;
        eventAmountIn = swap.amount0;
        eventAmountOut = -swap.amount1;
      } else if (swap.amount0 < 0n && swap.amount1 > 0n) {
        // Pool sent Token 0, received Token 1
        isToken0In = false;
        eventAmountIn = swap.amount1;
        eventAmountOut = -swap.amount0;
      } else {
        console.warn(`Invalid V3 swap deltas for swap ${v3Index}. Skipping.`);
        v3Index++;
        continue;
      }
      const inputTokenAddress = isToken0In ? currency0 : currency1;
      const outputTokenAddress = isToken0In ? currency1 : currency0;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;
      // Determine the user's trade direction (BUY/SELL)
      // If Base Token is output, it's a BUY. If Base Token is input, it's a SELL.
      const isBuy = outputTokenAddress === baseAddress;
      // Use the event amounts as the trade amounts.
      const swapAmountIn = eventAmountIn;
      const swapAmountOut = eventAmountOut;
      if (swapAmountIn === 0n || swapAmountOut === 0n) {
        console.warn(`V3 swap amounts are zero for swap ${v3Index}. Skipping.`);
        v3Index++;
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
      // Determine ETH-side and Base-side for price calculation
      let ethSideAmount: bigint;
      let baseSideAmount: bigint;
      let baseSideInfo: TokenInfo;
      const isInputEthSide =
        inputTokenAddress === ETH_ADDRESS ||
        inputTokenAddress === WETH_ADDRESS.toLowerCase();
      if (isInputEthSide) {
        ethSideAmount = swapAmountIn;
        baseSideAmount = swapAmountOut;
        baseSideInfo = outputInfo;
      } else {
        ethSideAmount = swapAmountOut;
        baseSideAmount = swapAmountIn;
        baseSideInfo = inputInfo;
      }
      const ethDeltaDecimal = ethers.formatUnits(ethSideAmount, 18);
      const baseDeltaDecimal = ethers.formatUnits(
        baseSideAmount,
        baseSideInfo.decimals
      );
      // --- Price Calculation (Updated for robustness and clarity) ---
      // 1. Effective Price (calculated directly from trade amounts)
      const effectiveEthPerBaseNum =
        parseFloat(ethDeltaDecimal) / parseFloat(baseDeltaDecimal) || 0;
      const effectiveBasePerEthNum =
        effectiveEthPerBaseNum > 0 ? 1 / effectiveEthPerBaseNum : 0;
      // 2. Spot Price (calculated from sqrtPriceX96 log)
      let spotEthPerBaseNum = 0;
      if (swap.sqrtPriceX96 && swap.sqrtPriceX96 !== 0n) {
        const Q96 = Math.pow(2, 96);
        const sqrtPriceNum = Number(swap.sqrtPriceX96) / Q96;
        // Price of token1 expressed in terms of token0 (P_{1/0})
        const price1Per0 = sqrtPriceNum * sqrtPriceNum;
        // Account for decimals
        // price1Per0 is in units of token0 per token1.
        // Assuming currency0 is token0 and currency1 is token1
        let token0PerToken1 = price1Per0;
        if (token0Info.decimals !== token1Info.decimals) {
          const diff = token1Info.decimals - token0Info.decimals;
          token0PerToken1 = token0PerToken1 * Math.pow(10, diff);
        }
        let isEthSideCurrency0Spot = isEthSideCurrency0;
        let ethPerBaseSpot: number;
        let basePerEthSpot: number;
        if (isEthSideCurrency0Spot) {
          // currency0 is ETH, currency1 is BASE
          // price1Per0 is BASE per ETH (P_BASE/ETH)
          basePerEthSpot = token0PerToken1;
          ethPerBaseSpot = basePerEthSpot > 0 ? 1 / basePerEthSpot : 0;
        } else {
          // currency1 is ETH, currency0 is BASE
          // price1Per0 is ETH per BASE (P_ETH/BASE)
          ethPerBaseSpot = token0PerToken1;
          basePerEthSpot = ethPerBaseSpot > 0 ? 1 / ethPerBaseSpot : 0;
        }
        spotEthPerBaseNum = ethPerBaseSpot;
      }

      const spotBasePerEthNum =
        spotEthPerBaseNum > 0 ? 1 / spotEthPerBaseNum : 0;

      // --- Price Inversion Logic for Display (V3) ---
      const NATIVE_PRICE_THRESHOLD = 1000;
      let isPriceInverted = false;
      let finalNativePriceStr: string;
      let finalSpotPriceStr: string;
      let finalPriceLabel: string;
      let finalUsdPrice: number;
      let usdPriceLabel: string;

      if (effectiveEthPerBaseNum > NATIVE_PRICE_THRESHOLD) {
        // Price of 1 BASE is extremely high (e.g., > 1000 ETH), so display the inverse (BASE per ETH)
        isPriceInverted = true;
        finalNativePriceStr = effectiveBasePerEthNum.toPrecision(10); // P_BASE/ETH (Effective)
        finalSpotPriceStr = spotBasePerEthNum.toPrecision(10); // P_BASE/ETH (Spot)

        finalPriceLabel = `${baseInfo.symbol} per ETH`;

        // FIX: Override USD Price Calculation to use the user's desired formula:
        finalUsdPrice = spotBasePerEthNum * ethUsd;
        usdPriceLabel = `USD per ${baseInfo.symbol}`;
      } else {
        // Standard case: display ETH per BASE
        isPriceInverted = false;
        finalNativePriceStr = effectiveEthPerBaseNum.toPrecision(10); // P_ETH/BASE (Effective)
        finalSpotPriceStr = spotEthPerBaseNum.toPrecision(10); // P_ETH/BASE (Spot)
        finalPriceLabel = `ETH per ${baseInfo.symbol}`;
        usdPriceLabel = `USD per ${baseInfo.symbol}`;
        // The USD price of the Base Token (BASE)
        finalUsdPrice = spotEthPerBaseNum * ethUsd; // USD per BASE
      }

      // Update final USD price string format
      const finalUsdPriceStr = `$${finalUsdPrice.toFixed(4)}`; // Use 4 decimal places for small USD prices

      // Calculate trade value and volume
      const usdPerBase = spotEthPerBaseNum * ethUsd;
      const inputPrice = isInputEthSide ? ethUsd : usdPerBase;
      const tradeUsdValue = parseFloat(amountInDecimal) * inputPrice;
      const volumeUsdStr = `$${tradeUsdValue.toFixed(2)}`;
      const tradeUsdValueStr = `$${tradeUsdValue.toFixed(2)}`;

      // Console Log Output
      console.log(
        `\n--- Formatted V3 Swap ${v3Index} (${isBuy ? "BUY" : "SELL"}) ---`
      );
      console.log(
        `Pair: ${inputInfo.symbol}/${outputInfo.symbol}\nInput: ${amountInDecimal} ${inputInfo.symbol}\nOutput: ${amountOutDecimal} ${outputInfo.symbol}`
      );
      console.log(`Effective Price: ${finalNativePriceStr} ${finalPriceLabel}`);
      console.log(
        `Spot Price: ${finalSpotPriceStr} ${finalPriceLabel} | ${usdPriceLabel}: ${finalUsdPriceStr} | Trade Value: ${tradeUsdValueStr} | Volume USD: ${volumeUsdStr}`
      );

      const isNativeInput =
        inputTokenAddress === ETH_ADDRESS ||
        inputTokenAddress === WETH_ADDRESS.toLowerCase();
      tradeEvents.push({
        event: `V3-Swap${v3Index}`,
        status: "Success ✅",
        txHash: txHash,
        timestamp: timestamp,
        usdPrice: finalUsdPriceStr,
        nativePrice: finalNativePriceStr,
        volume: tradeUsdValueStr,
        inputVolume: amountInDecimal,
        mint: baseAddress,
        type: isBuy ? "BUY" : "SELL",
        pairAddress: poolId,
        programId: contractAddress,
        quoteToken: ETH_ADDRESS,
        baseDecimals: baseInfo.decimals,
        quoteDecimals: 18,
        tradeType: isNativeInput
          ? `ETH -> ${outputInfo.symbol}`
          : `${inputInfo.symbol} -> ETH`,
        walletAddress: userWallet,
        protocol: "V3",
        targetTokenMint: "",
      });
      v3Index++;
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
      console.log("\n⚠️ No valid TradeEvents constructed.");
    }
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
export function collectSwapCalls(
  trace: any,
  poolManager: string,
  swapSelector: string
): any[] {
  const swaps: any[] = [];
  if (!trace) return swaps;
  const calls: any[] = Array.isArray(trace) ? trace : [trace];
  for (const call of calls) {
    if (
      call.to?.toLowerCase() === poolManager.toLowerCase() &&
      call.input?.toLowerCase().startsWith(swapSelector.toLowerCase())
    ) {
      swaps.push(call);
    }
    if (call.calls) {
      swaps.push(...collectSwapCalls(call.calls, poolManager, swapSelector));
    }
  }
  return swaps;
}
