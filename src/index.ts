import * as dotenv from "dotenv";
import { analyzeTransaction } from "./uniswapV2&V3";
import { fetchEthPriceUsd } from "./utils/utils";
import { analyzeV4Transaction } from "./uniswapV4";

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
    "0xd73b79bb5830cf7a4a01f13bbbe2ea7fa2834498d1a5138d6b52012013eeae2c",
  ];
  for (const txHash of txHashes) {
    await analyzeTransaction(txHash); // V2/V3
    await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
