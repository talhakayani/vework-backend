import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fromRaw = process.env.SENDGRID_FROM || process.env.SMTP_FROM || 'Vework <noreply@example.com>';
const fromMatch = fromRaw.trim().match(/^(.+?)\s*<([^>]+)>$/);
const fromEmail = fromMatch ? fromMatch[2].trim().toLowerCase() : fromRaw.trim().toLowerCase();
const fromName = fromMatch ? fromMatch[1].trim() : 'Vework';

export const emailConfig = {
  appName: process.env.APP_NAME || 'Vework',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  fromEmail,
  fromName,
  from: fromRaw,
  primaryColor: '#1dbf73',
  primaryHover: '#16a34a',
  bgLight: '#f0fdf4',
  white: '#ffffff',
  textDark: '#111827',
  textMuted: '#4b5563',
  textLight: '#6b7280',
  border: '#e5e7eb',
  borderRadius: '12px',
} as const;
