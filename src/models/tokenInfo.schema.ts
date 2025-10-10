import { Schema, model, Document } from "mongoose";

export interface ITokenInfo extends Document {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
}

const tokenInfoSchema = new Schema<ITokenInfo>(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 18,
    },
    symbol: {
      type: String,
      required: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "token_infos",
  }
);

// Index for quick lookups
tokenInfoSchema.index({ address: 1 });

export default model<ITokenInfo>("TokenInfo", tokenInfoSchema);
