import * as dotenv from "dotenv";
import { analyzeTransaction, analyzeV4Transaction } from "./processor";

// Load environment variables
dotenv.config();

// In index.ts
async function main(): Promise<void> {
  console.log("Starting analysis..." + process.env.PROVIDER_URL);
  if (!process.env.PROVIDER_URL) {
    console.error("ERROR: PROVIDER_URL not set in .env file.");
    return;
  }
  const txHashes = [
    "0xfb35b17b86abc9c8b1694231485e665d6e9d4276c1d9d97641c97d597ab86268",
  ];
  for (const txHash of txHashes) {
    await analyzeTransaction(txHash); // V2/V3
    await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
