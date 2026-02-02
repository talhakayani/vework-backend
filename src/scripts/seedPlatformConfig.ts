import mongoose from 'mongoose';
import PlatformConfig from '../models/PlatformConfig';

/**
 * Ensures a default platform config exists so GET /platform/bank-details returns 200.
 * Admin should update these via Admin → Platform Bank before cafés create shifts.
 */
export async function seedPlatformConfig(): Promise<void> {
  const existing = await PlatformConfig.findOne({ key: 'platform' });
  if (existing?.bankDetails?.accountName) return;

  await PlatformConfig.findOneAndUpdate(
    { key: 'platform' },
    {
      $set: {
        bankDetails: {
          type: 'uk_sort_code_account',
          accountName: 'ShiftBooking Platform — Update in Admin',
          sortCode: '00-00-00',
          accountNumber: '00000000',
        },
        employeePriceDeductionPercentage: 25, // Default 25% deduction
      },
    },
    { upsert: true, new: true }
  );
  console.log('Platform config: default bank details seeded. Update via Admin → Platform Bank.');
}
