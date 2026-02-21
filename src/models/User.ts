import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type PaymentDetailsType = 'uk_sort_code_account' | 'iban' | 'ach';

export interface IPaymentDetails {
    type: PaymentDetailsType;
    accountName: string;
    // UK Sort Code + Account Number
    sortCode?: string;
    accountNumber?: string;
    // IBAN (UK & international)
    iban?: string;
    bicSwift?: string;
    // ACH (US-style, for international payouts)
    routingNumber?: string;
    achAccountNumber?: string;
}

export interface INotificationPreferences {
    emailShiftReminders: boolean;
    emailApplicationUpdates: boolean;
    emailInvoices: boolean;
    inAppEnabled: boolean;
}

export interface IUserSettings {
    theme: 'light' | 'dark' | 'system';
    language?: string;
    timezone?: string;
}

export interface IAddress {
    address: string;
    latitude: number;
    longitude: number;
    placeId?: string;
    label?: string;
}

export interface IUser extends Document {
    email: string;
    password: string;
    role: 'admin' | 'employee' | 'cafe';
    firstName: string;
    lastName: string;
    approvalStatus: 'pending' | 'approved' | 'rejected';
    emailVerified?: boolean;
    emailVerificationToken?: string;
    emailVerificationExpires?: Date;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    isBlocked?: boolean; // Admin can temporarily block employee accounts
    blockedUntil?: Date; // Optional: block until this date (null = indefinite until unblocked)
    // Employee specific fields
    dateOfBirth?: Date;
    cvPath?: string;
    shareCode?: string;
    rating?: number;
    totalReviews?: number;
    // Café specific fields
    shopName?: string;
    shopAddress?: string;
    /** Café business addresses (for shift location dropdown). Each: address, latitude, longitude, optional placeId, optional label */
    addresses?: IAddress[];
    cafeRating?: number; // café rating (stars from employees)
    totalCafeReviews?: number; // café total review count
    // Profile image (all roles) – path relative to backend root, e.g. uploads/avatars/avatar-xxx.jpg
    profileImage?: string;
    // Profile / settings (all roles)
    paymentDetails?: IPaymentDetails;
    notificationPreferences?: INotificationPreferences;
    settings?: IUserSettings;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
            minlength: 6,
        },
        role: {
            type: String,
            enum: ['admin', 'employee', 'cafe'],
            required: true,
        },
        firstName: {
            type: String,
            required: true,
        },
        lastName: {
            type: String,
            required: true,
        },
        approvalStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
        },
        emailVerified: { type: Boolean, default: false },
        emailVerificationToken: String,
        emailVerificationExpires: Date,
        resetPasswordToken: String,
        resetPasswordExpires: Date,
        isBlocked: { type: Boolean, default: false },
        blockedUntil: Date,
        // Employee fields
        dateOfBirth: Date,
        cvPath: String,
        shareCode: String,
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
        },
        totalReviews: {
            type: Number,
            default: 0,
        },
        // Café fields
        shopName: String,
        shopAddress: String,
        addresses: [{
            address: { type: String, required: true },
            latitude: { type: Number, required: true },
            longitude: { type: Number, required: true },
            placeId: String,
            label: String,
        }],
        cafeRating: { type: Number, default: 0, min: 0, max: 5 },
        totalCafeReviews: { type: Number, default: 0 },
        // Profile image (all roles)
        profileImage: String,
        // Profile / settings (all roles)
        paymentDetails: {
            type: { type: String, enum: ['uk_sort_code_account', 'iban', 'ach'] },
            accountName: String,
            sortCode: String,
            accountNumber: String,
            iban: String,
            bicSwift: String,
            routingNumber: String,
            achAccountNumber: String,
        },
        notificationPreferences: {
            emailShiftReminders: { type: Boolean, default: true },
            emailApplicationUpdates: { type: Boolean, default: true },
            emailInvoices: { type: Boolean, default: true },
            inAppEnabled: { type: Boolean, default: true },
        },
        settings: {
            theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
            language: String,
            timezone: String,
        },
    },
    {
        timestamps: true,
    }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);
