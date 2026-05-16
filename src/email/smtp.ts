import dns from 'dns/promises';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
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

function getTimeoutMs(): number {
  const n = Number(process.env.SMTP_TIMEOUT_MS || 20000);
  return Number.isFinite(n) && n > 0 ? n : 20000;
}

/** Force IPv4 — fixes ETIMEDOUT on some VPS where IPv6 routes to mail servers poorly. */
function useIpv4(): boolean {
  return process.env.SMTP_FORCE_IPV4 !== 'false';
}

export function isSmtpConfigured(): boolean {
  const { host, user, pass } = getSmtpEnv();
  return !!(host?.trim() && user?.trim() && pass?.trim());
}

/** Resolve IPv4 hostname — avoids broken IPv6 routes on some VPS. */
async function resolveSmtpHost(hostname: string): Promise<string> {
  const override = process.env.SMTP_HOST_IP?.trim();
  if (override) {
    return override;
  }
  if (!useIpv4()) {
    return hostname;
  }
  const { address } = await dns.lookup(hostname, { family: 4 });
  return address;
}

async function buildTransportOptions(): Promise<SMTPTransport.Options> {
  const { host, port, user, pass } = getSmtpEnv();
  const hostTrimmed = host!.trim();
  const connectHost = await resolveSmtpHost(hostTrimmed);
  const timeout = getTimeoutMs();
  const secure =
    process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE !== 'false' && port === 465);

  const options: SMTPTransport.Options = {
    host: connectHost,
    port,
    secure,
    auth: {
      user: user!.trim(),
      pass: pass!.trim(),
    },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    tls: {
      minVersion: 'TLSv1.2',
      servername: hostTrimmed,
    },
  };

  if (!secure && port === 587) {
    options.requireTLS = true;
  }

  if (useIpv4()) {
    (options as SMTPTransport.Options & { family?: number }).family = 4;
  }

  if (process.env.SMTP_DEBUG === 'true') {
    options.logger = true;
    options.debug = true;
  }

  return options;
}

let transporter: Transporter | null = null;
let transporterInit: Promise<Transporter> | null = null;

async function getTransporter(): Promise<Transporter | null> {
  if (!isSmtpConfigured()) {
    return null;
  }
  if (transporter) {
    return transporter;
  }
  if (!transporterInit) {
    transporterInit = buildTransportOptions().then((options) => {
      transporter = nodemailer.createTransport(options);
      return transporter;
    });
  }
  return transporterInit;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function logConnectionTroubleshooting(err: unknown): void {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
  if (code !== 'ETIMEDOUT' && code !== 'ECONNREFUSED' && code !== 'EHOSTUNREACH') {
    return;
  }
  const { host, port } = getSmtpEnv();
  console.error(
    '[SMTP] Cannot reach mail server. Common on deployed VPS/cloud: outbound SMTP (587/465) is blocked.',
  );
  console.error(`[SMTP] Tried ${host}:${port}. On the server run: nc -zv ${host} ${port}`);
  console.error('[SMTP] Run on this server: npm run diagnose:smtp');
  console.error('[SMTP] Fix: allow outbound TCP 587/465 in VPS firewall + cloud security group, or ask provider to unblock SMTP.');
}

/**
 * Verify SMTP connectivity (use on the deployed server: npm run test:smtp).
 */
export async function verifySmtpConnection(): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required)');
  }
  const options = await buildTransportOptions();
  const transport = nodemailer.createTransport(options);
  await transport.verify();
}

/**
 * Send an email via SMTP. Returns false if SMTP is not configured.
 * Throws on transport errors.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const transport = await getTransporter();
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
    logConnectionTroubleshooting(err);
    throw err;
  }
}
