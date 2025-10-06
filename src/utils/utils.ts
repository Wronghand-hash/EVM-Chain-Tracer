import { Contract, ethers } from "ethers";
import {
  provider,
  erc20Abi,
  poolAbi,
  UNKNOWN_TOKEN_INFO,
  WETH_ADDRESS,
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  V3_SLOT0_ABI,
  UNISWAP_V4_POOL_MANAGER_ADDRESS,
} from "../types/constants";
import * as uniswapV4PoolManagerAbi from "../abi/uniswapV4PoolManager.json";
import { TokenInfo } from "../types/types";
import axios from "axios";

export async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
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
    return UNKNOWN_TOKEN_INFO;
  }
}

export async function getPoolTokens(
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

export function formatAmount(
  value: bigint,
  decimals: number,
  symbol: string
): string {
  const absoluteValue = value < 0n ? -value : value;
  return `${ethers.formatUnits(absoluteValue, decimals)} ${symbol}`;
}

export async function isV2Pool(poolAddress: string): Promise<boolean> {
  const poolContract = new Contract(poolAddress, V3_SLOT0_ABI, provider);
  try {
    await poolContract.slot0(); // V3 succeeds; V2 reverts
    return false;
  } catch {
    return true; // topic match implies pool
  }
}

export async function fetchEthPriceUsd(): Promise<number | null> {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
  try {
    const response = await axios.get(url);
    const data = response.data;
    return data.ethereum.usd;
  } catch (error) {
    console.error("Error fetching ETH price:", error);
    return null;
  }
}

export async function getPoolKeyFromPoolManager(
  poolId: string
): Promise<{ currency0: string; currency1: string } | null> {
  // TODO: No public reverse lookup in V4; return null for now
  console.warn(`V4 PoolManager has no getPool(PoolId); skipping query.`);
  return null;
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
