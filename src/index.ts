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
    "0xb80ef41ff0b19faf1151c4d4a5b657dd7839e69daa3f5075a8541d23203327b6",
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
