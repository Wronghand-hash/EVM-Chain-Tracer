import { Sender } from "@questdb/nodejs-client";
import connectDB from "../config/db"; // Adjust path as needed

export interface ITokenInfo {
  address: string;
  symbol: string;
  name: string;
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

// Optional: Create table explicitly via REST API (assumes QuestDB REST at http://localhost:9000)
const createTokenInfoTable = async (): Promise<void> => {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS token_infos (
        address SYMBOL INDEX,
        symbol SYMBOL,
        name STRING,
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
    console.log("TokenInfos table ensured:", result);
  } catch (err) {
    console.error("Table creation error (non-blocking):", err);
    // Tables auto-create on first insert with inferred types, so this is optional
  }
};

// Insert a new token info (auto-creates table if not exists)
export const createTokenInfo = async (
  data: Omit<ITokenInfo, "createdAt" | "updatedAt">
): Promise<ITokenInfo> => {
  await createTokenInfoTable(); // Ensure table exists with proper schema
  const s = await getSender();
  const ts = Date.now();
  const processedData = {
    ...data,
    address: data.address.toLowerCase(),
    symbol: data.symbol.toUpperCase(),
  };
  s.table("token_infos")
    .symbol("address", processedData.address)
    .symbol("symbol", processedData.symbol)
    .stringColumn("name", processedData.name)
    .at(ts, "ms");
  await s.flush();
  return {
    ...processedData,
    createdAt: new Date(ts),
    updatedAt: new Date(ts),
  };
};

// Find token info by address (via REST API query)
export const findTokenInfoByAddress = async (
  address: string
): Promise<ITokenInfo | null> => {
  try {
    const queryAddress = address.toLowerCase();
    const params = new URLSearchParams();
    params.append(
      "query",
      `SELECT address, symbol, name, timestamp FROM token_infos WHERE address = '${queryAddress}' LIMIT 1`
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
    const [addr, sym, nam, tsStr] = result.data[0];
    const ts = new Date(Number(tsStr) * (tsStr.endsWith("ms") ? 1 : 1000)); // Handle ms or s
    return {
      address: addr,
      symbol: sym,
      name: nam,
      createdAt: ts,
      updatedAt: ts, // Assuming createdAt == updatedAt for simplicity
    };
  } catch (err) {
    console.error("Query error:", err);
    return null;
  }
};

// For updates, since QuestDB is append-only, use SQL UPSERT or delete+insert.
// Example: upsert via SQL
export const updateTokenInfo = async (
  address: string,
  data: Partial<Omit<ITokenInfo, "address" | "createdAt" | "updatedAt">>
): Promise<ITokenInfo | null> => {
  const existing = await findTokenInfoByAddress(address);
  if (!existing) return null;
  // For simplicity, delete and re-insert (inefficient for large scale)
  try {
    const deleteParams = new URLSearchParams();
    deleteParams.append(
      "query",
      `DELETE FROM token_infos WHERE address = '${address.toLowerCase()}'`
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
    address,
    symbol: existing.symbol,
    name: existing.name,
  };
  const created = await createTokenInfo(newData);
  return { ...created, updatedAt: new Date() };
};

// Close connection when done (e.g., in app shutdown)
export const closeDB = async (): Promise<void> => {
  if (sender) {
    await sender.close();
    sender = null;
  }
};

export default {
  createTokenInfo,
  findTokenInfoByAddress,
  updateTokenInfo,
  closeDB,
};
