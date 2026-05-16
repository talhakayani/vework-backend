import dotenv from 'dotenv';
import path from 'path';
import { isBrevoConfigured, sendEmail } from '../email/brevo';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npm run test:brevo -- your@email.com');
    process.exit(1);
  }

  if (!isBrevoConfigured()) {
    console.error('Set BREVO_API_KEY and BREVO_SENDER in .env');
    process.exit(1);
  }

  await sendEmail({
    to,
    subject: 'Vework — Brevo test',
    html: '<h1>Brevo works</h1><p>If you received this, email is configured correctly.</p>',
  });
  console.log('Test email sent to', to);
}

main().catch((err) => {
  console.error('Brevo test failed:', err.message || err);
  process.exit(1);
});
