// poolCreation.schema.ts
import { Sender } from "@questdb/nodejs-client";
import connectDB from "../config/db";

export interface IPoolCreation {
  hash: string;
  tokenMint: string;
  creatorAddress: string;
  programId: string;
  poolAddress: string;
  tokenBalanceChanges?: string;
  tokenChanges?: {
    from: string;
    to: string;
    value: string;
  };
  totalSupply?: string;
  liquidityAdded?: string;
  txType?: string;
  liquidityAmounts?: { token0: string; token1: string };
  createdAt?: Date;
  updatedAt?: Date;
}

let sender: Sender | null = null;

const getSender = async (): Promise<Sender> => {
  if (!sender) {
    console.log("[DEBUG] Initializing QuestDB Sender...");
    sender = await connectDB();
    console.log("[DEBUG] QuestDB Sender initialized.");
  }
  return sender;
};

const createPoolCreationTable = async (): Promise<void> => {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS pool_creations (
        hash SYMBOL INDEX,
        tokenMint SYMBOL,
        creatorAddress SYMBOL,
        programId SYMBOL,
        tokenBalanceChanges STRING,
        tokenChangesFrom SYMBOL,
        tokenChangesTo SYMBOL,
        tokenChangesValue STRING,
        totalSupply STRING,
        liquidityAdded STRING,
        txType SYMBOL,
        poolAddress SYMBOL,
        liquidityToken0 STRING,
        liquidityToken1 STRING,
        timestamp TIMESTAMP
      ) TIMESTAMP(timestamp) PARTITION BY DAY WAL
    `;
    const params = new URLSearchParams();
    params.append("query", sql);
    console.log("[DEBUG] Sending CREATE TABLE query to QuestDB...");
    const response = await fetch(
      `http://localhost:9000/exec?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to create table: ${await response.text()}`);
    }
    const result = await response.json();
    console.log("PoolCreations table ensured:", result);
  } catch (err) {
    console.error("[ERROR] Table creation error (non-blocking):", err);
  }
};

export const createPoolCreation = async (
  data: Omit<IPoolCreation, "createdAt" | "updatedAt">
): Promise<IPoolCreation | null> => {
  await createPoolCreationTable();

  // CORE LOGIC FOR DUPLICATE PREVENTION BASED ON poolAddress
  console.log(`[DEBUG] Checking for existing pool: ${data.poolAddress}`);
  const existing = await findPoolCreationByPoolAddress(data.poolAddress);

  if (existing) {
    console.log(
      `[INFO] Pool creation for address ${data.poolAddress} already exists. Skipping insertion.`
    );
    return existing;
  }

  console.log(
    `[INFO] Pool creation for address ${data.poolAddress} not found. Proceeding with insert.`
  );
  // -------------------------------------------------------------

  const s = await getSender();
  console.log("[DEBUG] Got sender, starting processedData");
  const ts = Date.now();
  console.log("[DEBUG] ts set");
  const processedData = {
    ...data,
    hash: data.hash?.toLowerCase() || "",
    tokenMint: data.tokenMint?.toLowerCase() || "",
    creatorAddress: data.creatorAddress?.toLowerCase() || "",
    programId: data.programId?.toLowerCase() || "",
    liquidityAdded: data.liquidityAdded || "false",
    txType: data.txType || "Unknown",
    poolAddress: data.poolAddress?.toLowerCase() || "",
    tokenChangesFrom: data.tokenChanges?.from?.toLowerCase() || "",
    tokenChangesTo: data.tokenChanges?.to?.toLowerCase() || "",
    tokenChangesValue: data.tokenChanges?.value || "",
  };
  console.log("[DEBUG] processedData created");
  console.log(
    `[DEBUG] Preparing Line Protocol for hash: ${processedData.hash}`
  );

  // Group ALL symbols (tags) first
  const builder = s.table("pool_creations");
  if (processedData.hash) builder.symbol("hash", processedData.hash);
  if (processedData.tokenMint)
    builder.symbol("tokenMint", processedData.tokenMint);
  if (processedData.creatorAddress)
    builder.symbol("creatorAddress", processedData.creatorAddress);
  if (processedData.programId)
    builder.symbol("programId", processedData.programId);
  if (processedData.tokenChangesFrom)
    builder.symbol("tokenChangesFrom", processedData.tokenChangesFrom);
  if (processedData.tokenChangesTo)
    builder.symbol("tokenChangesTo", processedData.tokenChangesTo);
  if (processedData.txType) builder.symbol("txType", processedData.txType);
  if (processedData.poolAddress)
    builder.symbol("poolAddress", processedData.poolAddress);

  // Then ALL columns (fields)
  builder
    .stringColumn("tokenBalanceChanges", data.tokenBalanceChanges || "")
    .stringColumn("tokenChangesValue", processedData.tokenChangesValue)
    .stringColumn("totalSupply", data.totalSupply || "")
    .stringColumn("liquidityAdded", processedData.liquidityAdded)
    .stringColumn("liquidityToken0", data.liquidityAmounts?.token0 || "")
    .stringColumn("liquidityToken1", data.liquidityAmounts?.token1 || "");

  builder.at(ts, "ms");

  console.log(`[DEBUG] Flushing data for pool: ${processedData.poolAddress}`);
  try {
    await s.flush();
    console.log(
      `[INFO] Successfully inserted data for hash: ${processedData.hash}`
    );
  } catch (flushError) {
    console.error(
      `[FATAL] QuestDB Flush failed for hash ${processedData.hash}:`,
      flushError
    );
    return null;
  }

  // Return the newly created object
  return {
    ...processedData,
    createdAt: new Date(ts),
    updatedAt: new Date(ts),
  };
};

