import crypto from 'crypto';
import { emailConfig } from './config';
import { sendEmail, isBrevoConfigured } from './brevo';
import { getVerifyEmailSubject, getVerifyEmailHtml } from './templates/verifyEmail';
import { getResetPasswordSubject, getResetPasswordHtml } from './templates/resetPassword';

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface SendVerificationEmailParams {
  email: string;
  token: string;
  firstName: string;
}

/**
 * Send verification email via Brevo when BREVO_API_KEY is set;
 * otherwise logs the link in development.
 */
export async function sendVerificationEmail(params: SendVerificationEmailParams): Promise<void> {
  const { email, token, firstName } = params;
  const verifyUrl = `${emailConfig.frontendUrl}/verify-email?token=${token}`;

  if (!isBrevoConfigured()) {
    console.log(`[DEV] Verification link for ${email}: ${verifyUrl}`);
    return;
  }

  const sent = await sendEmail({
    to: email,
    subject: getVerifyEmailSubject(),
    html: getVerifyEmailHtml({ firstName, verifyUrl }),
  });
  if (!sent) {
    throw new Error('Email service not configured');
  }
}

export interface SendPasswordResetEmailParams {
  email: string;
  token: string;
  firstName?: string;
}

export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  const { email, token, firstName } = params;
  const resetUrl = `${emailConfig.frontendUrl}/reset-password?token=${token}`;

  if (!isBrevoConfigured()) {
    console.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    return;
  }

  const sent = await sendEmail({
    to: email,
    subject: getResetPasswordSubject(),
    html: getResetPasswordHtml({ firstName, resetUrl }),
  });
  if (!sent) {
    throw new Error('Email service not configured');
  }
}
