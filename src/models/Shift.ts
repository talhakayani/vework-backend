import mongoose, { Document, Schema } from 'mongoose';

export interface IShift extends Document {
  cafe: mongoose.Types.ObjectId;
  date: Date;
  startTime: string;
  endTime: string;
  requiredEmployees: number;
  description: string;
  status: 'pending_approval' | 'open' | 'accepted' | 'completed' | 'cancelled' | 'paused';
  acceptedBy: mongoose.Types.ObjectId[];
  blockedEmployees?: mongoose.Types.ObjectId[]; // Employees blocked from this shift by café owner
  baseHourlyRate: number;
  employeeHourlyRate?: number; // Admin-set rate visible only to employees
  platformFee: number;
  totalCost: number;
  penaltyApplied: boolean;
  penaltyAmount: number;
  // Penalty charged to employee for late cancellation
  employeePenaltyApplied: boolean;
  employeePenaltyAmount: number;
  location?: {
    address: string;
    latitude: number;
    longitude: number;
    placeId?: string;
  };
  paymentProof?: string; // Path to payment proof file (receipt/screenshot)
  createdAt: Date;
  updatedAt: Date;
}

const ShiftSchema = new Schema<IShift>(
  {
    cafe: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    requiredEmployees: {
      type: Number,
      required: true,
      min: 1,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending_approval', 'open', 'accepted', 'completed', 'cancelled', 'paused'],
      default: 'open',
    },
    acceptedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    blockedEmployees: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    baseHourlyRate: {
      type: Number,
      default: 14,
    },
    employeeHourlyRate: {
      type: Number,
      default: undefined, // Only set by admin during approval
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    penaltyApplied: {
      type: Boolean,
      default: false,
    },
    penaltyAmount: {
      type: Number,
      default: 0,
    },
    employeePenaltyApplied: {
      type: Boolean,
      default: false,
    },
    employeePenaltyAmount: {
      type: Number,
      default: 0,
    },
    location: {
      address: {
        type: String,
      },
      latitude: {
        type: Number,
      },
      longitude: {
        type: Number,
      },
      placeId: {
        type: String,
      },
    },
    paymentProof: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IShift>('Shift', ShiftSchema);
