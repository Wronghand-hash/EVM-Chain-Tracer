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
  type: "BUY" | "SELL" | "UNKNOWN";
  pairAddress?: string;
  programId: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
  tradeType: string;
  walletAddress: string;
  protocol: "V2" | "V3" | "V4";
}
