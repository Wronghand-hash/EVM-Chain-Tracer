import { Sender } from "@questdb/nodejs-client";
import dotenv from "dotenv";

dotenv.config();

let sender: Sender | null = null;

const connectDB = async (): Promise<Sender> => {
  if (sender) {
    return sender;
  }
  try {
    const config = process.env.QUESTDB_CONFIG || "http://127.0.0.1:9000";
    sender = await Sender.fromConfig(config);
    console.log(`QuestDB Connected via: ${config}`);
    return sender;
  } catch (err) {
    console.error("QuestDB Connection Error:", err);
    process.exit(1);
  }
};

export default connectDB;
