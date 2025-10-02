import * as dotenv from "dotenv";
import { analyzeTransaction, analyzeV4Transaction } from "./processor";
import { fetchEthPriceUsd } from "./utils/utils";

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
    "0x3e31133ebd53fa8d3bf8a988a1fa8a076858a1cc3538a93599eead654a72bc48",
  ];
  for (const txHash of txHashes) {
    await analyzeTransaction(txHash); // V2/V3
    await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
