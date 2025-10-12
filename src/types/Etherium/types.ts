export interface TokenInfo {
  decimals: number;
  symbol: string;
  name: string;
  totalSupply?: any;
}

export interface Transfer {
  token: string;
  from: string;
  to: string;
  value: bigint;
}

export interface SwapEvent {
  pool: string;
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  protocol: "V2" | "V3" | "V4";
  tick?: number;
  sqrtPriceX96?: bigint;
  liquidity?: bigint;
}

export interface TradeEvent {
  event: string;
  status: string;
  txHash: string;
  timestamp: number;
  usdPrice: string;
  nativePrice: string;
  volume: string;
  inputVolume: string;
  mint: string;
  targetTokenMint?: string;
  type: "BUY" | "SELL" | "UNKNOWN" | any;
  pairAddress?: string;
  programId: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
  tradeType: string;
  walletAddress: string;
  protocol:
    | "V2"
    | "V3"
    | "V4"
    | "Four.meme"
    | "uniswapV2"
    | "uniswapV3"
    | "pancakeSwapV2"
    | "pancakeSwapV3";
}

// vetsion 4 uniswap token creation

export interface PoolCreationData {
  poolId: string;
  currency0: string;
  currency1: string;
  token0Name: string;
  token0Symbol: string;
  token0Decimals?: number;
  token1Name: string;
  token1Symbol: string;
  token1Decimals?: number;
  fee: number;
  tickSpacing: number;
  hooks: string;
  sqrtPriceX96: string;
  tick: number;
  creatorAddress: string;
  hash: string;
}
export interface TokenCreationData {
  tokenMint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  programId: string;
  decimals?: number;
  tokenBalanceChanges?: string;
  hash: string;
  totalSupply?: string;
}
