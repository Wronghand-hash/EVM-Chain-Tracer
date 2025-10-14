import { ethers } from "ethers";
import {
  provider,
  TRANSFER_TOPIC,
  transferIface,
} from "../types/Bsc/constants";
import { formatAmount } from "../utils/bsc/utils";
import { Transfer } from "../types/Etherium/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
const PANCAKESWAP_ROUTER_V2 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const UNISWAP_V3_POSITION_MANAGER =
  "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613";
const UNISWAP_V3_FACTORY = "0xDb1D10011AD0FF90774D0C6bB92e5C5c8b4461f7"; // BSC Uniswap V3 Factory
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const FOURMEME_FACTORY = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";

// Uniswap V3 ABIs for parsing logs
const UNISWAP_V3_FACTORY_ABI = [
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
];
const UNISWAP_V3_POOL_ABI = [
  "event Initialize(uint160 sqrtPriceX96, int24 tick)",
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
];
const UNISWAP_V3_POSITION_MANAGER_ABI = [
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];
const factoryIface = new ethers.utils.Interface(UNISWAP_V3_FACTORY_ABI);
const poolIface = new ethers.utils.Interface(UNISWAP_V3_POOL_ABI);
const positionManagerIface = new ethers.utils.Interface(
  UNISWAP_V3_POSITION_MANAGER_ABI
);

interface TokenCreationData {
  tokenMint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  programId: string;
  decimals?: number;
  tokenBalanceChanges?: string;
  tokenChanges?: {
    from: string;
    to: string;
    value: string;
  };
  hash: string;
  totalSupply?: string;
  liquidityAdded?: boolean;
  txType?: string;
  poolAddress?: string;
  liquidityAmounts?: { token0: string; token1: string };
}

interface ParsedLog {
  event: string;
  args: any;
}

