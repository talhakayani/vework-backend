import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import Shift from '../models/Shift';
import Invoice from '../models/Invoice';
import Application from '../models/Application';
import PlatformConfig from '../models/PlatformConfig';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { getHoursFromShift } from '../utils/calculateShiftCost';

const router = express.Router();

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
      if (req.body.startTime !== undefined) updates.startTime = req.body.startTime;
      if (req.body.endTime !== undefined) updates.endTime = req.body.endTime;
      if (req.body.date !== undefined) updates.date = req.body.date;
      if (req.body.requiredEmployees !== undefined) updates.requiredEmployees = req.body.requiredEmployees;
      if (req.body.description !== undefined) updates.description = req.body.description;

      const updatedShift = await Shift.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
        .populate('cafe', 'shopName shopAddress')
        .populate('acceptedBy', 'firstName lastName email');

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

      // Handle completed shifts (payment verification and invoice generation)
      if (shift.status === 'completed') {
        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({ shift: shift._id });
        if (existingInvoice) {
          return res.status(400).json({ message: 'Invoice already exists for this shift' });
        }

        // Ensure acceptedBy is an array and check length
        const acceptedByArray = Array.isArray(shift.acceptedBy) ? shift.acceptedBy : [];
        const acceptedCount = acceptedByArray.length;

        // Generate invoice with paid status (admin has verified payment)
        if (acceptedCount > 0) {
          const hours = getHoursFromShift(shift.startTime, shift.endTime);
          const invoiceNumber = `INV-${Date.now()}-${shift._id.toString().slice(-6)}`;

          const invoice = await Invoice.create({
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
            baseAmount: shift.baseHourlyRate * hours * acceptedCount,
            platformFee: shift.platformFee,
            penaltyAmount: shift.penaltyAmount || 0,
            totalAmount: shift.totalCost + (shift.penaltyAmount || 0),
            status: 'paid',
            paidAt: new Date(),
          });

          // Populate shift for response
          const populatedShift = await Shift.findById(shift._id)
            .populate('cafe', 'shopName shopAddress')
            .populate('acceptedBy', 'firstName lastName');

          return res.json({
            shift: populatedShift,
            invoice,
            message: 'Payment verified and invoice generated'
          });
        } else {
          return res.status(400).json({ message: 'Cannot generate invoice: shift has no accepted employees' });
        }
      }

      return res.status(400).json({ message: 'Only pending-approval or completed shifts can be approved' });
    } catch (error: any) {
      console.error('Error approving shift:', error);
      res.status(500).json({ message: error.message || 'Failed to approve shift' });
    }
  });

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

      const config = await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $set: updateData },
        { new: true, upsert: true }
      );

      res.json({
        employeePriceDeductionPercentage: config.employeePriceDeductionPercentage ?? 0,
        platformFeePerShift: config.platformFeePerShift ?? 10,
        freeShiftsPerCafe: config.freeShiftsPerCafe ?? 2,
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
// @desc    Update invoice (status, platform fee, base amount, total amount)
// @access  Private (Admin)
router.put(
  '/invoices/:id',
  [
    body('status').optional().isIn(['pending', 'paid']),
    body('platformFee').optional().isFloat({ min: 0 }),
    body('baseAmount').optional().isFloat({ min: 0 }),
    body('totalAmount').optional().isFloat({ min: 0 }),
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

      if (req.body.status !== undefined) {
        invoice.status = req.body.status;
        if (req.body.status === 'paid') {
          invoice.paidAt = new Date();
        } else if (req.body.status === 'pending') {
          invoice.paidAt = undefined;
        }
      }
      if (req.body.platformFee !== undefined) {
        invoice.platformFee = parseFloat(req.body.platformFee);
      }
      if (req.body.baseAmount !== undefined) {
        invoice.baseAmount = parseFloat(req.body.baseAmount);
      }
      if (req.body.totalAmount !== undefined) {
        invoice.totalAmount = parseFloat(req.body.totalAmount);
      } else if (req.body.baseAmount !== undefined || req.body.platformFee !== undefined) {
        invoice.totalAmount = invoice.baseAmount + invoice.platformFee + (invoice.penaltyAmount || 0);
      }

      await invoice.save();
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;
