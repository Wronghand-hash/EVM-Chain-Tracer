import * as dotenv from "dotenv";
import { analyzeTransaction } from "./processor";

// Load environment variables
dotenv.config();

async function main(): Promise<void> {
  console.log("Starting analysis..." + process.env.PROVIDER_URL);
  if (!process.env.PROVIDER_URL) {
    console.error("ERROR: PROVIDER_URL not set in .env file.");
    return;
  }
  const txHashes = [
    "0x200b0b0c00c1c7961719268718d605e289652b914e06caf91e91fa2c7b25b6af",
  ];
  for (const txHash of txHashes) {
    await analyzeTransaction(txHash);
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
