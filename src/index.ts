import * as dotenv from "dotenv";
import { analyzeTokenCreationBSC } from "./processInfo/bsc/uniswap&pancakeSwap";
import connectDB from "./config/db";
import mongoose from "mongoose";
import { analyzeTokenCreationFourMeme } from "./processInfo/bsc/fourMeme.token";
import {
  processFourMemes,
  ITokenAddress,
} from "./processSwaps/Bsc/fourMemeMain";
import { ethers } from "ethers";
import { fetchBnbPriceUsd } from "./utils/bsc/utils";
import { processPancake } from "./processSwaps/Bsc/uniswap";

dotenv.config();

const initializeDB = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    console.log("Initializing DB connection...");
    await connectDB();
  } else {
    console.log("DB already connected.");
  }
};

async function processTransaction(txHash: string): Promise<void> {
  const providerUrl = process.env.PROVIDER_URL || process.env.BSC_PROVIDER_URL;
  if (!providerUrl) {
    console.error(
      "ERROR: PROVIDER_URL or BSC_PROVIDER_URL not set in .env file."
    );
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(providerUrl);
  const chainSymbol = "BSC";
  const bnbPrice = await fetchBnbPriceUsd();

  console.log(`Processing tx: ${txHash}`);
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      console.error("Transaction not found");
      return;
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt.status !== 1) {
      console.log("Failed transaction");
      return;
    }

    const logs = receipt.logs;

    // Identify potential token addresses (exclude known factory)
    const factoryAddress =
      "0x5c952063c7fc8610ffdb798152d69f0b9550762b".toLowerCase();
    const potentialTokenAddresses = [
      ...new Set(
        logs
          .map((log: any) => log.address.toLowerCase())
          .filter((addr) => addr !== factoryAddress)
      ),
    ];

    if (potentialTokenAddresses.length === 0) {
      console.log("No potential tokens found");
      return;
    }

    // Use the first potential token (adjust if multiple expected)
    const tokenAddress = potentialTokenAddresses[0];

    // Fetch token details
    const tokenAbi = [
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)",
    ];
    const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);

    let decimals: number, totalSupply: string;
    try {
      decimals = await tokenContract.decimals();
      totalSupply = (await tokenContract.totalSupply()).toString();
    } catch (e) {
      console.error("Failed to fetch token info:", e);
      return;
    }

    const tokensAddress: ITokenAddress[] = [
      {
        tokenAddress,
        totalSupply: Number(totalSupply), // Convert to number if needed; adjust based on ITokenAddress
        decimals,
        pairAddress: "",
        price: "0",
        // Defaults for optional fields
        customToken: false,
        solPad: false,
        pumpfun: false,
        associatedSwapAddresses: [],
        pumpaiToken: false,
        sunpump: false,
        moonshot: false,
        pinksale: false,
        degen: false,
        etherVista: false,
        fjordData: undefined,
      },
    ];

    // Call the function with required arguments
    // await processFourMemes(tokensAddress, logs, tx, chainSymbol, bnbPrice);
    await processPancake(tokensAddress, logs, tx, chainSymbol, bnbPrice);
  } catch (e) {
    console.error(`Error processing ${txHash}:`, e);
  }
}

async function main(): Promise<void> {
  await initializeDB();

  console.log(
    "Starting analysis..." + process.env.PROVIDER_URL,
    "or " + process.env.BSC_PROVIDER_URL
  );

  // Hardcoded tx hash
  const txHashes = [
    "0x8013c43a51ddb7f7dc20db332404ba37db4773d0dad13e7ab38d84c6daa942c5",
  ];

  for (const txHash of txHashes) {
    await processTransaction(txHash);
    console.log("\n" + "=".repeat(80) + "\n");
  }

  // Other commented functions can be enabled as needed
  // await analyzeTokenCreationFourMeme(txHash);
  // await analyzeTokenCreationBSC(txHash);
  // etc.
}

main().catch(console.error);
