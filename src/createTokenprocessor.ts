import { ethers, Interface } from "ethers";
// Assuming provider, TRANSFER_TOPIC, and transferIface are generic ERC20 constants
import { provider, TRANSFER_TOPIC, transferIface } from "./types/constants";
import { Transfer } from "./types/types";
import { formatAmount } from "./utils/utils"; // Used for display formatting

// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_DECIMALS = 18;

// Minimal ABI required to fetch all token metadata (External Call 2 & 3)
const MINIMAL_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

// Interface for the desired final output data
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
 * Analyzes a transaction to extract token creation details with minimal external calls.
 * * @param txHash The hash of the transaction to analyze.
 */
export async function analyzeTokenCreation(txHash: string): Promise<void> {
  let finalData: Partial<TokenCreationData> = { hash: txHash };

  try {
    // --- EXTERNAL CALL 1 (Initial Data Fetch) ---
    // Fetch both simultaneously for robustness, though receipt is often fetched first.
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

    // Set initial data fields
    const userWallet = transaction.from.toLowerCase();
    const txTo = transaction.to?.toLowerCase() || "0x";

    finalData.creatorAddress = userWallet;
    finalData.programId =
      txTo === "0x"
        ? receipt.contractAddress?.toLowerCase() || "N/A (Direct Deploy)"
        : txTo;

    console.log(`\n--- Checking Token Creation: ${txHash} ---`);
    console.log(`Status: Success ✅ | From: ${transaction.from} | To: ${txTo}`);
    console.log(`Block: ${receipt.blockNumber} | Deployer: ${userWallet}`);
    console.log(
      `Transaction Fee: ${ethers.formatEther(
        receipt.gasUsed * receipt.gasPrice
      )} ETH`
    );

    // --- LOG PARSING (Find Mint Event) ---
    let firstMint: Transfer | null = null;

    for (const log of receipt.logs) {
      if (!log.topics[0]) continue;
      const topic0 = log.topics[0].toLowerCase();

      if (topic0 === TRANSFER_TOPIC?.toLowerCase()) {
        try {
          const parsed = transferIface.parseLog(log);
          if (parsed && parsed.args.from.toLowerCase() === ZERO_ADDRESS) {
            firstMint = {
              token: log.address.toLowerCase(),
              from: parsed.args.from.toLowerCase(),
              to: parsed.args.to.toLowerCase(),
              value: parsed.args.value,
            };
            break; // Found the first mint, which defines the token address
          }
        } catch {}
      }
    }

    if (!firstMint) {
      console.log(
        "No initial mint (transfer from zero address) found. Not a standard token creation."
      );
      return;
    }

    // Set fields derived from the mint log
    finalData.tokenMint = firstMint.token;
    finalData.tokenChanges = {
      from: firstMint.from,
      to: firstMint.to,
      value: firstMint.value.toString(),
    };

    // --- EXTERNAL CALLS 2 & 3 (Fetch Metadata & Supply) ---
    let fetchedName = "Unknown";
    let fetchedSymbol = "UNK";
    let fetchedDecimals = DEFAULT_DECIMALS;
    let fetchedTotalSupply = firstMint.value.toString(); // Default to minted amount

    try {
      const tokenContract = new ethers.Contract(
        finalData.tokenMint,
        MINIMAL_TOKEN_ABI,
        provider
      );

      // Use Promise.all to fetch all metadata concurrently (treated as 2 calls: one for supply, one for metadata)
      const [nameResult, symbolResult, decimalsResult, totalSupplyResult] =
        await Promise.all([
          tokenContract.name().catch(() => "Unknown"),
          tokenContract.symbol().catch(() => "UNK"),
          tokenContract.decimals().catch(() => DEFAULT_DECIMALS),
          tokenContract.totalSupply().catch(() => firstMint.value),
        ]);

      fetchedName = nameResult;
      fetchedSymbol = symbolResult;
      fetchedDecimals = Number(decimalsResult);
      fetchedTotalSupply = totalSupplyResult.toString();
    } catch (e) {
      console.warn(
        "⚠️ Failed to fetch full token metadata from the contract. Using log-only defaults."
      );
    }

    // Finalize all data fields
    finalData.name = fetchedName;
    finalData.symbol = fetchedSymbol;
    finalData.decimals = fetchedDecimals;
    finalData.totalSupply = fetchedTotalSupply;
    finalData.tokenBalanceChanges = formatAmount(
      firstMint.value,
      fetchedDecimals,
      fetchedSymbol
    );

    // --- Output Results ---
    console.log("\n✅ Token Creation Successfully Analyzed (Minimal Calls)");
    console.log("-------------------------------------------------------");
    console.log(`Token Address (Mint): ${finalData.tokenMint}`);
    console.log(
      `Token Name/Symbol:    ${finalData.name} (${finalData.symbol})`
    );
    console.log(`Decimals:             ${finalData.decimals}`);
    console.log(
      `Total Supply:         ${formatAmount(
        BigInt(finalData.totalSupply),
        finalData.decimals!,
        finalData.symbol!
      )}`
    );
    console.log(`Initial Mint Amount:  ${finalData.tokenBalanceChanges}`);
    console.log(`Initial Recipient:    ${finalData.tokenChanges.to}`);
    console.log(`Contract/Factory ID:  ${finalData.programId}`);
    console.log(`Creator Address:      ${finalData.creatorAddress}`);
    console.log(`Transaction Hash:     ${finalData.hash}`);
    console.log("-------------------------------------------------------");
  } catch (err) {
    console.error(
      `Error analyzing token creation in transaction ${txHash}: ${
        (err as Error).message
      }`
    );
  }
}
