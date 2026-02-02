import mongoose, { Document, Schema } from 'mongoose';

export interface IReview extends Document {
  shift: mongoose.Types.ObjectId;
  reviewer: mongoose.Types.ObjectId; // Café reviewing employee
  reviewed: mongoose.Types.ObjectId; // Employee being reviewed
  rating: number;
  comment?: string;
  createdAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    shift: {
      type: Schema.Types.ObjectId,
      ref: 'Shift',
      required: true,
    },
    reviewer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewed: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IReview>('Review', ReviewSchema);