export async function poolCreationUniswapV3(txHash: string): Promise<void> {
  let finalData: Partial<TokenCreationData> = { hash: txHash };
  let detectedTokens: string[] = [];
  let liquidityAdded = false;
  let txType = "Unknown Transaction";
  let poolAddress = "";
  let liquidityAmounts: { token0: string; token1: string } | null = null;
  try {
    const [receipt, transaction] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);
    if (!receipt || receipt.status !== 1) {
      console.log(
        `Transaction ${
          receipt?.status === 0 ? "failed" : "not found"
        }: ${txHash}`
      );
      return;
    }
    if (!transaction) throw new Error(`Transaction not found: ${txHash}`);
    const userWallet = transaction.from.toLowerCase();
    const txTo = transaction.to?.toLowerCase() || "0x";
    finalData.creatorAddress = userWallet;
    finalData.programId =
      txTo === "0x"
        ? receipt.contractAddress?.toLowerCase() || "N/A (Direct Deploy)"
        : txTo;
    console.log(`\n--- Analyzing BSC Transaction: ${txHash} ---`);
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Initiator: ${userWallet}`);

    // Parse ALL logs (no debug output)
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();
      let parsed: ParsedLog | null = null;

      // Try ERC-20 Transfer
      if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        // Skip ERC-721 (empty data)
        if (log.data.length === 0) continue;
        try {
          const transferParsed = transferIface.parseLog(log);
          detectedTokens.push(log.address.toLowerCase());
        } catch {}
      }

      // Try Uniswap V3 Factory: PoolCreated
      if (
        topic0 ===
          ethers.utils
            .id("PoolCreated(address,address,uint24,int24,address)")
            .toLowerCase() &&
        log.address.toLowerCase() === UNISWAP_V3_FACTORY.toLowerCase()
      ) {
        try {
          const factoryParsed = factoryIface.parseLog(log);
          poolAddress = factoryParsed.args.pool.toLowerCase();
          detectedTokens.push(factoryParsed.args.token0.toLowerCase());
          detectedTokens.push(factoryParsed.args.token1.toLowerCase());
          txType = "Uniswap V3 Pool Creation + Liquidity Addition";
          liquidityAdded = true;
        } catch {}
      }

      // Try Uniswap V3 Pool: Initialize
      if (
        topic0 === ethers.utils.id("Initialize(uint160,int24)").toLowerCase() &&
        log.address.toLowerCase() === poolAddress
      ) {
        try {
          const poolInitParsed = poolIface.parseLog(log);
        } catch {}
      }

      // Try Uniswap V3 Pool: Mint
      if (
        topic0 ===
          ethers.utils
            .id("Mint(address,address,int24,int24,uint128,uint256,uint256)")
            .toLowerCase() &&
        log.address.toLowerCase() === poolAddress
      ) {
        try {
          const poolMintParsed = poolIface.parseLog(log);
          liquidityAmounts = {
            token0: poolMintParsed.args.amount0.toString(),
            token1: poolMintParsed.args.amount1.toString(),
          };
        } catch {}
      }

      // Try Position Manager: IncreaseLiquidity
      if (
        topic0 ===
          ethers.utils
            .id("IncreaseLiquidity(uint256,uint128,uint256,uint256)")
            .toLowerCase() &&
        log.address.toLowerCase() === UNISWAP_V3_POSITION_MANAGER.toLowerCase()
      ) {
        try {
          const pmParsed = positionManagerIface.parseLog(log);
          liquidityAmounts = {
            token0: pmParsed.args.amount0.toString(),
            token1: pmParsed.args.amount1.toString(),
          };
          txType = "Uniswap V3 Liquidity Addition";
          liquidityAdded = true;
        } catch {}
      }

      // Try Position Manager: Transfer (ERC-721)
      if (
        topic0 === TRANSFER_TOPIC?.toLowerCase() &&
        log.address.toLowerCase() ===
          UNISWAP_V3_POSITION_MANAGER.toLowerCase() &&
        log.data.length === 0
      ) {
      }

      // Try WBNB Deposit
      if (
        topic0 === ethers.utils.id("Deposit(address,uint256)").toLowerCase() &&
        log.address.toLowerCase() === WBNB_ADDRESS.toLowerCase()
      ) {
        try {
          const wbnbIface = new ethers.utils.Interface([
            "event Deposit(address indexed dst, uint256 wad)",
          ]);
          const depositParsed = wbnbIface.parseLog(log);
        } catch {}
      }
    }

    // Dedupe and sort detected tokens (exclude known like WBNB, Position Manager)
    detectedTokens = [...new Set(detectedTokens)]
      .filter(
        (addr) =>
          addr !== WBNB_ADDRESS.toLowerCase() &&
          addr !== UNISWAP_V3_POSITION_MANAGER.toLowerCase()
      )
      .sort();

    // Scan for initial mint
    let firstMint: Transfer | null = null;
    for (const log of receipt.logs) {
      if (
        log.topics[0]?.toLowerCase() === TRANSFER_TOPIC?.toLowerCase() &&
        log.data.length > 0
      ) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed && parsed.args.from.toLowerCase() === ZERO_ADDRESS) {
            firstMint = {
              token: log.address.toLowerCase(),
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            };
            txType = "Token Creation";
            break;
          }
        } catch {}
      }
    }

    if (firstMint) {
      finalData.tokenMint = firstMint.token;
      finalData.tokenChanges = {
        from: firstMint.from,
        to: firstMint.to,
        value: firstMint.value.toString(),
      };
    } else if (detectedTokens.length > 0) {
      // Use first non-WBNB token as focus (e.g., ASTER)
      finalData.tokenMint = detectedTokens[0];
    } else {
      console.log("No token-related activity detected.");
      return;
    }

    // Liquidity detection from tx data (fallback)
    if (!liquidityAdded) {
      if (txTo === PANCAKESWAP_ROUTER_V2.toLowerCase() && transaction.data) {
        const addLiquiditySig = "0xe8e33700";
        const addLiquidityETHSig = "0xf305d719";
        if (
          transaction.data.startsWith(addLiquiditySig) ||
          transaction.data.startsWith(addLiquidityETHSig)
        ) {
          liquidityAdded = true;
          txType = "PancakeSwap Liquidity Addition";
        }
      } else if (
        txTo === UNISWAP_V3_POSITION_MANAGER.toLowerCase() &&
        transaction.data
      ) {
        const mintSig = "0x9c1e88c5";
        const increaseLiquiditySig = "0xcbc14191";
        if (
          transaction.data.startsWith(mintSig) ||
          transaction.data.startsWith(increaseLiquiditySig)
        ) {
          liquidityAdded = true;
          txType = "Uniswap V3 Liquidity Addition";
        }
      } else if (txTo === FOURMEME_FACTORY.toLowerCase()) {
        liquidityAdded = true;
        txType = "Four.meme Token Creation with Liquidity";
      }
    }

    finalData.liquidityAdded = liquidityAdded;
    finalData.txType = txType;
    if (poolAddress) finalData.poolAddress = poolAddress;
    if (liquidityAmounts) finalData.liquidityAmounts = liquidityAmounts;

    // Metadata extraction for the token (no external calls)
    const contractAddr = finalData.tokenMint!;
    let fetchedName = "Unknown";
    let fetchedSymbol = "UNK";
    let fetchedDecimals = DEFAULT_DECIMALS;
    let fetchedTotalSupply = "N/A";

    // Constructor parsing if deployment
    if (
      txTo === "0x" &&
      transaction.data &&
      transaction.data.length > 10 &&
      firstMint
    ) {
      const ERC20_ABI_WITH_DEC = [
        "constructor(string name, string symbol, uint8 decimals)",
      ];
      const ERC20_ABI_WITHOUT_DEC = ["constructor(string name, string symbol)"];
      const FOURMEME_CONSTRUCTOR_ABI = [
        "constructor(string name, string symbol, bytes32 maxSupply)",
      ];
      try {
        const ifaceWithDec = new ethers.utils.Interface(ERC20_ABI_WITH_DEC);
        const parsed = ifaceWithDec.parseTransaction({
          data: transaction.data,
        });
        if (parsed && parsed.name === "constructor") {
          fetchedName = parsed.args.name;
          fetchedSymbol = parsed.args.symbol;
          fetchedDecimals = Number(parsed.args.decimals);
          fetchedTotalSupply = firstMint.value.toString();
          finalData.name = fetchedName;
          finalData.symbol = fetchedSymbol;
          finalData.decimals = fetchedDecimals;
          finalData.totalSupply = fetchedTotalSupply;
          finalData.tokenBalanceChanges = formatAmount(
            firstMint.value,
            fetchedDecimals,
            fetchedSymbol
          );
          console.log(`Token Address:         ${finalData.tokenMint}`);
          console.log(
            `Token Name/Symbol:     ${finalData.name} (${finalData.symbol})`
          );
          console.log(`Decimals:              ${finalData.decimals}`);
          console.log(
            `Total Supply:          ${formatAmount(
              BigInt(finalData.totalSupply || "0"),
              finalData.decimals!,
              finalData.symbol!
            )}`
          );
          console.log(
            `Initial Mint Amount:   ${finalData.tokenBalanceChanges}`
          );
          console.log(`Initial Recipient:     ${finalData.tokenChanges!.to}`);
          console.log(
            `Liquidity Added:       ${
              finalData.liquidityAdded ? "Yes ✅" : "No"
            }`
          );
          console.log(`Transaction Type:      ${finalData.txType}`);
          console.log(`Contract/Factory ID:   ${finalData.programId}`);
          console.log(`Creator/Initiator:     ${finalData.creatorAddress}`);
          console.log(`Transaction Hash:      ${finalData.hash}`);
          return;
        }
      } catch {}

      if (fetchedName === "Unknown") {
        try {
          const ifaceWithoutDec = new ethers.utils.Interface(
            ERC20_ABI_WITHOUT_DEC
          );
          const parsed = ifaceWithoutDec.parseTransaction({
            data: transaction.data,
          });
          if (parsed && parsed.name === "constructor") {
            fetchedName = parsed.args.name;
            fetchedSymbol = parsed.args.symbol;
            fetchedTotalSupply = firstMint.value.toString();
            finalData.name = fetchedName;
            finalData.symbol = fetchedSymbol;
            finalData.decimals = fetchedDecimals;
            finalData.totalSupply = fetchedTotalSupply;
            finalData.tokenBalanceChanges = formatAmount(
              firstMint.value,
              fetchedDecimals,
              fetchedSymbol
            );
            console.log(`Token Address:         ${finalData.tokenMint}`);
            console.log(
              `Token Name/Symbol:     ${finalData.name} (${finalData.symbol})`
            );
            console.log(`Decimals:              ${finalData.decimals}`);
            console.log(
              `Total Supply:          ${formatAmount(
                BigInt(finalData.totalSupply || "0"),
                finalData.decimals!,
                finalData.symbol!
              )}`
            );
            console.log(
              `Initial Mint Amount:   ${finalData.tokenBalanceChanges}`
            );
            console.log(`Initial Recipient:     ${finalData.tokenChanges!.to}`);
            console.log(
              `Liquidity Added:       ${
                finalData.liquidityAdded ? "Yes ✅" : "No"
              }`
            );
            console.log(`Transaction Type:      ${finalData.txType}`);
            console.log(`Contract/Factory ID:   ${finalData.programId}`);
            console.log(`Creator/Initiator:     ${finalData.creatorAddress}`);
            console.log(`Transaction Hash:      ${finalData.hash}`);
            return; // Early exit
          }
        } catch {}
      }

      if (fetchedName === "Unknown") {
        try {
          const ifaceFourMeme = new ethers.utils.Interface(
            FOURMEME_CONSTRUCTOR_ABI
          );
          const parsed = ifaceFourMeme.parseTransaction({
            data: transaction.data,
          });
          if (parsed && parsed.name === "constructor") {
            fetchedName = parsed.args.name;
            fetchedSymbol = parsed.args.symbol;
            const maxSupplyHex = parsed.args.maxSupply as string;
            fetchedTotalSupply = BigInt(maxSupplyHex).toString();
            fetchedDecimals = DEFAULT_DECIMALS;
            finalData.name = fetchedName;
            finalData.symbol = fetchedSymbol;
            finalData.decimals = fetchedDecimals;
            finalData.totalSupply = fetchedTotalSupply;
            finalData.tokenBalanceChanges = formatAmount(
              firstMint.value,
              fetchedDecimals,
              fetchedSymbol
            );
            console.log(`Token Address:         ${finalData.tokenMint}`);
            console.log(
              `Token Name/Symbol:     ${finalData.name} (${finalData.symbol})`
            );
            console.log(`Decimals:              ${finalData.decimals}`);
            console.log(
              `Total Supply:          ${formatAmount(
                BigInt(finalData.totalSupply || "0"),
                finalData.decimals!,
                finalData.symbol!
              )}`
            );
            console.log(
              `Initial Mint Amount:   ${finalData.tokenBalanceChanges}`
            );
            console.log(`Initial Recipient:     ${finalData.tokenChanges!.to}`);
            console.log(
              `Liquidity Added:       ${
                finalData.liquidityAdded ? "Yes ✅" : "No"
              }`
            );
            console.log(`Transaction Type:      ${finalData.txType}`);
            console.log(`Contract/Factory ID:   ${finalData.programId}`);
            console.log(`Creator/Initiator:     ${finalData.creatorAddress}`);
            console.log(`Transaction Hash:      ${finalData.hash}`);
            return; // Early exit
          }
        } catch {}
      }
    }

    // Finalize
    finalData.name = fetchedName;
    finalData.symbol = fetchedSymbol;
    finalData.decimals = fetchedDecimals;
    finalData.totalSupply = fetchedTotalSupply;
    if (firstMint) {
      finalData.tokenBalanceChanges = formatAmount(
        firstMint.value,
        fetchedDecimals,
        fetchedSymbol
      );
    }

    // Output only specified lines
    console.log(`Token Address:         ${finalData.tokenMint}`);
    console.log(
      `Token Name/Symbol:     ${finalData.name} (${finalData.symbol})`
    );
    console.log(`Decimals:              ${finalData.decimals}`);
    console.log(
      `Total Supply:          ${
        fetchedTotalSupply === "N/A"
          ? "N/A"
          : formatAmount(
              BigInt(fetchedTotalSupply),
              finalData.decimals!,
              finalData.symbol!
            )
      }`
    );
    if (liquidityAdded && liquidityAmounts) {
      const isWBNBToken0 =
        (detectedTokens[0] || "").toLowerCase() === WBNB_ADDRESS.toLowerCase();
      const token0Name = isWBNBToken0 ? "WBNB" : fetchedName;
      const token1Name = isWBNBToken0 ? fetchedName : "WBNB";
      const token0Dec = isWBNBToken0 ? 18 : fetchedDecimals;
      const token1Dec = isWBNBToken0 ? fetchedDecimals : 18;
      console.log(
        `Liquidity Amounts:     ${formatAmount(
          BigInt(liquidityAmounts.token0),
          token0Dec,
          token0Name
        )} + ${formatAmount(
          BigInt(liquidityAmounts.token1),
          token1Dec,
          token1Name
        )}`
      );
    }
    if (poolAddress) {
      console.log(`Pool Address:          ${finalData.poolAddress}`);
    }
    console.log(
      `Liquidity Added:       ${finalData.liquidityAdded ? "Yes ✅" : "No"}`
    );
    console.log(`Transaction Type:      ${finalData.txType}`);
    console.log(`Contract/Factory ID:   ${finalData.programId}`);
    console.log(`Creator/Initiator:     ${finalData.creatorAddress}`);
    console.log(`Transaction Hash:      ${finalData.hash}`);
  } catch (err) {
    console.error(
      `Error analyzing transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
