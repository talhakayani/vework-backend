import { BrevoClient } from '@getbrevo/brevo';
import { emailConfig } from './config';

let client: BrevoClient | null = null;

function getClient(): BrevoClient | null {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  if (!client) {
    client = new BrevoClient({ apiKey });
  }
  return client;
}

export function isBrevoConfigured(): boolean {
  return !!(process.env.BREVO_API_KEY?.trim() && getSenderEmail());
}

function getSenderEmail(): string {
  return (process.env.BREVO_SENDER || emailConfig.fromEmail).trim().toLowerCase();
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send transactional email via Brevo HTTP API (works when VPS blocks SMTP ports).
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const brevo = getClient();
  if (!brevo) {
    return false;
  }

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      subject: options.subject,
      htmlContent: options.html,
      textContent: options.text,
      sender: {
        name: emailConfig.fromName,
        email: getSenderEmail(),
      },
      to: [{ email: options.to }],
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Brevo]', message);
    console.error('[Brevo] Sender used:', getSenderEmail(), '(must be verified in Brevo → Senders & Domains)');
    throw err;
  }
}
