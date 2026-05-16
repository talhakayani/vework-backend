/**
 * Run ON THE DEPLOYED SERVER (where PM2 runs): npm run diagnose:smtp
 * Tests DNS, TCP egress to Private Email, and general internet access.
 */
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { isSmtpConfigured } from '../email/smtp';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const host = (process.env.SMTP_HOST || process.env.EMAIL_HOST || 'mail.privateemail.com').trim();
const ports = [587, 465];

function tcpConnect(targetHost: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: targetHost, port, family: 4 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function printDns() {
  console.log('\n--- DNS ---');
  try {
    const v4 = await dns.resolve4(host);
    console.log(`A (IPv4) for ${host}:`, v4.join(', '));
  } catch (e) {
    console.log(`A lookup failed:`, (e as Error).message);
  }
  try {
    const v6 = await dns.resolve6(host);
    console.log(`AAAA (IPv6) for ${host}:`, v6.join(', '));
  } catch {
    console.log(`AAAA: none or not used`);
  }
}

async function testPort(label: string, targetHost: string, port: number) {
  try {
    await tcpConnect(targetHost, port, 10000);
    console.log(`  OK   ${label} → ${targetHost}:${port}`);
    return true;
  } catch (e) {
    console.log(`  FAIL ${label} → ${targetHost}:${port} — ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  console.log('SMTP egress diagnostic');
  console.log('Hostname:', host);
  console.log('Configured port:', process.env.SMTP_PORT || '587');
  console.log('SMTP_USER:', process.env.SMTP_USER || process.env.EMAIL_USER || '(not set)');

  if (!isSmtpConfigured()) {
    console.error('\nMissing SMTP_HOST, SMTP_USER, or SMTP_PASS in environment.');
    process.exit(1);
  }

  await printDns();

  console.log('\n--- TCP (IPv4) — same check as ETIMEDOUT in the app ---');
  let anyOk = false;
  for (const port of ports) {
    if (await testPort('hostname', host, port)) anyOk = true;
  }

  let ipv4: string | undefined;
  try {
    ipv4 = (await dns.lookup(host, { family: 4 })).address;
    console.log(`\nResolved IPv4: ${ipv4}`);
    for (const port of ports) {
      if (await testPort('IPv4', ipv4, port)) anyOk = true;
    }
  } catch (e) {
    console.log('IPv4 lookup failed:', (e as Error).message);
  }

  console.log('\n--- General egress (HTTPS) ---');
  try {
    await tcpConnect('1.1.1.1', 443, 8000);
    console.log('  OK   outbound TCP to 1.1.1.1:443 (internet works)');
  } catch (e) {
    console.log('  FAIL general outbound:', (e as Error).message);
  }

  console.log('\n--- Result ---');
  if (anyOk) {
    console.log('SMTP ports are REACHABLE from this server.');
    console.log('If the app still fails, run: npm run test:smtp');
    console.log('Check auth (SMTP_USER/SMTP_PASS) and SMTP_SECURE matches port (587=false, 465=true).');
  } else {
    console.log('SMTP ports are BLOCKED from this server (ETIMEDOUT).');
    console.log('This is a VPS/firewall policy issue — not fixable in Node code alone.');
    console.log('');
    console.log('Fix on the server:');
    console.log('  1. sudo ufw status verbose   → allow outbound 587, 465');
    console.log('  2. Cloud panel → Security group / Firewall → allow egress TCP 587, 465');
    console.log('  3. Open a ticket with your VPS provider:');
    console.log('     "Please allow outbound SMTP to mail.privateemail.com on ports 587 and 465"');
    console.log('');
    console.log('Providers that often block all SMTP (Oracle Free Tier, some PaaS):');
    console.log('  you must change host or use their documented mail relay — Private Email SMTP will not work.');
  }

  process.exit(anyOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
