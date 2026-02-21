import mongoose, { Document, Schema } from 'mongoose';

export interface ISignupDraft extends Document {
  draftId: string;
  email?: string;
  userType: 'employee' | 'cafe';
  step: number;
  data: Record<string, unknown>;
  updatedAt: Date;
}

const SignupDraftSchema = new Schema<ISignupDraft>(
  {
    draftId: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true },
    userType: { type: String, enum: ['employee', 'cafe'], required: true },
    step: { type: Number, required: true, default: 1 },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// TTL: remove drafts older than 7 days
SignupDraftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.model<ISignupDraft>('SignupDraft', SignupDraftSchema);
