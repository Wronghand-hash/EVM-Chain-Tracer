import { Contract, ethers } from "ethers";
import {
  provider,
  erc20Abi,
  poolAbi,
  UNKNOWN_TOKEN_INFO,
  WETH_ADDRESS,
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
} from "../types/constants";
import { TokenInfo } from "../types/types";
import * as uniswapUniversalAbi from "../abi/uniswapUniversalAbi.json";

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
  const poolContract = new Contract(
    poolAddress,
    ["function factory() view returns (address)"],
    provider
  );
  try {
    const factory = (await poolContract.factory()).toLowerCase();
    const universalRouterContract = new Contract(
      UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
      uniswapUniversalAbi,
      provider
    );
    const v2Factory = (await universalRouterContract.v2Factory()).toLowerCase();
    return factory === v2Factory;
  } catch {
    return false; // Default to V3 if factory check fails
  }
}
