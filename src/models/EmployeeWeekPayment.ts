import mongoose, { Document, Schema } from 'mongoose';

/** One week's combined payment for one employee. Admin marks as paid with a single proof. */
export interface IEmployeeWeekPayment extends Document {
  employee: mongoose.Types.ObjectId;
  /** Monday 00:00 of the week (ISO week) */
  weekStart: Date;
  /** Total amount for that week (sum of all shifts) */
  amount: number;
  /** Shifts included in this payment */
  shiftIds: mongoose.Types.ObjectId[];
  status: 'pending' | 'paid';
  paymentProof?: string;
  paidAt?: Date;
  paidBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeWeekPaymentSchema = new Schema<IEmployeeWeekPayment>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    weekStart: { type: Date, required: true },
    amount: { type: Number, required: true },
    shiftIds: [{ type: Schema.Types.ObjectId, ref: 'Shift' }],
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    paymentProof: { type: String },
    paidAt: { type: Date },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

EmployeeWeekPaymentSchema.index({ employee: 1, weekStart: 1 }, { unique: true });

export default mongoose.model<IEmployeeWeekPayment>('EmployeeWeekPayment', EmployeeWeekPaymentSchema);
