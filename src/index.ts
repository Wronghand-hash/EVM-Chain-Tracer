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
import { processPancakeTokenCreate } from "./processSwaps/Bsc/uniswap";
import { poolCreationUniswapV3 } from "./processInfo/uniswapV3FactoryPoolCreation";
import { pairCreationPancakeSwapV2 } from "./processInfo/bsc/pancakeSwap.pairCreate";

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

    // Identify potential token addresses from logs and filter out known infra
    const EXCLUDED_ADDRESSES = new Set(
      [
        // Pancake V2/V3 factories
        "0xca143ce32fe78f1f7019d7d551a6402fc5350c73", // V2 factory
        "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865", // V3 factory
        // Routers and well-known infra (can expand as needed)
        "0xb971ef87ede563556b2ed4b1c0b0019111dd85d2", // Swap Router 02
        "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613", // NF Position Manager
        "0x78d78e420da98ad378d7799be8f4af69033eb077", // Quoter V2
        "0x1906c1d672b88cd1b9ac7593301ca990f94eae07", // Universal Router
      ].map((a) => a.toLowerCase())
    );

    const candidateAddresses = [
      ...new Set(logs.map((log: any) => log.address.toLowerCase())),
    ].filter((addr) => !EXCLUDED_ADDRESSES.has(addr));

    if (candidateAddresses.length === 0) {
      console.log(
        "No potential tokens from log addresses; will try parsing creation events."
      );
    }

    // Try to detect a valid ERC20 among candidates
    const tokenAbi = [
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)",
    ];
    let tokenAddress: string | undefined;
    let decimals: number | undefined;
    let totalSupplyStr: string | undefined;

    for (const addr of candidateAddresses) {
      try {
        const code = await provider.getCode(addr);
        if (!code || code === "0x") continue; // not a contract

        const tokenContract = new ethers.Contract(addr, tokenAbi, provider);
        const [dec, ts] = await Promise.all([
          tokenContract.decimals(),
          tokenContract.totalSupply(),
        ]);
        tokenAddress = addr;
        decimals = dec;
        totalSupplyStr = ts.toString();
        break;
      } catch (err) {
        // Not an ERC20; continue searching
        continue;
      }
    }

    if (!tokenAddress || decimals === undefined || !totalSupplyStr) {
      // Fallback: parse PairCreated/PoolCreated to extract token0/token1 and try them
      const pairCreatedSig = "PairCreated(address,address,address,uint256)";
      const poolCreatedSig =
        "PoolCreated(address,address,uint24,int24,address)";
      const pairIface = new ethers.utils.Interface([`event ${pairCreatedSig}`]);
      const poolIface = new ethers.utils.Interface([`event ${poolCreatedSig}`]);

      const creationTokenAddrs: string[] = [];
      for (const log of logs) {
        try {
          if (log.topics[0] === ethers.utils.id(pairCreatedSig)) {
            const parsed = pairIface.parseLog(log);
            creationTokenAddrs.push(parsed.args.token0.toLowerCase());
            creationTokenAddrs.push(parsed.args.token1.toLowerCase());
          } else if (log.topics[0] === ethers.utils.id(poolCreatedSig)) {
            const parsed = poolIface.parseLog(log);
            creationTokenAddrs.push(parsed.args.token0.toLowerCase());
            creationTokenAddrs.push(parsed.args.token1.toLowerCase());
          }
        } catch {
          // ignore parse errors
        }
      }

      const uniqueCreationAddrs = [...new Set(creationTokenAddrs)].filter(
        (a) => !EXCLUDED_ADDRESSES.has(a)
      );

      for (const addr of uniqueCreationAddrs) {
        try {
          const code = await provider.getCode(addr);
          if (!code || code === "0x") continue;
          const tokenContract = new ethers.Contract(addr, tokenAbi, provider);
          const [dec, ts] = await Promise.all([
            tokenContract.decimals(),
            tokenContract.totalSupply(),
          ]);
          tokenAddress = addr;
          decimals = dec;
          totalSupplyStr = ts.toString();
          break;
        } catch {
          continue;
        }
      }

      if (!tokenAddress || decimals === undefined || !totalSupplyStr) {
        // Second fallback: parse Swap logs to find pair/pool, then query token0/token1
        const swapV2Sig =
          "Swap(address,uint256,uint256,uint256,uint256,address)";
        const swapV3Sig =
          "Swap(address,address,int256,int256,uint160,uint128,int24)";
        const pairAbi = [
          "function token0() view returns (address)",
          "function token1() view returns (address)",
        ];

        // Gather candidate pair/pool addresses from swap logs
        const pairAddresses = new Set<string>();
        for (const log of logs) {
          const topic0 = log.topics?.[0];
          if (!topic0) continue;
          if (
            topic0 === ethers.utils.id(swapV2Sig) ||
            topic0 === ethers.utils.id(swapV3Sig)
          ) {
            pairAddresses.add(log.address.toLowerCase());
          }
        }

        const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // lowercase

        outer: for (const pairAddr of pairAddresses) {
          try {
            const code = await provider.getCode(pairAddr);
            if (!code || code === "0x") continue;
            const pair = new ethers.Contract(pairAddr, pairAbi, provider);
            const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
            const tokenCandidates = [t0.toLowerCase(), t1.toLowerCase()];

            // Prefer non-WBNB token if present
            const ordered = tokenCandidates.sort((a, b) =>
              a === wbnb ? 1 : b === wbnb ? -1 : 0
            );

            for (const cand of ordered) {
              if (EXCLUDED_ADDRESSES.has(cand)) continue;
              try {
                const codeT = await provider.getCode(cand);
                if (!codeT || codeT === "0x") continue;
                const tokenContract = new ethers.Contract(
                  cand,
                  tokenAbi,
                  provider
                );
                const [dec, ts] = await Promise.all([
                  tokenContract.decimals(),
                  tokenContract.totalSupply(),
                ]);
                tokenAddress = cand;
                decimals = dec;
                totalSupplyStr = ts.toString();
                break outer;
              } catch {
                continue;
              }
            }
          } catch {
            continue;
          }
        }

        if (!tokenAddress || decimals === undefined || !totalSupplyStr) {
          console.error(
            "Failed to discover a valid ERC20 token via addresses, creation or swap events; aborting."
          );
          return;
        }
      }
    }

    const tokensAddress: ITokenAddress[] = [
      {
        tokenAddress,
        totalSupply: Number(totalSupplyStr),
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
    await processFourMemes(tokensAddress, logs, tx, chainSymbol, bnbPrice);
    // await processPancakeTokenCreate(providerUrl, async (pairInfo) => {
    //   // You can insert DB saving or Telegram alert logic here
    //   console.log("🔥 Detected new pair creation:", pairInfo);
    // });
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
    "0x4f4b9a0b1f290ad0e2a9912ab8bb5162bd18a26455561b9d95148878f209bc3f",
  ];

  for (const txHash of txHashes) {
    // await processTransaction(txHash);
    // await analyzeTokenCreationBSC(txHash);
    // await poolCreationUniswapV3(txHash);
    await pairCreationPancakeSwapV2(txHash);
    console.log("\n" + "=".repeat(80) + "\n");
  }

  // Other commented functions can be enabled as needed
  // await analyzeTokenCreationFourMeme(txHash);
  // await analyzeTokenCreationBSC(txHash);
  // etc.
}

main().catch(console.error);
