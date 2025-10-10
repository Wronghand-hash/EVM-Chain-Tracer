import * as dotenv from "dotenv";
import { analyzeTransaction } from "./processSwaps/Etherium/uniswapV2&V3";
import { fetchEthPriceUsd } from "./utils/utils";
import { analyzeV4Transaction } from "./processSwaps/Etherium/uniswapV4";
import { analyzeTokenCreation } from "./createTokenprocessor";
import { analyzeUniswapV4Pool } from "./uniswapV4.tokens";
import { analyzeBscTransaction } from "./processSwaps/Bsc/uniswapV2&V3";

// Load environment variables
dotenv.config();

// In index.ts
async function main(): Promise<void> {
  console.log(
    "Starting analysis..." + process.env.PROVIDER_URL,
    "or " + process.env.BSC_PROVIDER_URL
  );
  if (!process.env.PROVIDER_URL && !process.env.BSC_PROVIDER_URL) {
    console.error(
      "ERROR: PROVIDER_URL or BSC_PROVIDER_URL not set in .env file."
    );
    return;
  }
  const txHashes = [
    "0x7c7d3b2a311456fc74a2a1fa575a37d9ce695ba5d7f7655cb50003d9b7d4fb78",
  ];
  for (const txHash of txHashes) {
    await analyzeBscTransaction(txHash);
    // await analyzeUniswapV4Pool(txHash);
    // await analyzeTokenCreation(txHash);
    // await analyzeTransaction(txHash); // V2/V3
    // await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
