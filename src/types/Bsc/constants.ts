// filename: constants.ts
import { ethers } from "ethers";
import { TokenInfo } from "../Etherium/types";
import dotenv from "dotenv";
dotenv.config();

export const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

export const erc20TransferAbi = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export const poolAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

export const V2_SYNC_EVENT_TOPIC =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
export const v2SyncIface = new ethers.utils.Interface([
  "event Sync(uint112 reserve0, uint112 reserve1)",
]);

export const V3_SLOT0_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

export const v2SwapAbi = [
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
        indexed: false,
        internalType: "uint256",
        name: "amount0In",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount1In",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount0Out",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount1Out",
        type: "uint256",
      },
      { indexed: true, internalType: "address", name: "to", type: "address" },
    ],
    name: "Swap",
    type: "event",
  },
];

export const v3SwapAbi = [
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

export const MULTICALL_ADDRESS = "0x158c5f4F3E9fB5bA66E1A5006f70a1A8eCE69dA5"; // BSC Multicall3 (updated from V2)
export const multicallAbi = [
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
      {
        internalType: "bytes[]",
        name: "returnData",
        type: "bytes[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bool",
            name: "allowFailure",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call3[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate3",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bool",
            name: "allowFailure",
            type: "bool",
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call3Value[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate3Value",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "blockAndAggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "getBasefee",
    outputs: [
      {
        internalType: "uint256",
        name: "basefee",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
    ],
    name: "getBlockHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getBlockNumber",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getChainId",
    outputs: [
      {
        internalType: "uint256",
        name: "chainid",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCurrentBlockCoinbase",
    outputs: [
      {
        internalType: "address",
        name: "coinbase",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCurrentBlockDifficulty",
    outputs: [
      {
        internalType: "uint256",
        name: "difficulty",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCurrentBlockGasLimit",
    outputs: [
      {
        internalType: "uint256",
        name: "gaslimit",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCurrentBlockTimestamp",
    outputs: [
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address",
      },
    ],
    name: "getEthBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getLastBlockHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bool",
        name: "requireSuccess",
        type: "bool",
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "tryAggregate",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bool",
        name: "requireSuccess",
        type: "bool",
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "tryBlockAndAggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
];
export const multicallIface = new ethers.utils.Interface(multicallAbi);

export const provider = (() => {
  let url: string;
  if (process.env.PROVIDER_URL) {
    url = process.env.PROVIDER_URL;
  } else {
    // Hard-code BSC for reliability during dev
    url = "https://bsc-rpc.publicnode.com";
  }
  console.log(`Using RPC: ${url}`);
  const provider = new ethers.providers.JsonRpcProvider(url);
  // Commented out getNetwork to save 1 RPC
  // provider
  //   .getNetwork()
  //   .then((net) => {
  //     console.log(`Chain ID: ${net.chainId} (Expected BSC: 56)`);
  //     if (net.chainId !== 56n) {
  //       console.warn(
  //         "WARNING: Connected to wrong chain! Update PROVIDER_URL to BSC RPC."
  //       );
  //     }
  //   })
  //   .catch((err) => {
  //     console.error("Failed to detect chain:", err);
  //   });
  return provider;
})();

export const UNKNOWN_TOKEN_INFO: TokenInfo = {
  decimals: 18,
  symbol: "UNKNOWN",
  name: "Unknown Token",
};

export const WBNB_ADDRESS =
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c".toLowerCase();
export const UNISWAP_UNIVERSAL_ROUTER_ADDRESS =
  "0x1906c1d672b88cd1b9ac7593301ca990f94eae07".toLowerCase();

export const v2SwapIface = new ethers.utils.Interface(v2SwapAbi);
export const v3SwapIface = new ethers.utils.Interface(v3SwapAbi);
export const transferIface = new ethers.utils.Interface(erc20TransferAbi);

export const V2_SWAP_EVENT_TOPIC = v2SwapIface.getEvent("Swap").name;
export const V3_SWAP_EVENT_TOPIC = v3SwapIface.getEvent("Swap").name;
export const TRANSFER_TOPIC = transferIface.getEvent("Transfer").name;

// Export knownTokens for use in utils (to avoid duplication)
export const knownTokens: { [addr: string]: TokenInfo } = {
  "0xe9e7cea3dedca5984780bafc599bd69add087d56": {
    decimals: 18,
    symbol: "BUSD",
    name: "Binance USD",
  },
  "0x55d398326f99059ff775485246999027b3197955": {
    decimals: 18,
    symbol: "USDT",
    name: "Tether USD",
  },
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
    decimals: 18,
    symbol: "USDC",
    name: "USD Coin",
  },
  // From this tx
  "0x44443dd87ec4d1bea3425acc118adb023f07f91b": {
    decimals: 18,
    symbol: "修仙",
    name: "修仙",
  },
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
    decimals: 18,
    symbol: "CAKE",
    name: "PancakeSwap",
  }, // Assumed from pool
  "0x8f452a1fdd388a45e1080992eff051b4dd9048d2": {
    decimals: 18,
    symbol: "PEPE",
    name: "Pepe",
  }, // Common BSC token
  "0xe68b79e51bf826534ff37aa9cee71a3842ee9c70": {
    decimals: 18,
    symbol: "WAL",
    name: "Wallet",
  }, // Assumed
  // Pancake LP example (common)
  "0x91c7492e327a3a2ae7ea61efa186a37f148ecf1a": {
    decimals: 18,
    symbol: "Cake-LP",
    name: "Pancake LPs",
  },
  "0xbe9f06b76e301b49dc345948a7a5e3418264886a": {
    decimals: 18,
    symbol: "Cake-LP",
    name: "Pancake LPs",
  },
  "0xa8f9054d78d173f9725a829e286c9a4662e2ccc8": {
    decimals: 18,
    symbol: "Cake-LP",
    name: "Pancake LPs",
  },
  // Add more as needed for future txs
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": {
    decimals: 18,
    symbol: "CAKE",
    name: "PancakeSwap Token",
  }, // V1 CAKE
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    decimals: 18,
    symbol: "UNI",
    name: "Uniswap",
  }, // If bridged
  // LP examples (if mints hit them)
  "0x0ed7e52944161450477ee417de9cd3a859b14fd0": {
    decimals: 18,
    symbol: "BUSD-CAKE-LP",
    name: "Pancake LPs",
  },
};
