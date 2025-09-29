import { ethers, Interface, Contract } from "ethers";
import * as dotenv from "dotenv";
// Assuming these ABI files exist relative to the script
import uniswapV2Abi from "./abi/uniswapV2Abi.json";
import uniswapUniversalAbi from "./abi/uniswapUniversalAbi.json";

// Load environment variables for provider URL
dotenv.config();

// --- Interfaces ---
interface TokenInfo {
  decimals: number;
  symbol: string;
  name: string;
}
interface Transfer {
  token: string;
  from: string;
  to: string;
  value: bigint;
}
interface SwapEvent {
  pool: string;
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  tick?: number;
}
export interface TradeEvent {
  event: string;
  status: string;
  txHash: string;
  timestamp: number;
  usdPrice: string;
  nativePrice: string;
  volume: string;
  mint: string;
  type: "BUY" | "SELL" | "UNKNOWN";
  pairAddress?: string;
  programId: string;
  quoteToken: string; // The address of the token being sold/input
  baseDecimals: number; // Decimals of the token being bought/output
  quoteDecimals: number; // Decimals of the token being sold/input
  tradeType: string;
  walletAddress: string;
}

// --- Constants & ABIs ---
const uniswapV3SwapAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "recipient",
        type: "address",
      },
      {
        indexed: false,
        internalType: "int256",
        name: "amount0",
        type: "int256",
      },
      {
        indexed: false,
        internalType: "int256",
        name: "amount1",
        type: "int256",
      },
      {
        indexed: false,
        internalType: "uint160",
        name: "sqrtPriceX96",
        type: "uint160",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "liquidity",
        type: "uint128",
      },
      { indexed: false, internalType: "int24", name: "tick", type: "int24" },
    ],
    name: "Swap",
    type: "event",
  },
];
const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];
const erc20TransferAbi = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const poolAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const UNKNOWN_TOKEN_INFO: TokenInfo = {
  decimals: 18,
  symbol: "UNKNOWN",
  name: "Unknown Token",
};

const ifaceV3 = new Interface(uniswapV3SwapAbi);
// const ifaceV2 = new Interface(uniswapV2Abi); // Not used in log parsing yet
// const ifaceUniversal = new Interface(uniswapUniversalAbi); // Not used in log parsing yet
const transferIface = new Interface(erc20TransferAbi);
const SWAP_EVENT_TOPIC_V3 = ifaceV3.getEvent("Swap")?.topicHash;
const TRANSFER_TOPIC = transferIface.getEvent("Transfer")?.topicHash;
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4f27eAD9083C756Cc2".toLowerCase();

const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);

// --- Core Functions ---

/**
 * Fetches standard ERC-20 token info (decimals, symbol, name).
 * Uses WETH fallback for a known native token wrapper address.
 * No hardcoded addresses other than WETH are used.
 */
async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  const addressLower = tokenAddress.toLowerCase();
  if (addressLower === WETH_ADDRESS)
    return { decimals: 18, symbol: "WETH", name: "Wrapped Ether" };

  const contract = new Contract(tokenAddress, erc20Abi, provider);
  try {
    const [decimals, symbol, name] = await Promise.all([
      contract.decimals(),
      contract.symbol(),
      contract.name(),
    ]);
    return { decimals: Number(decimals), symbol, name };
  } catch {
    // Generic fallback if contract call fails (e.g., token is non-standard)
    return UNKNOWN_TOKEN_INFO;
  }
}

/**
 * Fetches token0 and token1 addresses from a pool contract (works for V2/V3).
 */
async function getPoolTokens(
  poolAddress: string
): Promise<{ token0: string; token1: string }> {
  const contract = new Contract(poolAddress, poolAbi, provider);
  try {
    const [token0, token1] = await Promise.all([
      contract.token0(),
      contract.token1(),
    ]);
    return { token0: token0.toLowerCase(), token1: token1.toLowerCase() };
  } catch {
    console.warn(`Could not fetch tokens for pool: ${poolAddress}`);
    return { token0: "", token1: "" };
  }
}

/**
 * Formats a BigInt amount into a human-readable string with symbol.
 */
function formatAmount(value: bigint, decimals: number, symbol: string): string {
  // Ensure positive value for formatting, as it represents an absolute amount
  const absoluteValue = value < 0n ? -value : value;
  return `${ethers.formatUnits(absoluteValue, decimals)} ${symbol}`;
}

