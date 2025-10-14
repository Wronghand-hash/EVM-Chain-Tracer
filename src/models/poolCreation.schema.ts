// poolCreation.schema.ts
import { Sender } from "@questdb/nodejs-client";
import connectDB from "../config/db";

export interface IPoolCreation {
  hash: string;
  tokenMint: string;
  creatorAddress: string;
  programId: string;
  tokenBalanceChanges?: string;
  tokenChanges?: {
    from: string;
    to: string;
    value: string;
  };
  totalSupply?: string;
  liquidityAdded?: boolean;
  txType?: string;
  poolAddress?: string;
  liquidityAmounts?: { token0: string; token1: string };
  createdAt?: Date;
  updatedAt?: Date;
}

let sender: Sender | null = null;

const getSender = async (): Promise<Sender> => {
  if (!sender) {
    sender = await connectDB();
  }
  return sender;
};

const createPoolCreationTable = async (): Promise<void> => {
  try {
    // One-time: Uncomment to drop existing non-WAL table (run once, then comment out)
    const dropSql = `DROP TABLE IF EXISTS pool_creations`;
    const dropParams = new URLSearchParams();
    dropParams.append("query", dropSql);
    const dropResponse = await fetch(
      `http://localhost:9000/exec?${dropParams.toString()}`,
      { method: "GET" }
    );
    if (dropResponse.ok) {
      console.log("Existing table dropped for WAL migration.");
    }

    const sql = `
      CREATE TABLE pool_creations (
        hash SYMBOL INDEX,
        tokenMint SYMBOL,
        creatorAddress SYMBOL,
        programId SYMBOL,
        tokenBalanceChanges STRING,
        tokenChangesFrom SYMBOL,
        tokenChangesTo SYMBOL,
        tokenChangesValue STRING,
        totalSupply STRING,
        liquidityAdded BOOLEAN,
        txType SYMBOL,
        poolAddress SYMBOL,
        liquidityToken0 STRING,
        liquidityToken1 STRING,
        timestamp TIMESTAMP
      ) TIMESTAMP(timestamp) PARTITION BY NONE
    `;
    const params = new URLSearchParams();
    params.append("query", sql);
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
    console.log("PoolCreations WAL table ensured:", result);
  } catch (err) {
    console.error("Table creation error (non-blocking):", err);
  }
};

export const createPoolCreation = async (
  data: Omit<IPoolCreation, "createdAt" | "updatedAt">
): Promise<IPoolCreation> => {
  await createPoolCreationTable();
  const s = await getSender();
  const ts = Date.now();
  const processedData = {
    ...data,
    hash: data.hash.toLowerCase(),
    tokenMint: data.tokenMint?.toLowerCase() || "",
    creatorAddress: data.creatorAddress.toLowerCase(),
    programId: data.programId.toLowerCase(),
    liquidityAdded: data.liquidityAdded || false,
    txType: data.txType || "Unknown",
    poolAddress: data.poolAddress?.toLowerCase() || "",
    tokenChangesFrom: data.tokenChanges?.from?.toLowerCase() || "",
    tokenChangesTo: data.tokenChanges?.to?.toLowerCase() || "",
    tokenChangesValue: data.tokenChanges?.value || "",
  };

  // Group ALL symbols (tags) first
  s.table("pool_creations")
    .symbol("hash", processedData.hash)
    .symbol("tokenMint", processedData.tokenMint)
    .symbol("creatorAddress", processedData.creatorAddress)
    .symbol("programId", processedData.programId)
    .symbol("tokenChangesFrom", processedData.tokenChangesFrom)
    .symbol("tokenChangesTo", processedData.tokenChangesTo)
    .symbol("txType", processedData.txType)
    .symbol("poolAddress", processedData.poolAddress)

    // Then ALL columns (fields)
    .stringColumn("tokenBalanceChanges", data.tokenBalanceChanges || "")
    .stringColumn("tokenChangesValue", processedData.tokenChangesValue)
    .stringColumn("totalSupply", data.totalSupply || "")
    .booleanColumn("liquidityAdded", processedData.liquidityAdded)
    .stringColumn("liquidityToken0", data.liquidityAmounts?.token0 || "")
    .stringColumn("liquidityToken1", data.liquidityAmounts?.token1 || "")

    .at(ts, "ms");
  await s.flush();
  return {
    ...processedData,
    createdAt: new Date(ts),
    updatedAt: new Date(ts),
  };
};

export const findPoolCreationByHash = async (
  hash: string
): Promise<IPoolCreation | null> => {
  try {
    const queryHash = hash.toLowerCase();
    const params = new URLSearchParams();
    params.append(
      "query",
      `SELECT * FROM pool_creations WHERE hash = '${queryHash}' LIMIT 1`
    );
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
    if (result.data?.length === 0) {
      return null;
    }
    const row = result.data[0];
    const [
      h,
      tm,
      ca,
      pi,
      tbc,
      tcf,
      tct,
      tcv,
      ts,
      la,
      txt,
      pa,
      lt0,
      lt1,
      tsStr,
    ] = row;
    const tsDate = new Date(Number(tsStr) * (tsStr.endsWith("ms") ? 1 : 1000));
    return {
      hash: h,
      tokenMint: tm,
      creatorAddress: ca,
      programId: pi,
      tokenBalanceChanges: tbc,
      tokenChanges: {
        from: tcf,
        to: tct,
        value: tcv,
      },
      totalSupply: ts,
      liquidityAdded: Boolean(la),
      txType: txt,
      poolAddress: pa,
      liquidityAmounts: {
        token0: lt0,
        token1: lt1,
      },
      createdAt: tsDate,
      updatedAt: tsDate,
    };
  } catch (err) {
    console.error("Query error:", err);
    return null;
  }
};

// For updates, similar to tokenInfo, delete + insert for simplicity
export const updatePoolCreation = async (
  hash: string,
  data: Partial<Omit<IPoolCreation, "hash" | "createdAt" | "updatedAt">>
): Promise<IPoolCreation | null> => {
  const existing = await findPoolCreationByHash(hash);
  if (!existing) return null;
  try {
    const deleteParams = new URLSearchParams();
    deleteParams.append(
      "query",
      `DELETE FROM pool_creations WHERE hash = '${hash.toLowerCase()}'`
    );
    const deleteRes = await fetch(
      `http://localhost:9000/exec?${deleteParams.toString()}`,
      { method: "GET" }
    );
    if (!deleteRes.ok) {
      console.error("Delete failed:", await deleteRes.text());
    }
  } catch (err) {
    console.error("Delete error:", err);
  }
  const newData = {
    ...existing,
    ...data,
  };
  const created = await createPoolCreation(newData);
  return { ...created, updatedAt: new Date() };
};

// Close connection when done
export const closeDB = async (): Promise<void> => {
  if (sender) {
    await sender.close();
    sender = null;
  }
};

export default {
  createPoolCreation,
  findPoolCreationByHash,
  updatePoolCreation,
  closeDB,
};
