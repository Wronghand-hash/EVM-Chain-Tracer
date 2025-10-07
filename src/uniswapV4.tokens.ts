import { ethers, Interface } from "ethers";
// Assuming provider is a generic Ethereum provider
import { provider } from "./types/constants"; // Adjust path as needed
import { formatAmount } from "./utils/utils"; // Used for display formatting if needed

// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f1606f49c0f4f7d4e3b4d8f0a7";

// ABI fragment for standard ERC-20 metadata calls
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];
const ERC20_INTERFACE = new Interface(ERC20_ABI);

// ABI fragment for Initialize event
const INITIALIZE_ABI = [
  "event Initialize(bytes32 indexed id, address indexed sender, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
];

// Interface for the desired final output data
interface PoolCreationData {
  poolId: string;
  currency0: string;
  currency1: string;
  token0Name: string;
  token0Symbol: string;
  token0Decimals?: number;
  token1Name: string;
  token1Symbol: string;
  token1Decimals?: number;
  fee: number;
  tickSpacing: number;
  hooks: string;
  sqrtPriceX96: string;
  tick: number;
  creatorAddress: string;
  hash: string;
}

interface TokenCreationData {
  tokenMint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  programId: string; // EVM concept: Contract/Factory Address called by the transaction
  decimals?: number;
  tokenBalanceChanges?: string; // Formatted initial mint amount
  tokenChanges?: {
    // Raw log data from the mint event
    from: string;
    to: string;
    value: string;
  };
  hash: string;
  totalSupply?: string; // Formatted total supply
}

/**
 * Helper to extract token metadata, prioritizing direct contract calls.
 * Falls back to Etherscan scraping only for Total Supply or on contract call failure.
 * @param contractAddr The address of the token contract.
 */
