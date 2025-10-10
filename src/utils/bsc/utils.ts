import { ethers } from "ethers";
import { WBNB_ADDRESS } from "../../types/Bsc/constants";
import {
  provider,
  erc20Abi,
  UNKNOWN_TOKEN_INFO,
  poolAbi,
} from "../../types/Bsc/constants";
import { TokenInfo } from "../../types/Etherium/types";

export async function isV2Pool(poolAddress: string): Promise<boolean> {
  try {
    // For Uniswap on BSC, distinguish V2 and V3 by querying the factory or using known addresses.
    // Placeholder: Assume V2 if not V3 factory derived. Enhance with Uniswap V2/V3 factory on BSC if needed.
    // Uniswap V2 Factory on BSC: 0x1097053Fd2ea711dad45caCcc45EfF7548fCB362
    // Uniswap V3 Factory on BSC: 0x1F98431c8aD98523631AE4a59f267346ea31F984 (wait, that's ETH; for BSC it's different, e.g., 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865 for V3)
    const code = await provider.getCode(poolAddress);
    // Simple heuristic: V2 pools have specific bytecode length or slot0 call fails for V2.
    // For now, try calling slot0; if fails, assume V2.
    const poolContract = new ethers.Contract(
      poolAddress,
      [
        "function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
      ],
      provider
    );
    await poolContract.slot0();
    return false; // If slot0 succeeds, it's V3
  } catch {
    return true; // If fails, assume V2
  }
}

export async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  try {
    const addrLower = tokenAddress.toLowerCase();
    if (addrLower === WBNB_ADDRESS) {
      return { decimals: 18, symbol: "WBNB", name: "Wrapped BNB" };
    }
    // Known stablecoins or common tokens on BSC for fallback
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
      // Add more if needed
    };
    if (knownTokens[addrLower]) {
      return knownTokens[addrLower];
    }

    const contract = new ethers.Contract(addrLower, erc20Abi, provider);
    // Use static call with timeout or retry logic
    const [decimals, symbol, name] = await Promise.allSettled([
      contract.decimals(),
      contract.symbol(),
      contract.name(),
    ]).then(
      (results) =>
        results.map((result) =>
          result.status === "fulfilled" ? result.value : undefined
        ) as [number | undefined, string | undefined, string | undefined]
    );

    if (decimals !== undefined && symbol && name) {
      console.log(`Fetched token info for ${addrLower}: ${symbol} (${name})`);
      return { decimals: Number(decimals), symbol, name };
    } else {
      console.warn(
        `Partial or failed token info for ${addrLower}: decimals=${decimals}, symbol=${symbol}, name=${name}`
      );
      // Fallback to querying via multicall if available, but for now return partial
      return {
        decimals: decimals ?? 18,
        symbol: symbol ?? "UNKNOWN",
        name: name ?? "Unknown Token",
      };
    }
  } catch (error) {
    console.error(`Failed to fetch token info for ${tokenAddress}:`, error);
    return UNKNOWN_TOKEN_INFO;
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
    return { token0: "", token1: "" };
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
    // Using free CoinGecko API - no API key required, rate limit 30 calls/min
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
    // Fallback mock price (update periodically)
    return 600; // Approximate fallback
  }
}
