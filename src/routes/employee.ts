import mongoose from 'mongoose';
import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import Shift from '../models/Shift';
import Review from '../models/Review';
import Application from '../models/Application';
import User from '../models/User';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { getHoursFromShift } from '../utils/calculateShiftCost';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';

const router = express.Router();

// @route   GET /api/employee/schedule
// @desc    Get employee's upcoming shifts (first-come-first-serve)
// @access  Private (Employee)
router.get('/schedule', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can access this' });
    }

    // Get shifts where employee is in acceptedBy array (include same-day shifts)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const shifts = await Shift.find({
      acceptedBy: req.user._id,
      status: { $in: ['accepted', 'open'] },
      date: { $gte: startOfToday },
    })
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'))
      .sort({ date: 1, startTime: 1 });

    // Sanitize cafe data
    const sanitizedShifts = shifts.map(shift => {
      const shiftObj = shift.toObject() as unknown as Record<string, unknown>;
      if (shiftObj.cafe) {
        shiftObj.cafe = sanitizeUser(shiftObj.cafe as any);
      }
      if (Array.isArray(shiftObj.acceptedBy)) {
        shiftObj.acceptedBy = (shiftObj.acceptedBy as any[]).map((user: any) => sanitizeUser(user));
      }
      return shiftObj;
    });

    res.json(sanitizedShifts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/employee/history
// @desc    Get employee's shift history (first-come-first-serve)
// @access  Private (Employee)
router.get('/history', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can access this' });
    }

    // Get shifts where employee is in acceptedBy array
    const shifts = await Shift.find({
      acceptedBy: req.user._id,
      status: { $in: ['completed', 'cancelled'] },
    })
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'))
      .sort({ date: -1 });

    const history = shifts.map((shift) => {
      const hours = getHoursFromShift(shift.startTime, shift.endTime);
      const hourlyRate = shift.employeeHourlyRate ?? shift.baseHourlyRate;
      const earnings = hours * hourlyRate;
      const shiftObj = shift.toObject() as unknown as Record<string, unknown>;
      if (shiftObj.cafe) {
        shiftObj.cafe = sanitizeUser(shiftObj.cafe as any);
      }
      // Omit rate fields so employees do not see base/hourly rates
      const { baseHourlyRate, employeeHourlyRate, ...rest } = shiftObj as any;
      return {
        ...rest,
        hours,
        earnings,
      };
    });

    res.json(history);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/employee/earnings
// @desc    Get employee's earnings summary + this/last month + recent shifts
// @access  Private (Employee)
router.get('/earnings', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can access this' });
    }

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const completedShifts = await Shift.find({
      acceptedBy: req.user._id,
      status: 'completed',
    })
      .populate('cafe', 'shopName shopAddress')
      .lean();

    const round2 = (n: number) => Math.round(n * 100) / 100;

    let totalEarnings = 0;
    let totalHours = 0;
    let thisMonthEarnings = 0;
    let thisMonthHours = 0;
    let thisMonthShifts = 0;
    let lastMonthEarnings = 0;
    let lastMonthHours = 0;
    let lastMonthShifts = 0;

    const recentShifts: Array<{
      _id: string;
      date: string;
      earnings: number;
      hours: number;
      cafeName: string;
    }> = [];

    completedShifts.forEach((shift: any) => {
      const hours = getHoursFromShift(shift.startTime, shift.endTime);
      const hourlyRate = shift.employeeHourlyRate ?? shift.baseHourlyRate;
      const earnings = hours * hourlyRate;
      totalHours += hours;
      totalEarnings += earnings;

      const shiftDate = new Date(shift.date);
      if (shiftDate >= startOfThisMonth) {
        thisMonthEarnings += earnings;
        thisMonthHours += hours;
        thisMonthShifts += 1;
      } else if (shiftDate >= startOfLastMonth && shiftDate <= endOfLastMonth) {
        lastMonthEarnings += earnings;
        lastMonthHours += hours;
        lastMonthShifts += 1;
      }
    });

    // Build recent shifts (last 10), most recent first
    const sortedByDate = [...completedShifts].sort(
      (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    sortedByDate.slice(0, 10).forEach((shift: any) => {
      const hours = getHoursFromShift(shift.startTime, shift.endTime);
      const hourlyRate = shift.employeeHourlyRate ?? shift.baseHourlyRate;
      const earnings = hours * hourlyRate;
      const cafe = shift.cafe;
      recentShifts.push({
        _id: shift._id.toString(),
        date: shift.date,
        earnings: round2(earnings),
        hours: round2(hours),
        cafeName: cafe?.shopName || 'Cafe',
      });
    });

    res.json({
      totalEarnings: round2(totalEarnings),
      totalHours: round2(totalHours),
      totalShifts: completedShifts.length,
      averageEarningsPerShift:
        completedShifts.length > 0 ? round2(totalEarnings / completedShifts.length) : 0,
      thisMonth: {
        earnings: round2(thisMonthEarnings),
        hours: round2(thisMonthHours),
        shifts: thisMonthShifts,
      },
      lastMonth: {
        earnings: round2(lastMonthEarnings),
        hours: round2(lastMonthHours),
        shifts: lastMonthShifts,
      },
      recentShifts,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/employee/:employeeId/shift/:shiftId/details
// @desc    Get employee details for a specific shift (Café only) - limited info
// @access  Private (Café)
router.get('/:employeeId/shift/:shiftId/details', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can view employee details' });
    }

    const { employeeId, shiftId } = req.params;

    // Verify shift belongs to café
    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Verify employee is assigned to this shift
    const isAssigned = shift.acceptedBy.some((id: any) => id.toString() === employeeId);
    if (!isAssigned) {
      return res.status(400).json({ message: 'Employee is not assigned to this shift' });
    }

    // Get employee basic info (limited fields for café)
    const employee = await User.findById(employeeId).select('firstName lastName rating totalReviews');
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Get reviews for this employee
    const reviews = await Review.find({ reviewed: employeeId })
      .populate('reviewer', 'shopName')
      .populate('shift', 'date')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get application/rejection history for this shift
    const application = await Application.findOne({
      shift: shiftId,
      employee: employeeId,
    });

    // Return limited employee info
    res.json({
      employee: {
        _id: employee._id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        rating: employee.rating,
        totalReviews: employee.totalReviews,
      },
      reviews: reviews.map((review) => ({
        _id: review._id,
        rating: review.rating,
        comment: review.comment,
        reviewer: typeof review.reviewer === 'object' ? {
          shopName: (review.reviewer as any).shopName,
        } : null,
        shift: typeof review.shift === 'object' ? {
          date: (review.shift as any).date,
        } : null,
        createdAt: review.createdAt,
      })),
      application: application ? {
        status: application.status,
        rejectionReason: application.rejectionReason,
        reviewedAt: application.reviewedAt,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/employee/:employeeId/shift/:shiftId/reject
// @desc    Reject employee from shift (Café only) - creates rejection record
// @access  Private (Café)
router.post(
  '/:employeeId/shift/:shiftId/reject',
  protect,
  requireApproval,
  [
    body('rejectionReason').trim().notEmpty().withMessage('Rejection reason is required'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafés can reject employees' });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { employeeId, shiftId } = req.params;
      const { rejectionReason } = req.body;

      // Verify shift belongs to café
      const shift = await Shift.findById(shiftId);
      if (!shift) {
        return res.status(404).json({ message: 'Shift not found' });
      }

      if (shift.cafe.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      if (shift.status === 'completed') {
        return res.status(400).json({ message: 'Cannot reject employee from completed shift' });
      }

      // Check if employee is assigned
      const employeeIndex = shift.acceptedBy.findIndex(
        (id: any) => id.toString() === employeeId
      );

      if (employeeIndex === -1) {
        return res.status(400).json({ message: 'Employee is not assigned to this shift' });
      }

      // Remove employee from acceptedBy
      shift.acceptedBy.splice(employeeIndex, 1);

      // Create or update application rejection record
      let application = await Application.findOne({
        shift: shiftId,
        employee: employeeId,
      });

      if (application) {
        // Update existing application
        application.status = 'rejected';
        application.reviewedAt = new Date();
        application.reviewedBy = req.user._id;
        application.rejectionReason = rejectionReason;
        await application.save();
      } else {
        // Create new rejection record for tracking
        application = await Application.create({
          shift: shiftId,
          employee: employeeId,
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: req.user._id,
          rejectionReason: rejectionReason,
        });
      }

      // Block employee from this shift
      if (!shift.blockedEmployees) {
        shift.blockedEmployees = [];
      }
      if (!shift.blockedEmployees.some((id: any) => id.toString() === employeeId)) {
        shift.blockedEmployees.push(new mongoose.Types.ObjectId(employeeId));
      }

      // Update shift status - reopen if needed
      if (shift.acceptedBy.length < shift.requiredEmployees) {
        if (shift.status === 'accepted') {
          shift.status = 'open';
        }
      }

      if (shift.acceptedBy.length === 0) {
        shift.status = 'open';
      }

      await shift.save();

      res.json({
        message: 'Employee rejected and blocked from this shift',
        application: {
          _id: application._id,
          status: application.status,
          rejectionReason: application.rejectionReason,
          reviewedAt: application.reviewedAt,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;