export const findPoolCreationByPoolAddress = async (
  targetPoolAddress: string
): Promise<IPoolCreation | null> => {
  try {
    const normalizedAddress = targetPoolAddress.toLowerCase();

    const rawQuery = `
      SELECT * FROM pool_creations
      WHERE poolAddress = '${normalizedAddress}'
      ORDER BY timestamp ASC
      LIMIT 1;
    `.trim();

    const response = await fetch(
      `http://localhost:9000/exec?query=${encodeURIComponent(rawQuery)}`,
      { method: "GET" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] QuestDB HTTP Error: ${errorText}`);
      throw new Error(`Query failed: ${errorText}`);
    }

    const result = await response.json();
    console.log(`[DEBUG] result: ${JSON.stringify(result)}`);

    if (!result.dataset?.length) {
      console.log(`[DEBUG] Query result: NOT FOUND`);
      return null;
    }

    console.log(`[DEBUG] Query result FOUND (${result.dataset.length} rows)`);

    const [
      hash,
      tokenMint,
      creatorAddress,
      programId,
      tokenBalanceChanges,
      tokenChangesFrom,
      tokenChangesTo,
      tokenChangesValue,
      totalSupply,
      liquidityAdded,
      txType,
      poolAddressResult,
      liquidityToken0,
      liquidityToken1,
      timestampStr,
    ] = result.dataset[0];

    return {
      hash,
      tokenMint,
      creatorAddress,
      programId,
      tokenBalanceChanges,
      tokenChanges: {
        from: tokenChangesFrom,
        to: tokenChangesTo,
        value: tokenChangesValue,
      },
      totalSupply,
      liquidityAdded,
      txType,
      poolAddress: poolAddressResult,
      liquidityAmounts: { token0: liquidityToken0, token1: liquidityToken1 },
      createdAt: new Date(timestampStr),
      updatedAt: new Date(timestampStr),
    };
  } catch (err) {
    console.error(`[ERROR] findPoolCreationByPoolAddress failed:`, err);
    return null;
  }
};

// New function: find by transaction hash
export const findPoolCreationByHash = async (
  hash: string
): Promise<IPoolCreation | null> => {
  try {
    const queryHash = hash.toLowerCase();
    const params = new URLSearchParams();
    const query = `SELECT * FROM pool_creations WHERE hash = '${queryHash}' LIMIT 1`;
    params.append("query", query);

    console.log(`[DEBUG] findPoolCreationByHash query: ${query}`);

    const response = await fetch(
      `http://localhost:9000/exec?${params.toString()}`,
      {
        method: "GET",
      }
    );
    if (!response.ok) {
      throw new Error(`Query failed: ${await response.text()}`);
    }
    const result = await response.json();

    if (!result.dataset || result.dataset.length === 0) {
      console.log(`[DEBUG] Query result for hash ${hash}: NOT FOUND`);
      return null;
    }

    console.log(`[DEBUG] Query result for hash ${hash}: FOUND`);
    const row = result.dataset[0];
    const [
      hashResult,
      tokenMint,
      creatorAddress,
      programId,
      tokenBalanceChanges,
      tokenChangesFrom,
      tokenChangesTo,
      tokenChangesValue,
      totalSupply,
      liquidityAdded,
      txType,
      poolAddress,
      liquidityToken0,
      liquidityToken1,
      timestampStr,
    ] = row;

    const tsDate = new Date(
      Number(timestampStr) * (timestampStr.endsWith("ms") ? 1 : 1000)
    );

    return {
      hash: hashResult,
      tokenMint: tokenMint,
      creatorAddress: creatorAddress,
      programId: programId,
      tokenBalanceChanges: tokenBalanceChanges,
      tokenChanges: {
        from: tokenChangesFrom,
        to: tokenChangesTo,
        value: tokenChangesValue,
      },
      totalSupply: totalSupply,
      liquidityAdded: liquidityAdded,
      txType: txType,
      poolAddress: poolAddress,
      liquidityAmounts: {
        token0: liquidityToken0,
        token1: liquidityToken1,
      },
      createdAt: tsDate,
      updatedAt: tsDate,
    };
  } catch (err) {
    console.error(`[ERROR] findPoolCreationByHash failed for ${hash}:`, err);
    return null;
  }
};