async function extractTokenMetadata(
  contractAddr: string
): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
}> {
  let name = "Unknown";
  let symbol = "UNK";
  let decimals = DEFAULT_DECIMALS;
  let totalSupply = "0";

  console.log(
    `[DEBUG] Starting contract metadata calls for ${contractAddr}...`
  );

  // --- 1. Contract Calls (Primary Method) ---
  try {
    const contract = new ethers.Contract(contractAddr, ERC20_ABI, provider);

    // Call Name
    name = await contract.name();
    console.log(`[DEBUG] Contract Call Success: Name is ${name}`);

    // Call Symbol
    symbol = await contract.symbol();
    console.log(`[DEBUG] Contract Call Success: Symbol is ${symbol}`);

    // Call Decimals
    const fetchedDecimals = await contract.decimals();
    decimals = Number(fetchedDecimals);
    console.log(`[DEBUG] Contract Call Success: Decimals is ${decimals}`);

    // Call Total Supply (use raw BigInt output here)
    const fetchedTotalSupply = await contract.totalSupply();
    totalSupply = fetchedTotalSupply.toString();
    console.log(
      `[DEBUG] Contract Call Success: Total Supply is ${totalSupply}`
    );

    // If all contract calls succeed, we skip Etherscan scraping
    return { name, symbol, decimals, totalSupply };
  } catch (e) {
    console.warn(
      `[WARNING] Contract calls failed for ${contractAddr}. Falling back to Etherscan scraping. Error: ${
        (e as Error).message
      }`
    );
    // Reset/Default values if contract calls failed, and proceed to scraping
    name = "Unknown";
    symbol = "UNK";
    decimals = DEFAULT_DECIMALS; // Use default if call failed
    totalSupply = "0";
  }

  // --- 2. Etherscan Scraping (Fallback Method for Total Supply or General Failure) ---
  const etherscanUrl = `https://etherscan.io/token/${contractAddr}`;
  console.log(`[DEBUG] Attempting to fetch metadata from: ${etherscanUrl}`);

  try {
    const fetchOptions = {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)" },
    };
    const response = await fetch(etherscanUrl, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    console.log(`[DEBUG] Fetched HTML content length: ${html.length}`);

    // --- Scraping Total Supply (Most reliable field on Etherscan for unverified tokens) ---
    console.log("[DEBUG] Starting Total Supply extraction (Scrape)...");

    // Look for Total Supply near a hash-tag span which often holds the truncated value
    let totalSupplyMatch = html.match(
      /Total\s*Supply.*?title=['"]([\d,\.]+)[^>]*>(?:\s*<span[^>]*>)?([\d,]+)/is
    );

    if (totalSupplyMatch) {
      // Group 1 contains the full, tooltip-style number (e.g., "4,810,327.29...")
      let fullNumber = totalSupplyMatch[1].trim();
      // Clean up the number by removing commas and any decimal points/trailing zeros
      let cleanedSupply = fullNumber.split(".")[0].replace(/,/g, "");
      totalSupply = cleanedSupply;

      // New log reflecting the successful scraping attempt
      console.log(
        `[DEBUG] Total Supply Match 1 (Scrape) result: Matched Tooltip: ${fullNumber}, Extracted: ${totalSupply}`
      );
    } else {
      console.log("[DEBUG] Total Supply Match 1 (Scrape) result: null");
    }

    // Attempt to scrape Decimals only if it failed to retrieve it from contract calls
    if (decimals === DEFAULT_DECIMALS) {
      console.log("[DEBUG] Starting Decimals extraction (Scrape)...");
      // Look for Decimals label near a column/span containing 1-2 digits
      let decMatch = html.match(
        /Decimals.*?class=\"col-md-8[^>]*>(\d{1,2})[^<]*/is
      );
      if (!decMatch) {
        decMatch = html.match(/Decimals.*?(\d{1,2})/is);
      }
      console.log(
        "[DEBUG] Decimals Match (Scrape) result:",
        decMatch ? decMatch.slice(0, 3) : null
      );
      if (decMatch) {
        decimals = parseInt(decMatch[1].trim());
      }
    }
  } catch (e) {
    console.warn(
      `[ERROR] Etherscan scraping failed for ${contractAddr}: ${
        (e as Error).message
      }`
    );
  }

  // --- 3. Final Return ---
  return { name, symbol, decimals, totalSupply };
}

// --------------------------------------------------------------------------------

/**
 * Analyzes a transaction to extract Uniswap V4 pool creation details via Initialize event.
 * Falls back to token creation analysis if no Initialize event found.
 * @param txHash The transaction hash to analyze.
 */
export async function analyzeUniswapV4Pool(txHash: string): Promise<void> {
  let finalData: Partial<PoolCreationData> = { hash: txHash };
  let isTokenFallback = false;

  try {
    // Fetch transaction data
    const [receipt, transaction] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getTransaction(txHash),
    ]);

    // ... (Transaction status and fee logic remains the same) ...

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

    console.log(`\n--- Checking Uniswap V4 Pool Creation: ${txHash} ---`);
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Creator: ${userWallet}`);
    console.log(
      `Transaction Fee: ${ethers.formatEther(
        receipt.gasUsed * receipt.gasPrice
      )} ETH`
    );

    // Parse logs for Initialize event (omitted for brevity, assume logic remains the same)
    const initializeIface = new Interface(INITIALIZE_ABI);
    let firstInit: any = null;
    for (const log of receipt.logs) {
      try {
        const parsed = initializeIface.parseLog(log);
        if (parsed && parsed.name === "Initialize") {
          firstInit = {
            poolId: parsed.args.id,
            currency0: parsed.args.currency0.toLowerCase(),
            currency1: parsed.args.currency1.toLowerCase(),
            fee: Number(parsed.args.fee),
            tickSpacing: Number(parsed.args.tickSpacing),
            hooks: parsed.args.hooks.toLowerCase(),
            sqrtPriceX96: parsed.args.sqrtPriceX96.toString(),
            tick: Number(parsed.args.tick),
          };
          break;
        }
      } catch {}
    }

    if (!firstInit) {
      console.log(
        "No Initialize event found. Falling back to token creation analysis..."
      );
      isTokenFallback = true;

      // --- TOKEN FALLBACK LOGIC ---
      const contractAddr = receipt.contractAddress?.toLowerCase();
      if (!contractAddr || txTo !== "0x") {
        console.log(
          "No contract created in this transaction. Not a token deployment."
        );
        return;
      }

      // Check for Transfer events emitted by the new contract
      let hasTransfers = false;
      let transferCount = 0;
      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() === contractAddr &&
          log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase()
        ) {
          hasTransfers = true;
          transferCount++;
        }
      }

      if (!hasTransfers) {
        console.log(
          "Contract created but no Transfer events found. Assuming token creation and attempting metadata extraction."
        );
      }

      // It's a token creation
      const tokenData: Partial<TokenCreationData> = {
        hash: txHash,
        creatorAddress: userWallet,
        programId: "N/A (Direct Deploy)",
        tokenMint: contractAddr,
      };

      // --- METADATA EXTRACTION (Using Contract Calls + Fallback Scraping) ---
      const {
        name: fetchedName,
        symbol: fetchedSymbol,
        decimals: fetchedDecimals,
        totalSupply: fetchedTotalSupply,
      } = await extractTokenMetadata(contractAddr);

      console.log(
        `Metadata extracted from Contract Calls and Etherscan overview.`
      );
      console.log(`Extracted name: ${fetchedName}`);
      console.log(`Extracted symbol: ${fetchedSymbol}`);
      console.log(`Extracted decimals: ${fetchedDecimals}`);
      console.log(`Extracted total supply: ${fetchedTotalSupply}`);

      // --- Finalize token data ---
      tokenData.name = fetchedName;
      tokenData.symbol = fetchedSymbol;
      tokenData.decimals = fetchedDecimals;
      tokenData.totalSupply = fetchedTotalSupply;

      // Conditional message based on transfer events
      if (hasTransfers) {
        tokenData.tokenBalanceChanges = `Batch initial distribution via ${transferCount} transfers (see total supply)`;
      } else {
        tokenData.tokenBalanceChanges = `Initial distribution could not be determined (0 Transfer events). See Total Supply.`;
      }

      // --- Output Token Results ---
      console.log(
        "\n✅ Token Creation Successfully Analyzed (Fallback from V4 Check)"
      );
      console.log("-------------------------------------------------------");
      console.log(`Token Address (Mint): ${tokenData.tokenMint}`);
      console.log(
        `Token Name/Symbol:    ${tokenData.name} (${tokenData.symbol})`
      );
      console.log(`Decimals:             ${tokenData.decimals}`);
      console.log(`Total Supply:         ${tokenData.totalSupply}`);
      console.log(`Initial Mint Amount:  ${tokenData.tokenBalanceChanges}`);
      console.log(`Contract/Factory ID:  ${tokenData.programId}`);
      console.log(`Creator Address:      ${tokenData.creatorAddress}`);
      console.log(`Transaction Hash:     ${tokenData.hash}`);
      console.log("-------------------------------------------------------");
      return; // Exit after token analysis
    }

    // --- V4 Pool Logic (Only executes if Initialize event is found) ---
    // Set pool fields
    finalData.poolId = firstInit.poolId;
    finalData.currency0 = firstInit.currency0;
    finalData.currency1 = firstInit.currency1;
    finalData.fee = firstInit.fee;
    finalData.tickSpacing = firstInit.tickSpacing;
    finalData.hooks = firstInit.hooks;
    finalData.sqrtPriceX96 = firstInit.sqrtPriceX96;
    finalData.tick = firstInit.tick;

    // Extract metadata for both tokens (using the improved extractTokenMetadata helper)
    const tokens = [firstInit.currency0, firstInit.currency1];
    const [token0Data, token1Data] = await Promise.all(
      tokens.map(async (addr) => extractTokenMetadata(addr))
    );

    finalData.token0Name = token0Data.name;
    finalData.token0Symbol = token0Data.symbol;
    finalData.token0Decimals = token0Data.decimals;
    finalData.token1Name = token1Data.name;
    finalData.token1Symbol = token1Data.symbol;
    finalData.token1Decimals = token1Data.decimals;

    // Output Results (omitted for brevity, assume logic remains the same)
  } catch (err) {
    console.error(
      `Error analyzing in transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
