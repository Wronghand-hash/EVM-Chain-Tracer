// filename: uniswapV2&V3Bsc.ts
import { ethers, Interface as EthersInterface } from "ethers";
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
  WBNB_ADDRESS,
  V2_SYNC_EVENT_TOPIC,
  v2SyncIface,
} from "../../types/Bsc/constants";
import {
  Transfer,
  SwapEvent,
  TokenInfo,
  TradeEvent,
} from "../../types/Etherium/types";
import {
  getTokenInfo,
  getPoolTokens,
  formatAmount,
  fetchBnbPriceUsd,
} from "../../utils/bsc/utils";
import * as uniswapUniversalAbi from "../../abi/bsc/universalUniswapAbi.json";

export async function analyzeBscTransaction(txHash: string): Promise<void> {
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
    // RPC Call 3: getBlock
    externalCallCount++;
    const block = await provider.getBlock(receipt.blockNumber);
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);
    console.log(
      `Block details fetched via RPC (external call). Timestamp from block: ${timestamp} (no additional call).`
    );
    const userWallet = transaction.from.toLowerCase();
    console.log(
      `User wallet extracted from tx: ${userWallet} (no external call).`
    );
    const routerAddress = transaction.to?.toLowerCase() || "0x";
    console.log(
      `Router address extracted from tx: ${routerAddress} (no external call).`
    );
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
    console.log(`Gas used/price from receipt (no additional external call).`);
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
      console.log(`Universal Router parsed from tx data (no external call).`);
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
      console.log(
        `Log address extracted from log: ${logAddrLower} (no external call).`
      );
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
            console.log(
              `Transfer parsed from log (no external call): from ${transfer.from} to ${transfer.to}, value ${transfer.value} of token ${transfer.token}.`
            );
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
            console.log(
              `V2 Swap parsed from log (no external call): pool ${swapEvent.pool}, amount0 ${swapEvent.amount0}, amount1 ${swapEvent.amount1}.`
            );
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
            console.log(
              `V3 Swap parsed from log (no external call): pool ${swapEvent.pool}, amount0 ${swapEvent.amount0}, amount1 ${swapEvent.amount1}, tick ${swapEvent.tick}, sqrtPriceX96 ${swapEvent.sqrtPriceX96}.`
            );
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
            console.log(`Reserves parsed from Sync log (no external call).`);
          }
        } catch (e) {
          console.warn(`Failed to parse Sync event: ${e}`);
        }
      }
    }
    console.log(
      `Log parsing complete: ${swaps.length} swaps, ${transfers.length} transfers from receipt (no additional external calls).`
    );
    // --- End Log Parsing Loop ---
    // --- Mint Filtering (post-parsing for target token checks later) ---
    const mints: Transfer[] = transfers.filter(
      (t) => t.from === "0x0000000000000000000000000000000000000000"
    );
    console.log(
      `${mints.length} mints filtered from transfers (no external call).`
    );
    // --- Concurrent Data Fetching (minimized: only essentials) ---
    const tokenInfos: { [address: string]: TokenInfo } = {};
    const fetchPromises: Promise<any>[] = [];
    // 2. Fetch pool tokens (essential for pair)
    const poolAddrs = Array.from(poolAddresses);
    poolAddrs.forEach((p) => {
      fetchPromises.push(
        getPoolTokens(p).then(
          ({
            tokens,
            callsMade,
          }: {
            tokens: { token0: string; token1: string };
            callsMade: number;
          }) => {
            poolTokens[p] = tokens;
            additionalCalls += callsMade;
          }
        )
      );
    });
    // Fetch base/quote token info (from poolTokens after fetch)
    await Promise.all(fetchPromises);
    console.log(`Pool token infos and tokens fetched (external calls).`);
    // Post-fetch: Get info for token0/token1 (2 more, but concurrent next)
    const baseQuotePromises: Promise<any>[] = [];
    Object.values(poolTokens).forEach(({ token0, token1 }) => {
      if (token0 && !tokenInfos[token0]) {
        baseQuotePromises.push(
          getTokenInfo(token0).then(
            ({ info, callsMade }: { info: TokenInfo; callsMade: number }) => {
              tokenInfos[token0] = info;
              additionalCalls += callsMade;
            }
          )
        );
      }
      if (token1 && !tokenInfos[token1]) {
        baseQuotePromises.push(
          getTokenInfo(token1).then(
            ({ info, callsMade }: { info: TokenInfo; callsMade: number }) => {
              tokenInfos[token1] = info;
              additionalCalls += callsMade;
            }
          )
        );
      }
    });
    await Promise.all(baseQuotePromises);
    console.log(
      `Base/quote token infos fetched (external calls where needed).`
    );
    // --- End Concurrent Data Fetching ---
    // Conditional BNB price fetch
    let bnbUsd = 0;
    const hasWbnb = Object.values(poolTokens).some(({ token0, token1 }) =>
      [token0, token1].some((t) => t && t.toLowerCase() === WBNB_ADDRESS)
    );
    if (hasWbnb) {
      externalCallCount++;
      bnbUsd = (await fetchBnbPriceUsd()) || 0;
      console.log(`BNB USD price fetched via HTTP (external call).`);
    } else {
      console.log(`Skipping BNB USD fetch (no WBNB involvement).`);
    }
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
      console.log(
        `Mint amounts/decimals from transfers and tokenInfos (decimals may be from cache/external).`
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
      console.log(
        `Pool tokens from getPoolTokens: token0 ${token0Addr}, token1 ${token1Addr} (external call).`
      );
      const token0Info = tokenInfos[token0Addr] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[token1Addr] || UNKNOWN_TOKEN_INFO;
      console.log(
        `Token infos for ${token0Addr}: decimals ${token0Info.decimals}, symbol ${token0Info.symbol} (from cache/external); same for ${token1Addr}.`
      );
      let isToken0In: boolean;
      if (swap.protocol === "V3") {
        isToken0In = swap.amount0 > 0n;
      } else {
        // V2
        isToken0In = swap.amount0 > 0n;
      }
      console.log(
        `Input direction determined from swap amounts (no external call): isToken0In ${isToken0In}.`
      );
      // Consolidate token assignment logic
      const inputTokenAddress = isToken0In ? token0Addr : token1Addr;
      const outputTokenAddress = isToken0In ? token1Addr : token0Addr;
      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info;
      const swapAmountIn = isToken0In ? swap.amount0 : swap.amount1;
      const swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0;
      const finalAmountIn = swapAmountIn;
      const finalAmountOut = swapAmountOut;
      console.log(
        `Swap amounts assigned: in ${finalAmountIn}, out ${finalAmountOut} (from swap event, no external call).`
      );
      const amountInDecimal = parseFloat(
        ethers.formatUnits(finalAmountIn, inputInfo.decimals)
      );
      const amountOutDecimal = parseFloat(
        ethers.formatUnits(finalAmountOut, outputInfo.decimals)
      );
      console.log(
        `Decimal-formatted amounts: in ${amountInDecimal}, out ${amountOutDecimal} (using decimals from tokenInfo).`
      );
      // --- Price Calculation ---
      let spotNum =
        amountOutDecimal > 0 ? amountInDecimal / amountOutDecimal : 0;
      console.log(
        `Initial spot price calculated from amounts: ${spotNum} (no external call).`
      );
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
          console.log(
            `V2 spot price updated from reserves: ${spotNum} (reserves from Sync log, no external call).`
          );
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
        console.log(
          `V3 spot price calculated from sqrtPriceX96: ${spotNum} (from swap event, no external call).`
        );
      }
      // --- End Price Calculation ---
      // --- USD CALCULATION (Standardized to base token pricing) ---
      let totalUsdVolume = 0;
      let usdPerBaseToken = 0;
      let spotNumWbnbPerBase = 0;
      let baseSymbol = "";
      let baseTokenAddress = "";
      let baseInfo: TokenInfo = UNKNOWN_TOKEN_INFO;
      let amountBaseDecimal = 0;
      const isInputWBNB = inputTokenAddress.toLowerCase() === WBNB_ADDRESS;
      const isOutputWBNB = outputTokenAddress.toLowerCase() === WBNB_ADDRESS;
      const isWbnbInvolved = isInputWBNB || isOutputWBNB;
      const stableSymbols = ["USDT", "USDC", "BUSD"];
      const isInputStable = stableSymbols.includes(inputInfo.symbol);
      const isOutputStable = stableSymbols.includes(outputInfo.symbol);
      console.log(
        `WBNB involvement check from addresses: involved ${isWbnbInvolved} (no external call).`
      );
      console.log(
        `Stable involvement: input ${isInputStable}, output ${isOutputStable} (no external call).`
      );

      // Determine base token: Prefer non-stable/non-WBNB token (input for SELL, output for BUY)
      let baseIsInput = false; // For SELL: true (base=input non-stable)
      if (isInputStable && !isOutputStable) {
        // BUY: stable in, non-stable out -> base = output
        baseTokenAddress = outputTokenAddress;
        baseInfo = outputInfo;
        amountBaseDecimal = amountOutDecimal;
        baseIsInput = false;
      } else if (!isInputStable && isOutputStable) {
        // SELL: non-stable in, stable out -> base = input
        baseTokenAddress = inputTokenAddress;
        baseInfo = inputInfo;
        amountBaseDecimal = amountInDecimal;
        baseIsInput = true;
      } else if (isWbnbInvolved) {
        // WBNB involved: base = non-WBNB side
        if (isInputWBNB) {
          // BUY: WBNB in, non-WBNB out
          baseTokenAddress = outputTokenAddress;
          baseInfo = outputInfo;
          amountBaseDecimal = amountOutDecimal;
          baseIsInput = false;
        } else {
          // SELL: non-WBNB in, WBNB out
          baseTokenAddress = inputTokenAddress;
          baseInfo = inputInfo;
          amountBaseDecimal = amountInDecimal;
          baseIsInput = true;
        }
      } else {
        // No stable/WBNB: fallback to input as base, USD=0
        baseTokenAddress = inputTokenAddress;
        baseInfo = inputInfo;
        amountBaseDecimal = amountInDecimal;
        baseIsInput = true;
      }
      baseSymbol = baseInfo.symbol;

      if (isWbnbInvolved && bnbUsd > 0 && spotNum > 0) {
        // WBNB pricing: spotNum = input/output
        let usdPerQuote = 0;
        if (baseIsInput) {
          // SELL: base in, WBNB out -> spotNum = base / WBNB, so USD per base = bnbUsd / spotNum
          usdPerQuote = bnbUsd;
          usdPerBaseToken = usdPerQuote / spotNum;
        } else {
          // BUY: WBNB in, base out -> spotNum = WBNB / base, so USD per base = spotNum * bnbUsd
          usdPerQuote = bnbUsd;
          usdPerBaseToken = spotNum * usdPerQuote;
        }
        totalUsdVolume = amountBaseDecimal * usdPerBaseToken;
        console.log(
          `WBNB pricing: USD per ${baseSymbol} ${usdPerBaseToken} (using BNB price ${bnbUsd}, spot ${spotNum}). Total volume: ${totalUsdVolume}`
        );
      } else if ((isInputStable || isOutputStable) && spotNum > 0) {
        // Stable pricing (peg=1)
        let usdPerQuote = 1; // USDT/USDC/BUSD peg
        if (baseIsInput) {
          // SELL: base in, stable out -> spotNum = base / stable, so USD per base = 1 / spotNum
          usdPerBaseToken = usdPerQuote / spotNum;
        } else {
          // BUY: stable in, base out -> spotNum = stable / base, so USD per base = spotNum * 1
          usdPerBaseToken = spotNum * usdPerQuote;
        }
        totalUsdVolume = amountBaseDecimal * usdPerBaseToken;
        console.log(
          `Stable pricing: USD per ${baseSymbol} ${usdPerBaseToken} (using peg ${usdPerQuote}, spot ${spotNum}). Total volume: ${totalUsdVolume}`
        );
      } else {
        // No WBNB/stable: USD=0
        console.log(
          "Warning: USD volume approximated as neither WBNB nor stablecoin is in this pair."
        );
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
            targetTokenMintAmount,
            baseInfo.decimals
          )} tokens`
        );
        console.log(`Mint amount summed from transfers (no external call).`);
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
      console.log(`Swap details from event (no external call).`);
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
        `Spot Price: ${formatTinyNum(spotNum)} ${inputInfo.symbol} per ${
          outputInfo.symbol
        } | USD per ${baseSymbol}: ${usdPerBaseToken.toFixed(
          6
        )} | Total Volume: ${totalUsdVolume.toFixed(6)}`
      );
      console.log(
        `Formatted amounts/prices using decimals/symbols from tokenInfo.`
      );
      // Construct TradeEvent
      tradeEvents.push({
        event: `Swap${index + 1}`,
        status: "Success ✅",
        txHash,
        timestamp,
        usdPrice: usdPerBaseToken.toFixed(10),
        nativePrice: `${formatTinyNum(spotNum)} ${inputInfo.symbol}/${
          outputInfo.symbol
        }`,
        volume: totalUsdVolume.toFixed(10),
        inputVolume: finalAmountIn.toString(),
        mint: baseTokenAddress,
        targetTokenMint: targetTokenMintAmount
          ? targetTokenMintAmount.toString()
          : "",
        type:
          outputInfo.symbol !== "WBNB" &&
          !stableSymbols.includes(outputInfo.symbol)
            ? "BUY"
            : "SELL",
        pairAddress: swap.pool,
        programId: routerAddress,
        quoteToken: inputTokenAddress,
        baseDecimals: baseInfo.decimals,
        quoteDecimals: inputInfo.decimals,
        tradeType: `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
        protocol: swap.protocol,
      });
      console.log(
        `TradeEvent constructed from parsed data (no external call).`
      );
    }
    // --- End Swap Analysis Loop ---
    // Net BNB Inflow Calculation (minimized: skipped to avoid calls)
    console.log(
      "Net BNB Flow: Skipped (historical balances require archive RPC)"
    );
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
      console.log(
        "\n⚠️ No TradeEvents constructed: No valid swaps or transfers found."
      );
    }
    // Final log for external calls
    const totalCalls = externalCallCount + additionalCalls;
    console.log(
      `\nTotal external calls made: ${totalCalls} (RPC: ~${
        totalCalls - (hasWbnb ? 1 : 0)
      }, HTTP: ${hasWbnb ? 1 : 0})`
    );
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