// For updates, since QuestDB is append-only, use SQL UPSERT or delete+insert.
export const updatePoolCreation = async (
  hash: string,
  data: Partial<Omit<IPoolCreation, "hash" | "createdAt" | "updatedAt">>
): Promise<IPoolCreation | null> => {
  console.log(`[DEBUG] Attempting update for hash: ${hash}`);
  // Find the original record by transaction hash
  const existing = await findPoolCreationByHash(hash);
  if (!existing) {
    console.log(`[INFO] Update failed: Original hash ${hash} not found.`);
    return null;
  }

  // For simplicity, delete and re-insert (inefficient for large scale)
  try {
    const deleteParams = new URLSearchParams();
    const deleteQuery = `DELETE FROM pool_creations WHERE hash = '${hash.toLowerCase()}'`;
    deleteParams.append("query", deleteQuery);

    console.log(`[DEBUG] Sending DELETE query: ${deleteQuery}`);

    const deleteRes = await fetch(
      `http://localhost:9000/exec?${deleteParams.toString()}`,
      { method: "GET" }
    );
    if (!deleteRes.ok) {
      console.error("[ERROR] Delete failed:", await deleteRes.text());
    } else {
      console.log(`[INFO] Successfully deleted old record for hash: ${hash}`);
    }
  } catch (err) {
    console.error(`[ERROR] Delete operation failed for hash ${hash}:`, err);
  }

  const newData = {
    ...existing,
    ...data,
  };

  // Create a new entry.
  const created = await createPoolCreation(newData);
  return created ? { ...created, updatedAt: new Date() } : null;
};

// Close connection when done (e.g., in app shutdown)
export const closeDB = async (): Promise<void> => {
  if (sender) {
    console.log("[INFO] Closing QuestDB Sender connection.");
    await sender.close();
    sender = null;
  }
};

export default {
  createPoolCreation,
  findPoolCreationByPoolAddress,
  updatePoolCreation,
  findPoolCreationByHash,
  closeDB,
};
