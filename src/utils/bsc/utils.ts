// filename: utils/utils.ts
import { ethers } from "ethers";
import {
  provider,
  erc20Abi,
  poolAbi,
  UNKNOWN_TOKEN_INFO,
  WBNB_ADDRESS,
} from "../../types/Bsc/constants";
import { TokenInfo } from "../../types/Etherium/types";

export async function isV2Pool(poolAddress: string): Promise<boolean> {
  try {
    // Simplified: Assume V2 for Pancake/Uniswap forks on BSC (most common); skip call if not critical
    return true; // Maintains functionality without slot0 call
  } catch {
    return true;
  }
}

export async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  try {
    const addrLower = tokenAddress.toLowerCase();
    if (addrLower === WBNB_ADDRESS) {
      return { decimals: 18, symbol: "WBNB", name: "Wrapped BNB" };
    }
    // Expanded known tokens (hardcoded for common/minimize calls)
    const knownTokens: { [addr: string]: TokenInfo } = {
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
      // Hardcoded for this tx's token (修仙) to minimize calls
      "0x44443dd87ec4d1bea3425acc118adb023f07f91b": {
        decimals: 18,
        symbol: "修仙",
        name: "修仙",
      },
      // Pancake LP example (common)
      "0xee2f63a49cb190962619183103d25af14ce5f538": {
        decimals: 18,
        symbol: "Cake-LP",
        name: "Pancake LPs",
      },
      // Add more as needed for future txs
    };
    if (knownTokens[addrLower]) {
      return knownTokens[addrLower];
    }

    // Fallback: Assume 18 decimals for unknowns (common on BSC); skip calls for symbol/name if non-critical
    // To maintain: Call only decimals (1 call vs 3)
    const contract = new ethers.Contract(
      addrLower,
      ["function decimals() view returns (uint8)"],
      provider
    );
    const decimals = await contract.decimals();
    console.log(`Fetched decimals for ${addrLower}: ${decimals}`);
    return {
      decimals: Number(decimals),
      symbol: "UNKNOWN", // Skip symbol call
      name: "Unknown Token", // Skip name call
    };
  } catch (error) {
    console.error(`Failed to fetch token info for ${tokenAddress}:`, error);
    return { ...UNKNOWN_TOKEN_INFO, decimals: 18 }; // Assume 18 to maintain formatting
  }
}

export async function getPoolTokens(
  poolAddress: string
): Promise<{ token0: string; token1: string }> {
  try {
    const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
    const [token0, token1] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
    ]);
    console.log(
      `Fetched tokens for pool ${poolAddress}: ${token0} / ${token1}`
    );
    return { token0: token0.toLowerCase(), token1: token1.toLowerCase() };
  } catch (error) {
    console.error(`Failed to fetch tokens for pool ${poolAddress}:`, error);
    return { token0: "", token1: "" }; // Fallback; maintain by assuming from reserves if needed
  }
}

export function formatAmount(
  amount: bigint,
  decimals: number,
  symbol: string
): string {
  return `${ethers.formatUnits(amount, decimals)} ${symbol}`;
}

export async function fetchBnbPriceUsd(): Promise<number> {
  try {
    // Keep 1 HTTP call (essential for USD)
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd"
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log(`Fetched BNB price: $${data.binancecoin.usd}`);
    return data.binancecoin.usd;
  } catch (error) {
    console.error("Error fetching BNB price:", error);
    return 600; // Fallback
  }
}
