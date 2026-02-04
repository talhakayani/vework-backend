/**
 * Auto-complete shifts when end time has passed.
 * Runs every minute. Marks shift as completed and generates invoice.
 */
import Shift from '../models/Shift';
import Invoice from '../models/Invoice';
import { getHoursFromShift } from '../utils/calculateShiftCost';

function isShiftEnded(shift: { date: Date; endTime: string }): boolean {
  const shiftEndDate = new Date(shift.date);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  shiftEndDate.setHours(endHour, endMin, 0, 0);
  return shiftEndDate <= new Date();
}

export async function runAutoCompleteShifts(): Promise<void> {
  const shiftsToComplete = await Shift.find({ status: 'accepted' }).lean();

  for (const shift of shiftsToComplete) {
    if (!isShiftEnded(shift as any)) continue;
    try {
      const existingInvoice = await Invoice.findOne({ shift: shift._id });
      if (existingInvoice) continue;

      const hours = getHoursFromShift(shift.startTime as string, shift.endTime as string);
      const acceptedCount = Array.isArray(shift.acceptedBy) ? shift.acceptedBy.length : 0;

      if (acceptedCount > 0) {
        const invoiceNumber = `INV-${Date.now()}-${shift._id.toString().slice(-6)}`;

        await Invoice.create({
          cafe: shift.cafe,
          shift: shift._id,
          invoiceNumber,
          shiftDetails: {
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            hours,
            employees: acceptedCount,
          },
          baseAmount: (shift.baseHourlyRate || 14) * hours * acceptedCount,
          platformFee: shift.platformFee || 0,
          penaltyAmount: shift.penaltyAmount || 0,
          totalAmount: (shift.totalCost || 0) + (shift.penaltyAmount || 0),
          status: 'paid',
          paidAt: new Date(),
        });
      }

      await Shift.findByIdAndUpdate(shift._id, { status: 'completed' });
    } catch (err) {
      console.error('Auto-complete shift error:', shift._id, err);
    }
  }
}
