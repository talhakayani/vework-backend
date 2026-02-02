import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import Shift from '../models/Shift';
import Application from '../models/Application';
import Invoice from '../models/Invoice';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { calculateShiftCost, calculatePenalty, getHoursFromShift } from '../utils/calculateShiftCost';
import { differenceInHours } from 'date-fns';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';
import { uploadPaymentProof } from '../utils/uploadPaymentProof';

const router = express.Router();

// @route   POST /api/shifts
// @desc    Create shift (Café only) - requires payment proof
// @access  Private (Café)
router.post(
  '/',
  protect,
  requireApproval,
  uploadPaymentProof.single('paymentProof'),
  [
    body('date').isISO8601(),
    body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('requiredEmployees').isInt({ min: 1 }),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('hourlyRate').optional().isFloat({ min: 14 }).withMessage('Hourly rate must be at least £14'),
    body('location')
      .optional()
      .custom((value) => {
        if (!value) return true;
        // Handle both JSON string and object
        const locationObj = typeof value === 'string' ? JSON.parse(value) : value;
        if (typeof locationObj !== 'object') {
          throw new Error('Location must be an object');
        }
        if (typeof locationObj.address !== 'string' || !locationObj.address.trim()) {
          throw new Error('Location address is required');
        }
        if (typeof locationObj.latitude !== 'number' || typeof locationObj.longitude !== 'number') {
          throw new Error('Location latitude and longitude are required');
        }
        return true;
      }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafés can create shifts' });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { date, startTime, endTime, requiredEmployees, description, hourlyRate, location } = req.body;

      const baseHourlyRate = hourlyRate
        ? parseFloat(hourlyRate)
        : parseFloat(process.env.BASE_HOURLY_RATE || '14');

      if (baseHourlyRate < 14) {
        return res.status(400).json({ message: 'Hourly rate must be at least £14' });
      }

      const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');

      const { baseAmount, platformFee, totalCost } = calculateShiftCost(
        startTime,
        endTime,
        baseHourlyRate,
        platformFeePercentage,
        requiredEmployees
      );

      // Parse location if it's a JSON string
      let locationObj = location;
      if (typeof location === 'string') {
        try {
          locationObj = JSON.parse(location);
        } catch {
          locationObj = null;
        }
      }

      // Payment proof is optional at create time; required when marking shift complete
      const paymentProofPath = req.file ? `uploads/payment-proofs/${req.file.filename}` : undefined;

      const shift = await Shift.create({
        cafe: req.user._id,
        date,
        startTime,
        endTime,
        requiredEmployees,
        description,
        baseHourlyRate,
        platformFee,
        totalCost,
        location: locationObj,
        ...(paymentProofPath && { paymentProof: paymentProofPath }),
        status: 'pending_approval',
      });

      res.status(201).json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/shifts
// @desc    Get shifts (filtered by role)
// @access  Private
router.get('/', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    let query: any = {};

    if (req.user?.role === 'employee') {
      // Employees see only open shifts (first-come-first-serve, no application filtering)
      // Exclude shifts where employee is blocked by cafe owner
      query = {
        status: 'open',
        blockedEmployees: { $nin: [req.user._id] },
      };
    } else if (req.user?.role === 'cafe') {
      // Cafés see only their own shifts
      query = { cafe: req.user._id };
    }

    // Date filter
    if (req.query.date) {
      query.date = new Date(req.query.date as string);
    }

    const shifts = await Shift.find(query)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'))
      .populate('blockedEmployees', 'firstName lastName email')
      .sort({ date: 1, startTime: 1 });

    // Sanitize user data in response and handle employee hourly rate
    const sanitizedShifts = shifts.map(shift => {
      const shiftObj = shift.toObject();
      if (shiftObj.cafe) {
        shiftObj.cafe = sanitizeUser(shiftObj.cafe);
      }
      if (Array.isArray(shiftObj.acceptedBy)) {
        shiftObj.acceptedBy = shiftObj.acceptedBy.map((user: any) => sanitizeUser(user));
      }

      // Show employeeHourlyRate to employees, baseHourlyRate to cafés
      if (req.user?.role === 'employee') {
        // Employees see employeeHourlyRate if set, otherwise baseHourlyRate
        shiftObj.hourlyRate = shiftObj.employeeHourlyRate ?? shiftObj.baseHourlyRate;
        // Don't expose baseHourlyRate to employees
        delete shiftObj.baseHourlyRate;
      } else if (req.user?.role === 'cafe') {
        // Cafés see baseHourlyRate, not employeeHourlyRate
        shiftObj.hourlyRate = shiftObj.baseHourlyRate;
        delete shiftObj.employeeHourlyRate;
      }

      return shiftObj;
    });

    res.json(sanitizedShifts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/shifts/:id
// @desc    Get single shift
// @access  Private
router.get('/:id', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await Shift.findById(req.params.id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'))
      .populate('blockedEmployees', 'firstName lastName email');

    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    // Check if employee is blocked from this shift
    if (req.user?.role === 'employee') {
      // Check if employee is blocked
      if (shift.blockedEmployees && shift.blockedEmployees.some((id: any) =>
        id.toString() === req.user._id.toString()
      )) {
        return res.status(403).json({ message: 'You have been blocked from viewing this shift' });
      }

      // Employees can only see open shifts (unless they're already accepted to it)
      const isAccepted = shift.acceptedBy.some((id: any) =>
        id.toString() === req.user._id.toString()
      );
      if (shift.status !== 'open' && !isAccepted) {
        return res.status(403).json({ message: 'Shift is not available' });
      }
    }

    // Sanitize user data and handle employee hourly rate
    const shiftObj = shift.toObject();
    if (shiftObj.cafe) {
      shiftObj.cafe = sanitizeUser(shiftObj.cafe);
    }
    if (Array.isArray(shiftObj.acceptedBy)) {
      shiftObj.acceptedBy = shiftObj.acceptedBy.map((user: any) => sanitizeUser(user));
    }

    // Show employeeHourlyRate to employees, baseHourlyRate to cafés
    if (req.user?.role === 'employee') {
      // Employees see employeeHourlyRate if set, otherwise baseHourlyRate
      shiftObj.hourlyRate = shiftObj.employeeHourlyRate ?? shiftObj.baseHourlyRate;
      delete shiftObj.baseHourlyRate;
    } else if (req.user?.role === 'cafe') {
      // Cafés see baseHourlyRate, not employeeHourlyRate
      shiftObj.hourlyRate = shiftObj.baseHourlyRate;
      delete shiftObj.employeeHourlyRate;
    }

    res.json(shiftObj);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/shifts/:id
// @desc    Update shift (Café only, if not accepted)
// @access  Private (Café)
router.put(
  '/:id',
  protect,
  requireApproval,
  [
    body('date').optional().isISO8601(),
    body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('requiredEmployees').optional().isInt({ min: 1 }),
    body('description').optional().trim().notEmpty().withMessage('Description is required'),
    body('hourlyRate').optional().isFloat({ min: 14 }).withMessage('Hourly rate must be at least £14'),
    body('location')
      .optional()
      .custom((value) => {
        if (!value) return true;
        if (typeof value !== 'object') {
          throw new Error('Location must be an object');
        }
        if (typeof value.address !== 'string' || !value.address.trim()) {
          throw new Error('Location address is required');
        }
        if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
          throw new Error('Location latitude and longitude are required');
        }
        return true;
      }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafés can update shifts' });
      }

      const shift = await Shift.findById(req.params.id);
      if (!shift) {
        return res.status(404).json({ message: 'Shift not found' });
      }

      if (shift.cafe.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      if (shift.status === 'completed' || shift.status === 'cancelled') {
        return res.status(400).json({ message: 'Cannot edit completed or cancelled shift' });
      }

      if (shift.status === 'accepted' || shift.acceptedBy.length > 0) {
        return res.status(400).json({ message: 'Cannot edit shift with assigned employees' });
      }

      const updates = req.body;

      // Determine hourly rate (use provided or existing or default)
      const hourlyRate = updates.hourlyRate
        ? parseFloat(updates.hourlyRate)
        : (shift.baseHourlyRate || parseFloat(process.env.BASE_HOURLY_RATE || '14'));

      if (hourlyRate < 14) {
        return res.status(400).json({ message: 'Hourly rate must be at least £14' });
      }

      if (updates.startTime || updates.endTime || updates.requiredEmployees || updates.hourlyRate) {
        const startTime = updates.startTime || shift.startTime;
        const endTime = updates.endTime || shift.endTime;
        const requiredEmployees = updates.requiredEmployees || shift.requiredEmployees;
        const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');

        const { baseAmount, platformFee, totalCost } = calculateShiftCost(
          startTime,
          endTime,
          hourlyRate,
          platformFeePercentage,
          requiredEmployees
        );

        updates.baseHourlyRate = hourlyRate;
        updates.platformFee = platformFee;
        updates.totalCost = totalCost;
      }

      const updatedShift = await Shift.findByIdAndUpdate(req.params.id, updates, { new: true });
      res.json(updatedShift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Note: Direct shift acceptance is deprecated. Use applications instead.
// Keeping this for backward compatibility but it should redirect to application flow

// @route   POST /api/shifts/:id/cancel
// @desc    Cancel shift (Employee or Café)
// @access  Private
router.post('/:id/cancel', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    const shiftDateTime = new Date(shift.date);
    const [hours, minutes] = shift.startTime.split(':').map(Number);
    shiftDateTime.setHours(hours, minutes, 0, 0);

    const hoursUntilShift = differenceInHours(shiftDateTime, new Date());

    // Check if shift was posted on the same day (less than 24 hours from creation)
    const hoursSinceCreation = differenceInHours(new Date(), shift.createdAt);
    const isSameDayPost = hoursSinceCreation < 24;

    // Employee cancellation (same as reject, but with penalty logic)
    if (req.user?.role === 'employee') {
      if (!shift.acceptedBy.some((id: any) => id.toString() === req.user._id.toString())) {
        return res.status(400).json({ message: 'You have not accepted this shift' });
      }

      // If cancelling within 24 hours AND shift was not posted same day, apply employee penalty
      if (hoursUntilShift <= 24 && hoursUntilShift > 0 && !isSameDayPost) {
        const penaltyPercentage = parseFloat(process.env.EMPLOYEE_PENALTY_PERCENTAGE || '50');
        const hoursWorked = getHoursFromShift(shift.startTime, shift.endTime);
        const hourlyRate = shift.employeeHourlyRate ?? shift.baseHourlyRate;
        const expectedEarnings = hoursWorked * hourlyRate;
        const employeePenalty = calculatePenalty(expectedEarnings, penaltyPercentage);
        shift.employeePenaltyApplied = true;
        shift.employeePenaltyAmount = employeePenalty;
      }

      // Remove employee from accepted list
      const employeeIndex = shift.acceptedBy.findIndex(
        (id: any) => id.toString() === req.user._id.toString()
      );
      if (employeeIndex !== -1) {
        shift.acceptedBy.splice(employeeIndex, 1);
      }

      // Update shift status if needed
      if (shift.acceptedBy.length === 0) {
        shift.status = 'open';
      } else if (shift.status === 'accepted' && shift.acceptedBy.length < shift.requiredEmployees) {
        shift.status = 'open';
      }
    }

    // Café cancellation
    if (req.user?.role === 'cafe') {
      if (shift.cafe.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      // Check if more than 24 hours until shift
      if (hoursUntilShift <= 24) {
        return res.status(400).json({
          message: 'Cannot cancel shift with less than 24 hours remaining. Please contact support if this is an emergency.'
        });
      }

      // No penalty if shift was posted same day OR if cancelling with more than 24 hours notice
      if (hoursUntilShift > 24 && shift.acceptedBy.length > 0 && !isSameDayPost) {
        // Only apply penalty if shift was posted more than 24 hours ago and has employees
        // But since we're checking hoursUntilShift > 24, penalty only applies if posted earlier
        // For same-day posts, no penalty regardless
      }

      shift.status = 'cancelled';
    }

    await shift.save();
    res.json(shift);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shifts/:id/pause
// @desc    Pause shift (Café only)
// @access  Private (Café)
router.post('/:id/pause', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can pause shifts' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (shift.acceptedBy.length > 0) {
      const shiftDateTime = new Date(shift.date);
      const [hours, minutes] = shift.startTime.split(':').map(Number);
      shiftDateTime.setHours(hours, minutes, 0, 0);
      const hoursUntilShift = differenceInHours(shiftDateTime, new Date());

      // Check if shift was posted on the same day
      const hoursSinceCreation = differenceInHours(new Date(), shift.createdAt);
      const isSameDayPost = hoursSinceCreation < 24;

      // Only apply penalty if shift was NOT posted same day AND within 24 hours
      if (hoursUntilShift <= 24 && !isSameDayPost) {
        const penaltyPercentage = parseFloat(process.env.PENALTY_PERCENTAGE || '50');
        shift.penaltyAmount = calculatePenalty(shift.totalCost, penaltyPercentage);
        shift.penaltyApplied = true;
      }
    }

    shift.status = 'paused';
    await shift.save();
    res.json(shift);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/shifts/:id
// @desc    Delete shift (Café only, if not accepted)
// @access  Private (Café)
router.delete('/:id', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can delete shifts' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (shift.acceptedBy.length > 0) {
      const shiftDateTime = new Date(shift.date);
      const [hours, minutes] = shift.startTime.split(':').map(Number);
      shiftDateTime.setHours(hours, minutes, 0, 0);
      const hoursUntilShift = differenceInHours(shiftDateTime, new Date());

      // Check if shift was posted on the same day
      const hoursSinceCreation = differenceInHours(new Date(), shift.createdAt);
      const isSameDayPost = hoursSinceCreation < 24;

      // Only apply penalty if shift was NOT posted same day AND within 24 hours
      if (hoursUntilShift <= 24 && !isSameDayPost) {
        const penaltyPercentage = parseFloat(process.env.PENALTY_PERCENTAGE || '50');
        shift.penaltyAmount = calculatePenalty(shift.totalCost, penaltyPercentage);
        shift.penaltyApplied = true;
        await shift.save();
      }
    }

    await Shift.findByIdAndDelete(req.params.id);
    res.json({ message: 'Shift deleted' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shifts/:id/complete
// @desc    Mark shift as completed (Café only). Payment proof required; must complete within 2 days of shift end.
// @access  Private (Café)
const PAYMENT_WINDOW_HOURS = 48; // 2 days after shift end

router.post(
  '/:id/complete',
  protect,
  requireApproval,
  uploadPaymentProof.single('paymentProof'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafés can complete shifts' });
      }

      const shift = await Shift.findById(req.params.id);
      if (!shift) {
        return res.status(404).json({ message: 'Shift not found' });
      }

      if (shift.cafe.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      if (shift.status !== 'accepted') {
        return res.status(400).json({ message: 'Only accepted shifts can be marked complete' });
      }

      // Shift end must have passed
      const shiftEndDate = new Date(shift.date);
      const [endHour, endMin] = shift.endTime.split(':').map(Number);
      shiftEndDate.setHours(endHour, endMin, 0, 0);
      const now = new Date();
      if (shiftEndDate > now) {
        return res.status(400).json({
          message: 'You can only complete the shift after the shift end time has passed.',
        });
      }

      // Must complete within 2 days of shift end
      const hoursSinceShiftEnd = differenceInHours(now, shiftEndDate);
      if (hoursSinceShiftEnd > PAYMENT_WINDOW_HOURS) {
        return res.status(400).json({
          message: `Payment window closed. You had 2 days after the shift end to submit payment and complete. Please contact support.`,
        });
      }

      // Payment proof is required to complete
      if (!req.file) {
        return res.status(400).json({
          message: 'Payment proof (transaction receipt/screenshot) is required to complete the shift.',
        });
      }

      const paymentProofPath = `uploads/payment-proofs/${req.file.filename}`;
      shift.paymentProof = paymentProofPath;
      shift.status = 'completed';
      await shift.save();

      res.json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   POST /api/shifts/:id/accept
// @desc    Accept shift (Employee only) - First come first serve
// @access  Private (Employee)
router.post('/:id/accept', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can accept shifts' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.status !== 'open') {
      return res.status(400).json({ message: 'Shift is not available' });
    }

    // Check if shift is full
    if (shift.acceptedBy.length >= shift.requiredEmployees) {
      return res.status(400).json({ message: 'Shift is already full' });
    }

    // Check if employee already accepted this shift
    if (shift.acceptedBy.some((id: any) => id.toString() === req.user._id.toString())) {
      return res.status(400).json({ message: 'You have already accepted this shift' });
    }

    // Add employee to acceptedBy array
    shift.acceptedBy.push(req.user._id);

    // Update shift status to 'accepted' if all required employees are filled
    if (shift.acceptedBy.length >= shift.requiredEmployees) {
      shift.status = 'accepted';
    }

    await shift.save();

    // Populate and return updated shift
    const populated = await Shift.findById(shift._id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'));

    const shiftObj = populated?.toObject();
    if (shiftObj?.cafe) {
      shiftObj.cafe = sanitizeUser(shiftObj.cafe);
    }
    if (Array.isArray(shiftObj?.acceptedBy)) {
      shiftObj.acceptedBy = shiftObj.acceptedBy.map((user: any) => sanitizeUser(user));
    }

    res.json(shiftObj);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shifts/:id/reject
// @desc    Reject/decline shift (Employee only)
// @access  Private (Employee)
router.post('/:id/reject', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can reject shifts' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    // Remove employee from acceptedBy if they were accepted
    const employeeIndex = shift.acceptedBy.findIndex(
      (id: any) => id.toString() === req.user._id.toString()
    );

    if (employeeIndex === -1) {
      return res.status(400).json({ message: 'You have not accepted this shift' });
    }

    shift.acceptedBy.splice(employeeIndex, 1);

    // If shift was 'accepted' and now has fewer employees, change back to 'open'
    if (shift.status === 'accepted' && shift.acceptedBy.length < shift.requiredEmployees) {
      shift.status = 'open';
    }

    await shift.save();

    // Populate and return updated shift
    const populated = await Shift.findById(shift._id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'));

    const shiftObj = populated?.toObject();
    if (shiftObj?.cafe) {
      shiftObj.cafe = sanitizeUser(shiftObj.cafe);
    }
    if (Array.isArray(shiftObj?.acceptedBy)) {
      shiftObj.acceptedBy = shiftObj.acceptedBy.map((user: any) => sanitizeUser(user));
    }

    res.json(shiftObj);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shifts/:id/remove-employee/:employeeId
// @desc    Remove employee from shift and optionally block them (Café only)
// @access  Private (Café)
router.post('/:id/remove-employee/:employeeId', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can remove employees from shifts' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const employeeId = req.params.employeeId;
    const blockEmployee = req.body.block === true;

    // Remove employee from acceptedBy
    const employeeIndex = shift.acceptedBy.findIndex(
      (id: any) => id.toString() === employeeId
    );

    if (employeeIndex === -1) {
      return res.status(400).json({ message: 'Employee is not assigned to this shift' });
    }

    shift.acceptedBy.splice(employeeIndex, 1);

    // Block employee if requested
    if (blockEmployee) {
      if (!shift.blockedEmployees) {
        shift.blockedEmployees = [];
      }
      // Add to blocked list if not already blocked
      if (!shift.blockedEmployees.some((id: any) => id.toString() === employeeId)) {
        shift.blockedEmployees.push(employeeId);
      }
    }

    // Reject any pending applications from this employee for this shift
    await Application.updateMany(
      {
        shift: shift._id,
        employee: employeeId,
        status: 'pending',
      },
      {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
        rejectionReason: blockEmployee
          ? 'Employee removed and blocked from this shift'
          : 'Employee removed from shift',
      }
    );

    // Update shift status - reopen if needed
    if (shift.acceptedBy.length < shift.requiredEmployees) {
      if (shift.status === 'accepted') {
        shift.status = 'open';
      }
    }

    // If no employees left, ensure status is open
    if (shift.acceptedBy.length === 0) {
      shift.status = 'open';
    }

    await shift.save();

    // Populate and return updated shift
    const populated = await Shift.findById(shift._id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('acceptedBy', getSafeUserFields('employee'))
      .populate('blockedEmployees', 'firstName lastName email');

    const shiftObj = populated?.toObject();
    if (shiftObj?.cafe) {
      shiftObj.cafe = sanitizeUser(shiftObj.cafe);
    }
    if (Array.isArray(shiftObj?.acceptedBy)) {
      shiftObj.acceptedBy = shiftObj.acceptedBy.map((user: any) => sanitizeUser(user));
    }

    res.json({
      shift: shiftObj,
      message: blockEmployee
        ? 'Employee removed and blocked from this shift'
        : 'Employee removed from shift',
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
