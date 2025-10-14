import { ethers } from "ethers";

// PancakeSwap V2 Factory contract address
const PANCAKE_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const PANCAKE_FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];

export interface CreatedPairInfo {
  token0: string;
  token1: string;
  pair: string;
  token0Symbol?: string;
  token1Symbol?: string;
  token0Name?: string;
  token1Name?: string;
  timestamp: number;
}

/**
 * Fetch historical PairCreated events from PancakeSwap Factory
 */
async function fetchHistoricalPairs(
  provider: ethers.providers.JsonRpcProvider,
  fromBlock = 0,
  toBlock: number | string = "latest"
): Promise<CreatedPairInfo[]> {
  const factory = new ethers.Contract(
    PANCAKE_FACTORY,
    PANCAKE_FACTORY_ABI,
    provider
  );
  const filter = factory.filters.PairCreated();
  const logs = await factory.queryFilter(filter, fromBlock, toBlock);

  const erc20Abi = [
    "function symbol() view returns (string)",
    "function name() view returns (string)",
  ];

  const pairs: CreatedPairInfo[] = [];

  for (const log of logs) {
    const { token0, token1, pair } = log.args!;
    const block = await provider.getBlock(log.blockNumber);

    let symbol0 = "";
    let symbol1 = "";
    let name0 = "";
    let name1 = "";

    try {
      const token0C = new ethers.Contract(token0, erc20Abi, provider);
      const token1C = new ethers.Contract(token1, erc20Abi, provider);
      [symbol0, symbol1, name0, name1] = await Promise.all([
        token0C.symbol(),
        token1C.symbol(),
        token0C.name(),
        token1C.name(),
      ]);
    } catch {
      // fallback if some tokens revert
    }

    pairs.push({
      token0,
      token1,
      pair,
      token0Symbol: symbol0,
      token1Symbol: symbol1,
      token0Name: name0,
      token1Name: name1,
      timestamp: block.timestamp,
    });
  }

  return pairs;
}

/**
 * Detects tokens created on PancakeSwap (historical + future)
 * @param providerUrl - Your BSC RPC or WebSocket URL
 * @param onNewPair - Callback fired when a new pair is detected
 */
export async function processPancakeTokenCreate(
  providerUrl: string,
  onNewPair?: (pairInfo: CreatedPairInfo) => Promise<void> | void
) {
  const wsProvider = new ethers.providers.WebSocketProvider(providerUrl);
  const httpProvider = new ethers.providers.JsonRpcProvider(providerUrl);

  console.log("🔍 Fetching historical PancakeSwap PairCreated events...");

  try {
    const latestBlock = await httpProvider.getBlockNumber();
    const historicalPairs = await fetchHistoricalPairs(
      httpProvider,
      0,
      latestBlock
    );

    console.log(`🔥 Found ${historicalPairs.length} historical pairs`);

    for (const pairInfo of historicalPairs) {
      console.log(
        `Historical Pair: ${pairInfo.pair}, Token0: ${pairInfo.token0Symbol}, Token1: ${pairInfo.token1Symbol}`
      );
      if (onNewPair) await onNewPair(pairInfo);
    }
  } catch (err) {
    console.error("Error fetching historical pairs:", err);
  }

  // Listen for new pairs
  const factory = new ethers.Contract(
    PANCAKE_FACTORY,
    PANCAKE_FACTORY_ABI,
    wsProvider
  );
  console.log("🔍 Listening for new PancakeSwap PairCreated events...");

  factory.on("PairCreated", async (token0, token1, pair, event) => {
    try {
      const block = await event.getBlock();
      const timestamp = block.timestamp;

      const erc20Abi = [
        "function symbol() view returns (string)",
        "function name() view returns (string)",
      ];
      const token0C = new ethers.Contract(token0, erc20Abi, wsProvider);
      const token1C = new ethers.Contract(token1, erc20Abi, wsProvider);

      let [symbol0, symbol1, name0, name1] = ["", "", "", ""];
      try {
        [symbol0, symbol1, name0, name1] = await Promise.all([
          token0C.symbol(),
          token1C.symbol(),
          token0C.name(),
          token1C.name(),
        ]);
      } catch {}

      const info: CreatedPairInfo = {
        token0,
        token1,
        pair,
        token0Symbol: symbol0,
        token1Symbol: symbol1,
        token0Name: name0,
        token1Name: name1,
        timestamp,
      };

      console.log(`🆕 New Pair Created:
        Token0: ${symbol0 || token0}
        Token1: ${symbol1 || token1}
        Pair: ${pair}
        Block time: ${new Date(timestamp * 1000).toISOString()}
      `);

      if (onNewPair) await onNewPair(info);
    } catch (err) {
      console.error("Error handling PairCreated event:", err);
    }
  });
}