async function analyzeTransaction(txHash: string): Promise<void> {
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
    ); // Parse Logs

    const transfers: Transfer[] = [];
    const swaps: SwapEvent[] = [];
    const tokenAddresses = new Set<string>();
    const poolAddresses = new Set<string>();

    for (const log of receipt.logs) {
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      const logAddrLower = log.address.toLowerCase();
      tokenAddresses.add(logAddrLower);

      if (topic0 === SWAP_EVENT_TOPIC_V3?.toLowerCase()) {
        try {
          const parsed = ifaceV3.parseLog(log);
          if (parsed) {
            swaps.push({
              pool: log.address.toLowerCase(),
              sender: parsed.args.sender.toLowerCase(),
              recipient: parsed.args.recipient.toLowerCase(),
              amount0: parsed.args.amount0 as bigint, // Explicitly cast
              amount1: parsed.args.amount1 as bigint, // Explicitly cast
              tick: parsed.args.tick,
            });
            poolAddresses.add(logAddrLower);
          }
        } catch (e) {
          // Attempt to parse as V2/other ABI if V3 fails
          try {
            // V2 swap logic would go here if implemented with V2 ABI
          } catch {}
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
    } // Fetch Metadata

    const tokenInfos: { [address: string]: TokenInfo } = {};
    const poolTokens: { [pool: string]: { token0: string; token1: string } } =
      {};
    await Promise.all([
      // Fetch all token info concurrently
      ...Array.from(tokenAddresses).map((t) =>
        getTokenInfo(t).then((info) => (tokenInfos[t] = info))
      ), // Fetch all pool token addresses concurrently
      ...Array.from(poolAddresses).map((p) =>
        getPoolTokens(p).then((tokens) => (poolTokens[p] = tokens))
      ),
    ]); // Process Swaps and Construct TradeEvents

    const tradeEvents: TradeEvent[] = [];
    for (const [index, swap] of swaps.entries()) {
      console.log(`\n===== Swap ${index + 1} (V3, Pool: ${swap.pool}) =====`);
      console.log(`Sender: ${swap.sender} | Recipient: ${swap.recipient}`);
      console.log(
        `Amount0: ${swap.amount0} | Amount1: ${swap.amount1} | Tick: ${swap.tick}`
      );

      const { token0, token1 } = poolTokens[swap.pool] || {
        token0: "",
        token1: "",
      };
      if (!token0 || !token1) continue; // Token Info (Use fetched info or generic fallback)

      const token0Info = tokenInfos[token0] || UNKNOWN_TOKEN_INFO;
      const token1Info = tokenInfos[token1] || UNKNOWN_TOKEN_INFO; // --- FIX: Correctly determine Input/Output based on sign --- // amount0 > 0 means token0 was sold/input by the user/router

      const isToken0In = swap.amount0 > 0n;

      const inputTokenAddress = isToken0In ? token0 : token1;
      const outputTokenAddress = isToken0In ? token1 : token0;

      const inputInfo = isToken0In ? token0Info : token1Info;
      const outputInfo = isToken0In ? token1Info : token0Info; // Input amount is the positive one

      const swapAmountIn = isToken0In ? swap.amount0 : swap.amount1; // Output amount is the absolute value of the negative one
      const swapAmountOut = isToken0In ? -swap.amount1 : -swap.amount0; // Using swap amounts directly, as transfer events can be complicated in aggregated swaps

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
        nativePrice, // FIX: Use the actual amount received (output) as volume.
        volume: amountOutDecimal,
        mint: outputTokenAddress, // Keeping the user's logic for determining BUY/SELL
        type:
          outputInfo.symbol === "WETH" || outputInfo.symbol === "USDC"
            ? "BUY"
            : "SELL",
        pairAddress: swap.pool,
        programId: routerAddress,
        quoteToken: inputTokenAddress, // Input token address
        baseDecimals: outputInfo.decimals,
        quoteDecimals: inputInfo.decimals,
        tradeType: `${inputInfo.symbol} -> ${outputInfo.symbol}`,
        walletAddress: userWallet,
      });
    } // Log Trade Events

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

async function main(): Promise<void> {
  if (!process.env.PROVIDER_URL) {
    // This ensures the user sees this error if the environment is not set up
    console.error("ERROR: PROVIDER_URL not set in .env file.");
    return;
  }
  const txHashes = [
    "0x8e6092d254d139b7f4c8253c4a15e8d520874fc0a3e2b9be45330c369b9534c2",
  ];
  for (const txHash of txHashes) {
    await analyzeTransaction(txHash);
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
