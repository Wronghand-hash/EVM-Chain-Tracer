import { Schema, model, Document } from "mongoose";

export interface IPoolToken extends Document {
  poolAddress: string;
  token0: string;
  token1: string;
}

const poolTokenSchema = new Schema<IPoolToken>(
  {
    poolAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    token0: {
      type: String,
      required: true,
      lowercase: true,
    },
    token1: {
      type: String,
      required: true,
      lowercase: true,
    },
  },
  {
    timestamps: true,
    collection: "pool_tokens",
  }
);

// Index for quick lookups
poolTokenSchema.index({ poolAddress: 1 });

export default model<IPoolToken>("PoolToken", poolTokenSchema);
