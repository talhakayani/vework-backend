import { buildEmailHtml } from '../layout';
import { emailConfig } from '../config';
export interface VerifyEmailParams {
  firstName: string;
  verifyUrl: string;
}

export function getVerifyEmailSubject(): string {
  return `Verify your email – ${emailConfig.appName}`;
}

export function getVerifyEmailHtml(params: VerifyEmailParams): string {
  const { firstName, verifyUrl } = params;
  const { textMuted, textLight } = emailConfig;

  const bodyHtml = `
    <p style="margin: 0 0 16px;">Hi ${firstName},</p>
    <p style="margin: 0 0 16px;">Please verify your email address by clicking the button below. This helps us keep your account secure.</p>
    <p style="margin: 0; font-size: 14px; color: ${textLight};">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="margin: 8px 0 0; word-break: break-all;"><a href="${verifyUrl}" style="color: ${emailConfig.primaryColor}; text-decoration: none;">${verifyUrl}</a></p>
  `.trim();

  return buildEmailHtml({
    title: 'Verify your email',
    preheader: `Verify your ${emailConfig.appName} account`,
    bodyHtml,
    buttonText: 'Verify my email',
    buttonUrl: verifyUrl,
    footerLine: 'This link expires in 24 hours. If you didn\'t create an account, you can ignore this email.',
  });
}
