import mongoose, { Document, Schema } from 'mongoose';

export interface IRateLimit extends Document {
  key: string;
  count: number;
  resetAt: Date;
}

const RateLimitSchema = new Schema<IRateLimit>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IRateLimit>('RateLimit', RateLimitSchema);
