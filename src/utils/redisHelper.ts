import Redis from "ioredis";
import dotconfig from "dotenv";
dotconfig.config();

const NODE_ENV = process.env.NODE_ENV || "development";
console.log(`NODE_ENV: ${NODE_ENV}`);
console.log(`env is ${process.env.NODE_ENV}`);
export const redis = new Redis({
  host: NODE_ENV === "development" ? "localhost" : "localhost",
  port: NODE_ENV === "development" ? 6379 : 6379,
  connectTimeout: 10000,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
});

// Error handling for Redis connection
redis.on("error", (err: Error) => {
  console.error(`Redis connection error: ${err.message}`);
  // Errors will appear in PM2 logs (e.g., ~/.pm2/logs/app-error.log)
});
