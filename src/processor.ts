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
} from "./types/constants";
import { Transfer, SwapEvent, TokenInfo, TradeEvent } from "./types/types";
import {
  isV2Pool,
  getTokenInfo,
  getPoolTokens,
  formatAmount,
} from "./utils/utils";
import * as uniswapUniversalAbi from "./abi/uniswapUniversalAbi.json";

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
