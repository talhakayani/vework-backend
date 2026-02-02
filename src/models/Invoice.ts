import mongoose, { Document, Schema } from 'mongoose';

export interface IInvoice extends Document {
  cafe: mongoose.Types.ObjectId;
  shift: mongoose.Types.ObjectId;
  invoiceNumber: string;
  shiftDetails: {
    date: Date;
    startTime: string;
    endTime: string;
    hours: number;
    employees: number;
  };
  baseAmount: number;
  platformFee: number;
  penaltyAmount: number;
  totalAmount: number;
  status: 'pending' | 'paid';
  createdAt: Date;
  paidAt?: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    cafe: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shift: {
      type: Schema.Types.ObjectId,
      ref: 'Shift',
      required: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    shiftDetails: {
      date: Date,
      startTime: String,
      endTime: String,
      hours: Number,
      employees: Number,
    },
    baseAmount: {
      type: Number,
      required: true,
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    penaltyAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
    },
    paidAt: Date,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);
