import * as dotenv from "dotenv";
import { analyzeTransaction } from "./processSwaps/Etherium/uniswapV2&V3";
import { fetchEthPriceUsd } from "./utils/utils";
import { analyzeV4Transaction } from "./processSwaps/Etherium/uniswapV4";
import { analyzeTokenCreation } from "./createTokenprocessor";
import { analyzeUniswapV4Pool } from "./uniswapV4.tokens";
import { analyzeBscTransaction } from "./processSwaps/Bsc/uniswapV2&V3";
import connectDB from "./config/db";
import mongoose from "mongoose";

dotenv.config();

const initializeDB = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    console.log("Initializing DB connection...");
    await connectDB();
  } else {
    console.log("DB already connected.");
  }
};

async function main(): Promise<void> {
  await initializeDB();

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
    "0x12990e9e6c9a5d3700245a3f59da0a772b6ac06973d7b8cfda62aca4b7379ead",
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
