import { buildEmailHtml } from '../layout';
import { emailConfig } from '../config';

export interface ResetPasswordParams {
  firstName?: string;
  resetUrl: string;
}

export function getResetPasswordSubject(): string {
  return `Reset your password – ${emailConfig.appName}`;
}

export function getResetPasswordHtml(params: ResetPasswordParams): string {
  const { firstName, resetUrl } = params;
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  const bodyHtml = `
    <p style="margin: 0 0 16px;">${greeting}</p>
    <p style="margin: 0 0 16px;">We received a request to reset the password for your account. Click the button below to choose a new password.</p>
    <p style="margin: 0; font-size: 14px; color: ${emailConfig.textLight};">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="margin: 8px 0 0; word-break: break-all;"><a href="${resetUrl}" style="color: ${emailConfig.primaryColor}; text-decoration: none;">${resetUrl}</a></p>
  `.trim();

  return buildEmailHtml({
    title: 'Reset your password',
    preheader: `Reset your ${emailConfig.appName} password`,
    bodyHtml,
    buttonText: 'Reset password',
    buttonUrl: resetUrl,
    footerLine: 'This link expires in 1 hour. If you didn\'t request a password reset, you can safely ignore this email.',
  });
}
