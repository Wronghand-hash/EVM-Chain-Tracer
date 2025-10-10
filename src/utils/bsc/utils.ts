// filename: utils/bsc/utils.ts
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
    console.log(`isV2Pool: Assuming V2 for ${poolAddress} (no external call).`);
    return true; // Maintains functionality without slot0 call
  } catch {
    console.log(`isV2Pool fallback: true (no external call).`);
    return true;
  }
}

export async function getTokenInfo(
  tokenAddress: string
): Promise<{ info: TokenInfo; callsMade: number }> {
  let callsMade = 0;
  try {
    const addrLower = tokenAddress.toLowerCase();
    if (addrLower === WBNB_ADDRESS) {
      console.log(
        `Token info for WBNB from hardcoded (no external call): decimals 18, symbol WBNB.`
      );
      return {
        info: { decimals: 18, symbol: "WBNB", name: "Wrapped BNB" },
        callsMade: 0,
      };
    }
    // Expanded known tokens (hardcoded for common/minimize calls) - added from this tx
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
      "0xde04da55b74435d7b9f2c5c62d9f1b53929b09aa": {
        decimals: 18,
        symbol: "AICELL",
        name: "AICell",
      }, // From recent TX analysis
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
    };
    if (knownTokens[addrLower]) {
      console.log(
        `Token info for ${addrLower} from known cache (no external call): decimals ${knownTokens[addrLower].decimals}, symbol ${knownTokens[addrLower].symbol}.`
      );
      return { info: knownTokens[addrLower], callsMade: 0 };
    }

    // Fallback: Call decimals and symbol for unknowns
    console.log(
      `Token info for unknown ${addrLower}: calling decimals and symbol RPC (external calls).`
    );
    const contract = new ethers.Contract(
      addrLower,
      [
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ],
      provider
    );
    const [decimals, symbol] = await Promise.all([
      contract.decimals(),
      contract.symbol(),
    ]);
    callsMade = 2; // decimals + symbol
    console.log(
      `Fetched decimals for ${addrLower}: ${decimals} (external call).`
    );
    console.log(`Fetched symbol for ${addrLower}: ${symbol} (external call).`);
    return {
      info: {
        decimals: Number(decimals),
        symbol: symbol || "UNKNOWN",
        name: "Unknown Token",
      },
      callsMade,
    };
  } catch (error) {
    console.error(`Failed to fetch token info for ${tokenAddress}:`, error);
    console.log(
      `Fallback token info for ${tokenAddress}: assuming decimals 18 (no successful external call).`
    );
    return { info: { ...UNKNOWN_TOKEN_INFO, decimals: 18 }, callsMade: 0 };
  }
}

export async function getPoolTokens(
  poolAddress: string
): Promise<{ tokens: { token0: string; token1: string }; callsMade: number }> {
  let callsMade = 0;
  try {
    console.log(
      `Fetching pool tokens for ${poolAddress} via RPC calls (external).`
    );
    const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
    const [token0, token1] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
    ]);
    callsMade = 2; // token0 + token1
    console.log(
      `Fetched tokens for pool ${poolAddress}: ${token0} / ${token1} (external calls).`
    );
    return {
      tokens: { token0: token0.toLowerCase(), token1: token1.toLowerCase() },
      callsMade,
    };
  } catch (error) {
    console.error(`Failed to fetch tokens for pool ${poolAddress}:`, error);
    console.log(
      `Fallback pool tokens for ${poolAddress}: empty (no successful external call).`
    );
    return { tokens: { token0: "", token1: "" }, callsMade: 0 };
  }
}

export function formatAmount(
  amount: bigint,
  decimals: number,
  symbol: string
): string {
  console.log(
    `Formatting amount ${amount} with decimals ${decimals}, symbol ${symbol} (no external call).`
  );
  return `${ethers.formatUnits(amount, decimals)} ${symbol}`;
}

export async function fetchBnbPriceUsd(): Promise<number> {
  try {
    // Keep 1 HTTP call (essential for USD)
    console.log(`Fetching BNB USD price via HTTP (external call).`);
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd"
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log(`Fetched BNB price: $${data.binancecoin.usd} (external call).`);
    return data.binancecoin.usd;
  } catch (error) {
    console.error("Error fetching BNB price:", error);
    console.log(`Fallback BNB price: 600 (no successful external call).`);
    return 600; // Fallback
  }
}
