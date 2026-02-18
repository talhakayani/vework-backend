import mongoose from 'mongoose';
import PlatformConfig from '../models/PlatformConfig';

/**
 * Ensures a default platform config exists so GET /platform/bank-details returns 200.
 * Admin should update these via Admin → Platform Bank before cafés create shifts.
 */
export async function seedPlatformConfig(): Promise<void> {
  const existing = await PlatformConfig.findOne({ key: 'platform' });
  const updates: Record<string, unknown> = {};

  if (!existing?.bankDetails?.accountName) {
    updates.bankDetails = {
      type: 'uk_sort_code_account',
      accountName: 'Vework Platform — Update in Admin',
      sortCode: '00-00-00',
      accountNumber: '00000000',
    };
  }
  if (existing?.platformFeePerShift == null) updates.platformFeePerShift = 10;
  if (existing?.freeShiftsPerCafe == null) updates.freeShiftsPerCafe = 2;
  if (existing?.minimumHoursBeforeShift == null) updates.minimumHoursBeforeShift = 3;
  if (existing?.basePriceTier3to12 == null) updates.basePriceTier3to12 = 17;
  if (existing?.basePriceTier12to24 == null) updates.basePriceTier12to24 = 16;
  if (existing?.basePriceTier24Plus == null) updates.basePriceTier24Plus = 14;
  if (existing?.companyName == null || existing?.companyName === '') {
    updates.companyName = 'Vework Ltd';
    updates.companyNumber = '16994650';
    updates.registeredAddress = '4 Third Avenue, London, E12 6DU';
    updates.supportEmail = 'support@vework.co';
    updates.supportPhone = '+447777182292';
  }
  if (Object.keys(updates).length === 0) return;

  await PlatformConfig.findOneAndUpdate(
    { key: 'platform' },
    { $set: updates },
    { upsert: true, new: true }
  );
  console.log('Platform config: default bank details seeded. Update via Admin → Platform Bank.');
}
