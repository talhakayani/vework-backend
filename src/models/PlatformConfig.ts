import mongoose, { Document, Schema } from 'mongoose';

export type PlatformBankDetailsType = 'uk_sort_code_account' | 'iban' | 'ach';

export interface IPlatformBankDetails {
  type: PlatformBankDetailsType;
  accountName: string;
  sortCode?: string;
  accountNumber?: string;
  iban?: string;
  bicSwift?: string;
  routingNumber?: string;
  achAccountNumber?: string;
}

export interface IPlatformConfig extends Document {
  key: string;
  bankDetails?: IPlatformBankDetails;
  employeePriceDeductionPercentage?: number; // Percentage to deduct from cafe's hourly rate for employees
  updatedAt: Date;
}

const PlatformConfigSchema = new Schema<IPlatformConfig>(
  {
    key: { type: String, required: true, unique: true, default: 'platform' },
    bankDetails: {
      type: {
        type: String,
        enum: ['uk_sort_code_account', 'iban', 'ach'],
      },
      accountName: String,
      sortCode: String,
      accountNumber: String,
      iban: String,
      bicSwift: String,
      routingNumber: String,
      achAccountNumber: String,
    },
    employeePriceDeductionPercentage: {
      type: Number,
      default: 25, // Default 25% deduction (e.g., £16 becomes £12)
      min: 0,
      max: 100,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
