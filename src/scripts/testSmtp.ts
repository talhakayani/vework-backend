import dotenv from 'dotenv';
import path from 'path';
import { isSmtpConfigured, verifySmtpConnection } from '../email/smtp';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main() {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = process.env.SMTP_PORT || process.env.EMAIL_PORT || '587';
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;

  console.log('SMTP host:', host);
  console.log('SMTP port:', port);
  console.log('SMTP user:', user);
  console.log('SMTP_FORCE_IPV4:', process.env.SMTP_FORCE_IPV4 !== 'false' ? 'true' : 'false');

  if (!isSmtpConfigured()) {
    console.error('Missing SMTP_HOST, SMTP_USER, or SMTP_PASS');
    process.exit(1);
  }

  await verifySmtpConnection();
  console.log('SMTP connection OK');
}

main().catch((err) => {
  console.error('SMTP test failed:', err.message || err);
  process.exit(1);
});
