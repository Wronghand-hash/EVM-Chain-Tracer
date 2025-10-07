import { ethers, Interface } from "ethers";
// Assuming provider is a generic Ethereum provider
import { provider } from "./types/constants"; // Adjust path as needed
import { formatAmount } from "./utils/utils"; // Used for display formatting if needed

// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f1606f49c0f4f7d4e3b4d8f0a7";

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
 * Helper to extract token metadata (name/symbol/decimals/totalSupply) - adapted from original logic.
 * Assumes ERC20; uses Etherscan fallback with robust regex.
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

  // Use a different Etherscan URL pattern for a more generic token/contract overview
  const etherscanUrl = `https://etherscan.io/token/${contractAddr}`;
  try {
    const fetchOptions = {
      // Must use a user agent for Etherscan to return proper HTML
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TokenAnalyzer/1.0)" },
    };
    // NOTE: This fetch call requires a running environment with the fetch API.
    const response = await fetch(etherscanUrl, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // 1. Extract Name (Look for "Token Name" or content in the main title area)
    let nameMatch = html.match(
      /<div\s+class="col-md-8">\s*<h1\s+class='h4\s+mb-0'>\s*<a[^>]*>\s*([^<]+)\s*<\/a>|Token Name.*?<span.*?>(.+?)<\/span>/i
    );
    if (nameMatch) {
      name = (nameMatch[1] || nameMatch[2] || name).trim();
    }

    // 2. Extract Symbol (Look for "Token Symbol" or content right next to the name/title)
    // Looking for the symbol often in a small badge/span next to the name
    let symbolMatch = html.match(
      /<span\s+class="font-weight-medium">(.*?)<\/span>[\s\S]*?(?:Token)?\s*Symbol/i
    );
    if (!symbolMatch) {
      // Fallback: search for symbol in the top title/badge area
      symbolMatch = html.match(
        /<h1[^>]*>.*?<span[^>]*class="font-size-2\s+align-middle">\(?(\w+)\)?<\/span>/i
      );
    }
    if (symbolMatch) {
      symbol = symbolMatch[1].trim().replace(/\(|\)/g, ""); // Clean parentheses
    }

    // 3. Extract Decimals (A section labeled 'Decimals')
    let decMatch = html.match(/Decimals\s*:\s*<\/span>.*?<span[^>]*>(\d+)/i);
    if (!decMatch) {
      // Fallback to simpler search
      decMatch = html.match(/Decimals.*?(\d+)/i);
    }
    if (decMatch) {
      decimals = parseInt(decMatch[1].trim());
    }

    // 4. Extract Total Supply (A section labeled 'Total Supply')
    let totalSupplyMatch = html.match(
      /Total\s*Supply\s*:\s*<\/span>.*?<span[^>]*>([\d,\.]+(?:\s*[A-Z]+)?)/i
    );
    if (!totalSupplyMatch) {
      // Fallback to simpler search
      totalSupplyMatch = html.match(/Total Supply.*?([\d,\.]+)\s*(\w+)/i);
    }
    if (totalSupplyMatch) {
      // Group 1 is the number (e.g., "100,000.00") and optionally group 2 is the symbol
      totalSupply = (
        totalSupplyMatch[1] +
        (totalSupplyMatch[2] ? ` ${totalSupplyMatch[2]}` : "")
      ).trim();
      // Remove commas from the number portion for cleaner log
      totalSupply = totalSupply.replace(/,(\d{3})/g, "$1").trim();
    }
  } catch (e) {
    console.warn(
      `Failed to fetch/parse Etherscan for ${contractAddr}: ${
        (e as Error).message
      }`
    );
  }
  return { name, symbol, decimals, totalSupply };
}

/**
 * Analyzes a transaction to extract Uniswap V4 pool creation details via Initialize event.
 * Falls back to token creation analysis if no Initialize event found.
 * Extracts token metadata (name/symbol/decimals) for currency0 and currency1 using similar fallback logic.
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

    // Parse logs for Initialize event
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

      // --- TOKEN FALLBACK LOGIC (Enhanced for no-mint-from-zero cases) ---
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

      // --- METADATA EXTRACTION (Using extractTokenMetadata helper for consistency) ---
      const {
        name: fetchedName,
        symbol: fetchedSymbol,
        decimals: fetchedDecimals,
        totalSupply: fetchedTotalSupply,
      } = await extractTokenMetadata(contractAddr);

      console.log(`Metadata extracted from Etherscan overview.`);
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

    // Extract metadata for both tokens
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

    // Output Results
    console.log("\n✅ Uniswap V4 Pool Creation Successfully Analyzed");
    console.log("-------------------------------------------------------");
    console.log(`Pool ID: ${finalData.poolId}`);
    console.log(
      `Currency 0: ${finalData.currency0} (${finalData.token0Name} / ${finalData.token0Symbol}) - Decimals: ${finalData.token0Decimals}`
    );
    console.log(
      `Currency 1: ${finalData.currency1} (${finalData.token1Name} / ${finalData.token1Symbol}) - Decimals: ${finalData.token1Decimals}`
    );
    console.log(
      `Fee: ${finalData.fee} | Tick Spacing: ${finalData.tickSpacing}`
    );
    console.log(
      `Hooks: ${finalData.hooks} | Initial Sqrt Price: ${finalData.sqrtPriceX96} | Tick: ${finalData.tick}`
    );
    console.log(`Creator Address: ${finalData.creatorAddress}`);
    console.log(`Transaction Hash: ${finalData.hash}`);
    console.log("-------------------------------------------------------");
  } catch (err) {
    console.error(
      `Error analyzing in transaction ${txHash}: ${(err as Error).message}`
    );
  }
}
