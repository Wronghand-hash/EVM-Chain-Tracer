import * as dotenv from "dotenv";
import { analyzeTransaction } from "./uniswapV2&V3";
import { fetchEthPriceUsd } from "./utils/utils";
import { analyzeV4Transaction } from "./uniswapV4";
import { analyzeTokenCreation } from "./createTokenprocessor";
import { analyzeUniswapV4Pool } from "./uniswapV4.tokens";

// Load environment variables
dotenv.config();

// In index.ts
async function main(): Promise<void> {
  console.log("Starting analysis..." + process.env.PROVIDER_URL);
  if (!process.env.PROVIDER_URL) {
    console.error("ERROR: PROVIDER_URL not set in .env file.");
    return;
  }
  const ethPriceUsd = await fetchEthPriceUsd();
  console.log(`ETH price in USD: ${ethPriceUsd}`);
  const txHashes = [
    "0xcd8a01a15e611a72b8e5d18142933c1ac7b304deda1e367c2dca46e41241c390",
  ];
  for (const txHash of txHashes) {
    // await analyzeUniswapV4Pool(txHash);
    // await analyzeTokenCreation(txHash);
    // await analyzeTransaction(txHash); // V2/V3
    await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
