import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { seedPlatformConfig } from './seedPlatformConfig';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shiftbooking');
    console.log('Connected to MongoDB');
    await seedPlatformConfig();
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
