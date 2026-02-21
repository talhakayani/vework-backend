import sgMail from '@sendgrid/mail';
import { emailConfig } from './config';

let initialized = false;

function ensureInitialized(): boolean {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return false;
  }
  if (!initialized) {
    sgMail.setApiKey(apiKey);
    initialized = true;
  }
  return true;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email via SendGrid. Returns true if sent, false if SendGrid is not configured.
 * Throws on SendGrid API errors.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!ensureInitialized()) {
    return false;
  }

  // SendGrid matches sender by email; use object form so the verified email is explicit
  const msg = {
    to: options.to,
    from: {
      email: emailConfig.fromEmail,
      name: emailConfig.fromName,
    },
    subject: options.subject,
    html: options.html,
    text: options.text ?? undefined,
  };

  try {
    await sgMail.send(msg);
    return true;
  } catch (err: any) {
    const body = err.response?.body;
    const errors = body?.errors ? JSON.stringify(body.errors) : err.message;
    console.error('[SendGrid]', err.code, errors);
    if (err.code === 403) {
      console.error('[SendGrid] From address we sent:', emailConfig.fromEmail, '(must match verified Sender Identity in SendGrid)');
    }
    throw err;
  }
}

export function isSendGridConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.trim());
}
