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
  /** Minimum hours from now that shift must start (default 3) */
  minimumHoursBeforeShift?: number;
  /** Base £/hr when posted 3–12 hours before shift start (default 17) */
  basePriceTier3to12?: number;
  /** Base £/hr when posted 12–24 hours before shift start (default 16) */
  basePriceTier12to24?: number;
  /** Base £/hr when posted 24+ hours before shift start (default 14) */
  basePriceTier24Plus?: number;
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
    minimumHoursBeforeShift: { type: Number, default: 3, min: 0 },
    basePriceTier3to12: { type: Number, default: 17, min: 0 },
    basePriceTier12to24: { type: Number, default: 16, min: 0 },
    basePriceTier24Plus: { type: Number, default: 14, min: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
