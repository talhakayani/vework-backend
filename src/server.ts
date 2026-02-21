import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { connectDB } from './config/database';
import authRoutes from './routes/auth';
import shiftRoutes from './routes/shifts';
import adminRoutes from './routes/admin';
import reviewRoutes from './routes/reviews';
import invoiceRoutes from './routes/invoices';
import employeeRoutes from './routes/employee';
import applicationRoutes from './routes/applications';
import profileRoutes from './routes/profile';
import platformRoutes from './routes/platform';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads/payment-proofs', express.static(path.join(__dirname, '../uploads/payment-proofs')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/platform', platformRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  const { seedPlatformConfig } = await import('./scripts/seedPlatformConfig');
  await seedPlatformConfig();
  const { initDefaultAdmin } = await import('./scripts/initDefaultAdmin');
  await initDefaultAdmin();

  // Auto-complete shifts when end time passes (runs every minute)
  const { runAutoCompleteShifts } = await import('./jobs/autoCompleteShifts');
  setInterval(runAutoCompleteShifts, 60 * 1000);
  runAutoCompleteShifts().catch((err) => console.error('Initial auto-complete error:', err));

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
