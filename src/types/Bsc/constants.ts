// filename: constants.ts
import { ethers, Interface as EthersInterface } from "ethers";
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
export const v2SyncIface = new EthersInterface([
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

export const provider = (() => {
  let url: string;
  if (process.env.PROVIDER_URL) {
    url = process.env.PROVIDER_URL;
  } else {
    // Hard-code BSC for reliability during dev
    url = "https://bsc-rpc.publicnode.com";
  }
  console.log(`Using RPC: ${url}`);
  const provider = new ethers.JsonRpcProvider(url);
  provider
    .getNetwork()
    .then((net) => {
      console.log(`Chain ID: ${net.chainId} (Expected BSC: 56)`);
      if (net.chainId !== 56n) {
        console.warn(
          "WARNING: Connected to wrong chain! Update PROVIDER_URL to BSC RPC."
        );
      }
    })
    .catch((err) => {
      console.error("Failed to detect chain:", err);
    });
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

export const v2SwapIface = new EthersInterface(v2SwapAbi);
export const v3SwapIface = new EthersInterface(v3SwapAbi);
export const transferIface = new EthersInterface(erc20TransferAbi);

export const V2_SWAP_EVENT_TOPIC = v2SwapIface.getEvent("Swap")?.topicHash;
export const V3_SWAP_EVENT_TOPIC = v3SwapIface.getEvent("Swap")?.topicHash;
export const TRANSFER_TOPIC = transferIface.getEvent("Transfer")?.topicHash;
