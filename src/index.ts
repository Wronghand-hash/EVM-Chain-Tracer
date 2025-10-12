import * as dotenv from "dotenv";
import { analyzeTransaction } from "./processSwaps/Etherium/uniswapV2&V3";
import { fetchEthPriceUsd } from "./utils/utils";
import { analyzeV4Transaction } from "./processSwaps/Etherium/uniswapV4";
import { analyzeTokenCreation } from "./createTokenprocessor";
import { analyzeUniswapV4Pool } from "./uniswapV4.tokens";
import { analyzeBscTransaction } from "./processSwaps/Bsc/uniswapV2&V3";
import { analyzeTokenCreationBSC } from "./processInfo/bsc/uniswap&pancakeSwap";
import connectDB from "./config/db";
import mongoose from "mongoose";
import { analyzeFourMemeTransaction } from "./processSwaps/Bsc/fourMeme";
import { analyzeTokenCreationFourMeme } from "./processInfo/bsc/fourMeme.token";

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
    "0x12e1bce3876938b7f14fffb40f422fb066888a0f8e0c98cdf7b58218126a42ea",
  ];
  for (const txHash of txHashes) {
    await analyzeTokenCreationFourMeme(txHash);
    // await analyzeFourMemeTransaction(txHash);
    // await analyzeTokenCreationBSC(txHash);
    // await analyzeBscTransaction(txHash);
    // await analyzeUniswapV4Pool(txHash);
    // await analyzeTokenCreation(txHash);
    // await analyzeTransaction(txHash); // V2/V3
    // await analyzeV4Transaction(txHash); // V4
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
