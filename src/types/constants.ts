import { Interface, ethers } from "ethers";
import { TokenInfo } from "./types";
import * as uniswapV4PoolManagerAbi from "../abi/uniswapV4PoolManager.json";
import dotenv from "dotenv";
dotenv.config();

export const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// In constants.ts
export const UNISWAP_V4_POOL_MANAGER_ADDRESS =
  "0x57e3b2369631F4a7216eCdb2760aA4DDbC9eE4b7".toLowerCase(); // Uniswap V4 PoolManager on Ethereum mainnet
export const V4_SWAP_EVENT_TOPIC = ethers.id(
  "Swap(bytes32,address,int256,int256,uint160,uint128,int24)"
); // Exact topic hash for V4 Swap event
export const v4SwapIface = new Interface(uniswapV4PoolManagerAbi);

export const erc20TransferAbi = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export const poolAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
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

export const provider = (() => {
  if (!process.env.PROVIDER_URL) {
    throw new Error("PROVIDER_URL not set in .env file");
  }
  const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
  provider.getNetwork().catch(() => {
    throw new Error(
      "Failed to connect to the Ethereum node. Check PROVIDER_URL or node status."
    );
  });
  return provider;
})();

export const UNKNOWN_TOKEN_INFO: TokenInfo = {
  decimals: 18,
  symbol: "UNKNOWN",
  name: "Unknown Token",
};

export const WETH_ADDRESS =
  "0xC02aaA39b223FE8D0A0e5C4f27eAD9083C756Cc2".toLowerCase();
export const UNISWAP_UNIVERSAL_ROUTER_ADDRESS =
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD".toLowerCase();

export const v2SwapIface = new Interface(v2SwapAbi);
export const v3SwapIface = new Interface(v3SwapAbi);
export const transferIface = new Interface(erc20TransferAbi);

export const V2_SWAP_EVENT_TOPIC = v2SwapIface.getEvent("Swap")?.topicHash;
export const V3_SWAP_EVENT_TOPIC = v3SwapIface.getEvent("Swap")?.topicHash;
export const TRANSFER_TOPIC = transferIface.getEvent("Transfer")?.topicHash;
