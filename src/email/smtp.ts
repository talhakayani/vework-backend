import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { emailConfig } from './config';

function getSmtpEnv() {
  return {
    host: process.env.SMTP_HOST || process.env.EMAIL_HOST,
    port: Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587),
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
  };
}

export function isSmtpConfigured(): boolean {
  const { host, user, pass } = getSmtpEnv();
  return !!(host?.trim() && user?.trim() && pass?.trim());
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) {
    return null;
  }
  if (!transporter) {
    const { host, port, user, pass } = getSmtpEnv();
    const secure =
      process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE !== 'false' && port === 465);
    transporter = nodemailer.createTransport({
      host: host!.trim(),
      port,
      secure,
      auth: {
        user: user!.trim(),
        pass: pass!.trim(),
      },
    });
  }
  return transporter;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email via SMTP (host mail). Returns false if SMTP is not configured.
 * Throws on transport errors.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    return false;
  }

  try {
    await transport.sendMail({
      from: `"${emailConfig.fromName}" <${emailConfig.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SMTP]', message);
    console.error('[SMTP] From address used:', emailConfig.fromEmail);
    throw err;
  }
}
