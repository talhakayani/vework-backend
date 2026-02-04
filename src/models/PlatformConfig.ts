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
  employeePriceDeductionPercentage?: number; // Deprecated - employees pay no platform fee
  platformFeePerShift?: number; // £ per shift (employer pays, default 10)
  freeShiftsPerCafe?: number; // First N shifts per cafe are free (default 2)
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
      default: 0, // Employees pay NO platform fee
      min: 0,
      max: 100,
    },
    platformFeePerShift: { type: Number, default: 10, min: 0 },
    freeShiftsPerCafe: { type: Number, default: 2, min: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
