import mongoose from 'mongoose';
import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import Shift from '../models/Shift';
import Invoice from '../models/Invoice';
import Application from '../models/Application';
import PlatformConfig from '../models/PlatformConfig';
import EmployeeWeekPayment from '../models/EmployeeWeekPayment';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { getHoursFromShift, calculateShiftCostWithFixedFee } from '../utils/calculateShiftCost';
import { uploadPaymentProof } from '../utils/uploadPaymentProof';

const router = express.Router();

function getStartOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  return start;
}
function getEndOfWeek(d: Date): Date {
  const start = getStartOfWeek(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
/** Return Monday and Sunday as YYYY-MM-DD (local date only, no UTC shift) */
function getWeekRangeAsStrings(d: Date): { weekStart: string; weekEnd: string } {
  const start = getStartOfWeek(new Date(d));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekStart = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const weekEnd = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  return { weekStart, weekEnd };
}

const formatSortCode = (v: string): string => {
  const d = String(v).replace(/\D/g, '').slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
};

// All routes require admin role
router.use(protect);
router.use(authorize('admin'));

// @route   GET /api/admin/pending-approvals
// @desc    Get pending approvals
// @access  Private (Admin)
router.get('/pending-approvals', async (req: AuthRequest, res: Response) => {
  try {
    const pendingUsers = await User.find({ approvalStatus: 'pending' }).select('-password');
    res.json(pendingUsers);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/admin/approve/:id
// @desc    Approve user
// @access  Private (Admin)
router.put(
  '/approve/:id',
  [body('status').isIn(['approved', 'rejected'])],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { approvalStatus: req.body.status },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // TODO: Send notification email

      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private (Admin)
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get full user details (cafe location, CV, share code, etc.) - Admin only
// @access  Private (Admin)
router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/admin/users/:id/block
// @desc    Block or unblock an employee account (Admin only)
// @access  Private (Admin)
router.put(
  '/users/:id/block',
  [
    body('isBlocked').isBoolean().withMessage('isBlocked must be true or false'),
    body('blockedUntil').optional().isISO8601().withMessage('blockedUntil must be a valid date'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.role !== 'employee') {
        return res.status(400).json({ message: 'Only employee accounts can be blocked' });
      }

      const { isBlocked, blockedUntil } = req.body;
      user.isBlocked = isBlocked;
      user.blockedUntil = isBlocked && blockedUntil ? new Date(blockedUntil) : undefined;
      await user.save();

      const updatedUser = await User.findById(user._id).select('-password');
      res.json({
        message: isBlocked ? 'Employee account blocked' : 'Employee account unblocked',
        user: updatedUser,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/admin/users/:id/make-admin
// @desc    Make a user an admin
// @access  Private (Admin)
router.put('/users/:id/make-admin', async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ message: 'User is already an admin' });
    }

    user.role = 'admin';
    user.approvalStatus = 'approved'; // Auto-approve when making admin
    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');
    res.json({
      message: 'User has been made an admin successfully',
      user: updatedUser
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/admin/shifts
// @desc    Get all shifts
// @access  Private (Admin)
router.get('/shifts', async (req: AuthRequest, res: Response) => {
  try {
    const shifts = await Shift.find()
      .populate('cafe', 'shopName shopAddress')
      .populate('acceptedBy', 'firstName lastName email')
      .populate('blockedEmployees', 'firstName lastName email')
      .populate('visibleToEmployees', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Fetch rejection reasons for blocked employees from Application records
    const shiftsWithRejections = await Promise.all(
      shifts.map(async (shift) => {
        const shiftObj = shift.toObject();

        // If there are blocked employees, fetch their rejection reasons
        if (shift.blockedEmployees && shift.blockedEmployees.length > 0) {
          const blockedEmployeesWithReasons = await Promise.all(
            shift.blockedEmployees.map(async (employeeId: any) => {
              // Handle both populated (object) and non-populated (ObjectId) cases
              const employeeIdValue = typeof employeeId === 'object' && employeeId._id
                ? employeeId._id
                : (typeof employeeId === 'object' ? employeeId : employeeId);

              const employee = typeof employeeId === 'object' && employeeId.firstName
                ? employeeId
                : await User.findById(employeeIdValue).select('firstName lastName email');

              // Find the application/rejection record for this employee and shift
              const application = await Application.findOne({
                shift: shift._id,
                employee: employeeIdValue,
                status: 'rejected',
              });

              return {
                _id: employeeIdValue,
                firstName: employee?.firstName || '',
                lastName: employee?.lastName || '',
                email: employee?.email || '',
                rejectionReason: application?.rejectionReason || null,
                rejectedAt: application?.reviewedAt || null,
              };
            })
          );

          (shiftObj as unknown as Record<string, unknown>).blockedEmployees = blockedEmployeesWithReasons;
        }

        return shiftObj;
      })
    );

    res.json(shiftsWithRejections);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/admin/shifts/:id
// @desc    Update shift (Admin can edit any shift including after approval - hourly rate, etc.)
// @access  Private (Admin)
router.put(
  '/shifts/:id',
  [
    body('employeeHourlyRate').optional().isFloat({ min: 0 }),
    body('baseHourlyRate').optional().isFloat({ min: 14 }),
    body('visibility').optional().isIn(['all', 'selected']),
    body('visibleToEmployees').optional().isArray(),
    body('visibleToEmployees.*').optional().isMongoId(),
    body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('date').optional().isISO8601(),
    body('requiredEmployees').optional().isInt({ min: 1 }),
    body('description').optional().trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const shift = await Shift.findById(req.params.id);
      if (!shift) return res.status(404).json({ message: 'Shift not found' });

      if (shift.status === 'completed' || shift.status === 'cancelled') {
        return res.status(400).json({ message: 'Cannot edit completed or cancelled shift' });
      }

      const updates: any = {};
      if (req.body.employeeHourlyRate !== undefined) updates.employeeHourlyRate = parseFloat(req.body.employeeHourlyRate);
      if (req.body.baseHourlyRate !== undefined) updates.baseHourlyRate = parseFloat(req.body.baseHourlyRate);
      if (req.body.visibility !== undefined) updates.visibility = req.body.visibility;
      if (req.body.visibleToEmployees !== undefined) updates.visibleToEmployees = Array.isArray(req.body.visibleToEmployees) ? req.body.visibleToEmployees : [];
      if (req.body.startTime !== undefined) updates.startTime = req.body.startTime;
      if (req.body.endTime !== undefined) updates.endTime = req.body.endTime;
      if (req.body.date !== undefined) updates.date = req.body.date;
      if (req.body.requiredEmployees !== undefined) updates.requiredEmployees = req.body.requiredEmployees;
      if (req.body.description !== undefined) updates.description = req.body.description;

      // Recalculate totalCost when base rate (or times/requiredEmployees) change
      const baseRate = updates.baseHourlyRate ?? shift.baseHourlyRate;
      const startTime = updates.startTime ?? shift.startTime;
      const endTime = updates.endTime ?? shift.endTime;
      const requiredEmployees = updates.requiredEmployees ?? shift.requiredEmployees;
      const platformFee = shift.platformFee ?? 0;
      const { totalCost } = calculateShiftCostWithFixedFee(startTime, endTime, baseRate, requiredEmployees, platformFee);
      updates.totalCost = totalCost;

      const updatedShift = await Shift.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
        .populate('cafe', 'shopName shopAddress')
        .populate('acceptedBy', 'firstName lastName email')
        .populate('visibleToEmployees', 'firstName lastName email');

      res.json(updatedShift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/admin/shifts/:id/approve
// @desc    Approve shift (pending_approval -> open, or completed -> generate invoice after payment verification)
// @access  Private (Admin)
router.put(
  '/shifts/:id/approve',
  [
    body('employeeHourlyRate').optional().isFloat({ min: 0 }).withMessage('Employee hourly rate must be a non-negative number'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const shift = await Shift.findById(req.params.id);
      if (!shift) return res.status(404).json({ message: 'Shift not found' });

      // Handle pending_approval shifts (initial approval)
      if (shift.status === 'pending_approval') {
        // Allow admin to set employee-facing hourly rate
        if (req.body.employeeHourlyRate !== undefined && req.body.employeeHourlyRate !== null && req.body.employeeHourlyRate !== '') {
          const employeeRate = parseFloat(req.body.employeeHourlyRate);
          if (isNaN(employeeRate) || employeeRate < 0) {
            return res.status(400).json({ message: 'Employee hourly rate must be a non-negative number' });
          }
          shift.employeeHourlyRate = employeeRate;
        }

        shift.status = 'open';
        await shift.save();

        // Populate shift for response
        const populatedShift = await Shift.findById(shift._id)
          .populate('cafe', 'shopName shopAddress')
          .populate('acceptedBy', 'firstName lastName');

        return res.json(populatedShift);
      }

      // Handle completed shifts: just acknowledge (invoice is auto-generated by job)
      if (shift.status === 'completed') {
        const populatedShift = await Shift.findById(shift._id)
          .populate('cafe', 'shopName shopAddress')
          .populate('acceptedBy', 'firstName lastName');
        return res.json({
          shift: populatedShift,
          message: 'Shift already completed. Invoice is managed separately in Invoices.',
        });
      }

      return res.status(400).json({ message: 'Only pending-approval or completed shifts can be approved' });
    } catch (error: any) {
      console.error('Error approving shift:', error);
      res.status(500).json({ message: error.message || 'Failed to approve shift' });
    }
  });

// @route   GET /api/admin/employee-payments
// @desc    List employee payments grouped by week (one combined payment per employee per week)
// @access  Private (Admin)
router.get('/employee-payments', async (req: AuthRequest, res: Response) => {
  try {
    const shifts = await Shift.find({ status: 'completed' })
      .populate('cafe', 'shopName shopAddress')
      .populate('acceptedBy', 'firstName lastName email')
      .sort({ date: -1 })
      .lean();

    // Build (weekStart, employeeId) -> { totalAmount, shiftIds, employeeName, employeeEmail }
    const weekEmployeeMap = new Map<
      string,
      { totalAmount: number; shiftIds: string[]; employeeId: string; employeeName: string; employeeEmail?: string }
    >();

    for (const shift of shifts as any[]) {
      const hours = getHoursFromShift(shift.startTime, shift.endTime);
      const hourlyRate = shift.employeeHourlyRate ?? shift.baseHourlyRate;
      const shiftDate = new Date(shift.date);
      const { weekStart: weekKey } = getWeekRangeAsStrings(shiftDate);

      const employees = shift.acceptedBy || [];
      for (const emp of employees) {
        const e = typeof emp === 'object' ? emp : null;
        const employeeId = e?._id?.toString() || (typeof emp === 'object' && (emp as any).toString ? (emp as any).toString() : String(emp));
        const key = `${weekKey}_${employeeId}`;
        const amount = Math.round(hours * hourlyRate * 100) / 100;
        const existing = weekEmployeeMap.get(key);
        if (existing) {
          existing.totalAmount = Math.round((existing.totalAmount + amount) * 100) / 100;
          existing.shiftIds.push(shift._id.toString());
        } else {
          weekEmployeeMap.set(key, {
            totalAmount: amount,
            shiftIds: [shift._id.toString()],
            employeeId,
            employeeName: e ? `${e.firstName || ''} ${e.lastName || ''}`.trim() || 'Unknown' : 'Unknown',
            employeeEmail: e?.email,
          });
        }
      }
    }

    const paidRecords = await EmployeeWeekPayment.find({ status: 'paid' }).lean();
    const paidMap = new Map<string, { paymentProof: string; paidAt: string }>();
    const toYYYYMMDD = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    for (const r of paidRecords as any[]) {
      const d = new Date((r as any).weekStart);
      const weekStartStr = toYYYYMMDD(d);
      const k = `${weekStartStr}_${r.employee.toString()}`;
      paidMap.set(k, {
        paymentProof: r.paymentProof || '',
        paidAt: r.paidAt ? new Date(r.paidAt).toISOString() : '',
      });
    }

    const periodsByWeek = new Map<
      string,
      { weekStart: string; weekEnd: string; employees: Array<{
        employeeId: string;
        employeeName: string;
        employeeEmail?: string;
        totalAmount: number;
        shiftIds: string[];
        shiftCount: number;
        paid: boolean;
        paymentProof?: string;
        paidAt?: string;
      }> }
    >();

    for (const [key, data] of weekEmployeeMap) {
      const [weekKey, employeeId] = key.split('_');
      const { weekStart: weekStartStr, weekEnd: weekEndStr } = getWeekRangeAsStrings(new Date(weekKey + 'T12:00:00'));
      const paid = paidMap.get(key);

      if (!periodsByWeek.has(weekKey)) {
        periodsByWeek.set(weekKey, {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          employees: [],
        });
      }
      periodsByWeek.get(weekKey)!.employees.push({
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        employeeEmail: data.employeeEmail,
        totalAmount: data.totalAmount,
        shiftIds: data.shiftIds,
        shiftCount: data.shiftIds.length,
        paid: !!paid,
        paymentProof: paid?.paymentProof,
        paidAt: paid?.paidAt,
      });
    }

    const periods = Array.from(periodsByWeek.values()).sort(
      (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
    );

    res.json({ periods });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/admin/employee-payments/mark-week-paid
// @desc    Mark one week's combined payment as paid for given employees. Requires payment proof.
// @access  Private (Admin)
router.post(
  '/employee-payments/mark-week-paid',
  uploadPaymentProof.single('paymentProof'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Proof of payment file is required (image or PDF)' });
      }

      let weekStartStr: string = req.body.weekStart;
      if (!weekStartStr) return res.status(400).json({ message: 'weekStart is required (YYYY-MM-DD)' });

      let employeeIds: string[] = [];
      if (Array.isArray(req.body.employeeIds)) {
        employeeIds = req.body.employeeIds;
      } else if (typeof req.body.employeeIds === 'string') {
        try {
          employeeIds = JSON.parse(req.body.employeeIds);
        } catch {
          return res.status(400).json({ message: 'employeeIds must be a JSON array of IDs' });
        }
      }
      if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ message: 'At least one employee ID is required' });
      }

      // Parse as local date (YYYY-MM-DD at noon avoids UTC midnight timezone issues), then normalize to Monday of that week
      const parsed = new Date(weekStartStr + 'T12:00:00');
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'weekStart must be a valid date (YYYY-MM-DD)' });
      }
      const weekStart = getStartOfWeek(parsed);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = getEndOfWeek(new Date(weekStart));

      const proofPath = `uploads/payment-proofs/${req.file.filename}`;

      const completedShifts = await Shift.find({
        status: 'completed',
        date: { $gte: weekStart, $lte: weekEnd },
        acceptedBy: { $in: employeeIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
      }).lean();

      for (const empId of employeeIds) {
        const shiftsForEmployee = (completedShifts as any[]).filter((s) =>
          s.acceptedBy.some((id: any) => id.toString() === empId)
        );
        let amount = 0;
        const shiftIds: mongoose.Types.ObjectId[] = [];
        for (const s of shiftsForEmployee) {
          const hours = getHoursFromShift(s.startTime, s.endTime);
          const rate = s.employeeHourlyRate ?? s.baseHourlyRate;
          amount += hours * rate;
          shiftIds.push(s._id);
        }
        amount = Math.round(amount * 100) / 100;
        if (shiftIds.length === 0) continue;

        await EmployeeWeekPayment.findOneAndUpdate(
          { employee: empId, weekStart },
          {
            amount,
            shiftIds,
            status: 'paid',
            paymentProof: proofPath,
            paidAt: new Date(),
            paidBy: req.user!._id,
          },
          { upsert: true, new: true }
        );
      }

      res.json({ message: 'Week payment marked as paid', weekStart: weekStartStr, employeeIds });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/admin/config
// @desc    Update platform configuration
// @access  Private (Admin)
router.put('/config', async (req: AuthRequest, res: Response) => {
  try {
    res.json({ message: 'Configuration updated (stored in env variables)' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/admin/platform-bank-details
// @desc    Get platform bank details (admin)
// @access  Private (Admin)
router.get('/platform-bank-details', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    res.json({ bankDetails: config?.bankDetails ?? null });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/admin/platform-bank-details
// @desc    Update platform bank details (admin)
// @access  Private (Admin)
router.put(
  '/platform-bank-details',
  [
    body('type').isIn(['uk_sort_code_account', 'iban', 'ach']).withMessage('Invalid payment type'),
    body('accountName').trim().notEmpty().withMessage('Account name is required'),
    body('sortCode').optional().trim(),
    body('accountNumber').optional().trim(),
    body('iban').optional().trim(),
    body('bicSwift').optional().trim(),
    body('routingNumber').optional().trim(),
    body('achAccountNumber').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { type, accountName, sortCode, accountNumber, iban, bicSwift, routingNumber, achAccountNumber } = req.body;

      let bankDetails: any = { type, accountName };

      if (type === 'uk_sort_code_account') {
        const sc = String(sortCode || '').replace(/\D/g, '');
        const ac = String(accountNumber || '').replace(/\D/g, '');
        if (sc.length !== 6) return res.status(400).json({ message: 'Sort code must be 6 digits' });
        if (ac.length !== 8) return res.status(400).json({ message: 'Account number must be 8 digits' });
        bankDetails.sortCode = formatSortCode(sc);
        bankDetails.accountNumber = ac;
      } else if (type === 'iban') {
        const ibanClean = String(iban || '').replace(/\s/g, '');
        if (ibanClean.length < 15 || ibanClean.length > 34) {
          return res.status(400).json({ message: 'IBAN must be 15–34 characters' });
        }
        if (!/^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]+$/.test(ibanClean)) {
          return res.status(400).json({ message: 'Invalid IBAN format' });
        }
        bankDetails.iban = ibanClean.toUpperCase();
        if (bicSwift) bankDetails.bicSwift = String(bicSwift).trim().toUpperCase();
      } else if (type === 'ach') {
        const rte = String(routingNumber || '').replace(/\D/g, '');
        const ach = String(achAccountNumber || '').replace(/\D/g, '');
        if (rte.length !== 9) return res.status(400).json({ message: 'Routing number must be 9 digits' });
        if (ach.length < 4 || ach.length > 17) return res.status(400).json({ message: 'ACH account number must be 4–17 digits' });
        bankDetails.routingNumber = rte;
        bankDetails.achAccountNumber = ach;
      }

      const config = await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $set: { bankDetails } },
        { new: true, upsert: true }
      );
      res.json({ bankDetails: config.bankDetails });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/admin/platform-config
// @desc    Update platform configuration (bank details, platform fee, etc.)
// @access  Private (Admin)
router.put(
  '/platform-config',
  [
    body('employeePriceDeductionPercentage').optional().isFloat({ min: 0, max: 100 }),
    body('platformFeePerShift').optional().isFloat({ min: 0 }),
    body('freeShiftsPerCafe').optional().isInt({ min: 0 }),
    body('minimumHoursBeforeShift').optional().isFloat({ min: 0 }),
    body('basePriceTier3to12').optional().isFloat({ min: 0 }),
    body('basePriceTier12to24').optional().isFloat({ min: 0 }),
    body('basePriceTier24Plus').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const updateData: any = {};
      if (req.body.employeePriceDeductionPercentage !== undefined) {
        updateData.employeePriceDeductionPercentage = req.body.employeePriceDeductionPercentage;
      }
      if (req.body.platformFeePerShift !== undefined) {
        updateData.platformFeePerShift = parseFloat(req.body.platformFeePerShift);
      }
      if (req.body.freeShiftsPerCafe !== undefined) {
        updateData.freeShiftsPerCafe = parseInt(req.body.freeShiftsPerCafe, 10);
      }
      if (req.body.minimumHoursBeforeShift !== undefined) {
        updateData.minimumHoursBeforeShift = parseFloat(req.body.minimumHoursBeforeShift);
      }
      if (req.body.basePriceTier3to12 !== undefined) {
        updateData.basePriceTier3to12 = parseFloat(req.body.basePriceTier3to12);
      }
      if (req.body.basePriceTier12to24 !== undefined) {
        updateData.basePriceTier12to24 = parseFloat(req.body.basePriceTier12to24);
      }
      if (req.body.basePriceTier24Plus !== undefined) {
        updateData.basePriceTier24Plus = parseFloat(req.body.basePriceTier24Plus);
      }

      const config = await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $set: updateData },
        { new: true, upsert: true }
      );

      res.json({
        employeePriceDeductionPercentage: config.employeePriceDeductionPercentage ?? 0,
        platformFeePerShift: config.platformFeePerShift ?? 10,
        freeShiftsPerCafe: config.freeShiftsPerCafe ?? 2,
        minimumHoursBeforeShift: config.minimumHoursBeforeShift ?? 3,
        basePriceTier3to12: config.basePriceTier3to12 ?? 17,
        basePriceTier12to24: config.basePriceTier12to24 ?? 16,
        basePriceTier24Plus: config.basePriceTier24Plus ?? 14,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/admin/platform-config
// @desc    Get platform configuration (Admin)
// @access  Private (Admin)
router.get('/platform-config', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    res.json({
      employeePriceDeductionPercentage: config?.employeePriceDeductionPercentage ?? 0,
      platformFeePerShift: config?.platformFeePerShift ?? 10,
      freeShiftsPerCafe: config?.freeShiftsPerCafe ?? 2,
      minimumHoursBeforeShift: config?.minimumHoursBeforeShift ?? 3,
      basePriceTier3to12: config?.basePriceTier3to12 ?? 17,
      basePriceTier12to24: config?.basePriceTier12to24 ?? 16,
      basePriceTier24Plus: config?.basePriceTier24Plus ?? 14,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/admin/invoices
// @desc    Get all invoices (Admin)
// @access  Private (Admin)
router.get('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await Invoice.find()
      .populate('cafe', 'firstName lastName email shopName shopAddress')
      .populate({
        path: 'shift',
        populate: { path: 'acceptedBy', select: 'firstName lastName email' },
      })
      .sort({ createdAt: -1 })
      .lean();
    res.json(invoices);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/admin/invoices/:id
// @desc    Update invoice: platform fee, penalty (base amount is read-only). Approve (draft→approved) or verify payment (pending_verification→paid).
// @access  Private (Admin)
router.put(
  '/invoices/:id',
  [
    body('status').optional().isIn(['approved', 'paid']),
    body('platformFee').optional().isFloat({ min: 0 }),
    body('penaltyAmount').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      if (req.body.platformFee !== undefined) {
        invoice.platformFee = parseFloat(req.body.platformFee);
      }
      if (req.body.penaltyAmount !== undefined) {
        invoice.penaltyAmount = parseFloat(req.body.penaltyAmount);
      }
      // Recalculate total (base is read-only)
      invoice.totalAmount = invoice.baseAmount + invoice.platformFee + (invoice.penaltyAmount || 0);

      if (req.body.status === 'approved') {
        if (invoice.status !== 'draft') {
          return res.status(400).json({ message: 'Only draft invoices can be approved' });
        }
        invoice.status = 'approved';
      } else if (req.body.status === 'paid') {
        if (invoice.status !== 'pending_verification') {
          return res.status(400).json({ message: 'Only invoices with submitted payment proof can be marked paid' });
        }
        invoice.status = 'paid';
        invoice.paidAt = new Date();
      }

      await invoice.save();
      const populated = await Invoice.findById(invoice._id)
        .populate('cafe', 'firstName lastName email shopName shopAddress')
        .populate({ path: 'shift', populate: { path: 'acceptedBy', select: 'firstName lastName email' } })
        .lean();
      res.json(populated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/admin/invoices/:id/reject-proof
// @desc    Reject payment proof and request resubmission (status back to approved)
// @access  Private (Admin)
router.put(
  '/invoices/:id/reject-proof',
  [body('reason').trim().notEmpty().withMessage('Rejection reason is required')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      if (invoice.status !== 'pending_verification') {
        return res.status(400).json({ message: 'Only invoices with submitted proof can be rejected' });
      }
      invoice.status = 'approved';
      invoice.paymentProofRejectionReason = req.body.reason.trim();
      invoice.paymentProofRejectedAt = new Date();
      await invoice.save();
      const populated = await Invoice.findById(invoice._id)
        .populate('cafe', 'firstName lastName email shopName shopAddress')
        .populate({ path: 'shift', populate: { path: 'acceptedBy', select: 'firstName lastName email' } })
        .lean();
      res.json(populated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;
