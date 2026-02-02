import mongoose, { Document, Schema } from 'mongoose';

export interface IApplication extends Document {
  shift: mongoose.Types.ObjectId;
  employee: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  appliedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>(
  {
    shift: {
      type: Schema.Types.ObjectId,
      ref: 'Shift',
      required: true,
    },
    employee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
      default: 'pending',
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: Date,
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    rejectionReason: String,
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate applications
ApplicationSchema.index({ shift: 1, employee: 1 }, { unique: true });

export default mongoose.model<IApplication>('Application', ApplicationSchema);
