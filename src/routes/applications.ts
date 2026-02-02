import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import Application from '../models/Application';
import Shift from '../models/Shift';
import User from '../models/User';
import Review from '../models/Review';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';

const router = express.Router();

// @route   POST /api/applications
// @desc    Apply for a shift (Employee only)
// @access  Private (Employee)
router.post(
  '/',
  protect,
  requireApproval,
  [body('shiftId').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'employee') {
        return res.status(403).json({ message: 'Only employees can apply for shifts' });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { shiftId } = req.body;

      const shift = await Shift.findById(shiftId);
      if (!shift) {
        return res.status(404).json({ message: 'Shift not found' });
      }

      if (shift.status !== 'open') {
        return res.status(400).json({ message: 'Shift is not available for applications' });
      }

      // Check if employee is blocked from this shift
      if (shift.blockedEmployees && shift.blockedEmployees.some((id: any) => id.toString() === req.user._id.toString())) {
        return res.status(403).json({ message: 'You have been blocked from applying to this shift' });
      }

      // Check if already applied
      const existingApplication = await Application.findOne({
        shift: shiftId,
        employee: req.user._id,
      });

      if (existingApplication) {
        return res.status(400).json({
          message: 'You have already applied for this shift',
          application: existingApplication,
        });
      }

      const application = await Application.create({
        shift: shiftId,
        employee: req.user._id,
        status: 'pending',
      });

      const populated = await Application.findById(application._id)
        .populate('shift')
        .populate('employee', getSafeUserFields('employee'));

      // Sanitize user data
      const appObj = populated?.toObject();
      if (appObj?.employee) {
        appObj.employee = sanitizeUser(appObj.employee);
      }
      if (appObj?.shift?.cafe) {
        appObj.shift.cafe = sanitizeUser(appObj.shift.cafe);
      }

      res.status(201).json(appObj);
    } catch (error: any) {
      if (error.code === 11000) {
        return res.status(400).json({ message: 'You have already applied for this shift' });
      }
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/applications/my-applications
// @desc    Get employee's applications
// @access  Private (Employee)
router.get('/my-applications', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can view their applications' });
    }

    const applications = await Application.find({ employee: req.user._id })
      .populate('shift')
      .populate({
        path: 'shift',
        populate: { path: 'cafe', select: 'shopName shopAddress' },
      })
      .sort({ createdAt: -1 });

    res.json(applications);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/applications/shift/:shiftId
// @desc    Get applications for a shift (Café only)
// @access  Private (Café)
router.get('/shift/:shiftId', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can view shift applications' });
    }

    const shift = await Shift.findById(req.params.shiftId);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const applications = await Application.find({ shift: req.params.shiftId })
      .populate('employee', 'firstName lastName rating totalReviews cvPath')
      .sort({ createdAt: -1 });

    // Get reviews for each employee
    const applicationsWithReviews = await Promise.all(
      applications.map(async (app) => {
        const employeeId = typeof app.employee === 'object' ? app.employee._id : app.employee;
        const reviews = await Review.find({ reviewed: employeeId })
          .populate('reviewer', 'shopName')
          .populate('shift', 'date')
          .sort({ createdAt: -1 })
          .limit(5);

        const appObj = app.toObject();
        // Sanitize employee data - remove email, DOB, but keep CV path for review
        if (appObj.employee) {
          const employee = appObj.employee as any;
          appObj.employee = {
            _id: employee._id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            rating: employee.rating,
            totalReviews: employee.totalReviews,
            cvPath: employee.cvPath, // Keep CV path for cafe to review
            // DO NOT include: email, dateOfBirth
          };
        }

        return {
          ...appObj,
          employeeReviews: reviews,
        };
      })
    );

    res.json(applicationsWithReviews);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/applications/:id/accept
// @desc    Accept application (Café only)
// @access  Private (Café)
router.put('/:id/accept', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can accept applications' });
    }

    const application = await Application.findById(req.params.id).populate('shift');
    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const shift = application.shift as any;
    if (shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'Application is not pending' });
    }

    // Check if shift is still open and has space
    const acceptedCount = await Application.countDocuments({
      shift: shift._id,
      status: 'accepted',
    });

    if (acceptedCount >= shift.requiredEmployees) {
      return res.status(400).json({ message: 'Shift is already full' });
    }

    // Accept the application
    application.status = 'accepted';
    application.reviewedAt = new Date();
    application.reviewedBy = req.user._id;
    await application.save();

    // Add employee to shift's acceptedBy array
    const employeeId = typeof application.employee === 'object' 
        ? (application.employee as any)._id 
        : application.employee;
    
    if (!shift.acceptedBy.some((id: any) => id.toString() === employeeId.toString())) {
      shift.acceptedBy.push(employeeId);
    }

    // Reject other pending applications if shift is now full
    const newAcceptedCount = await Application.countDocuments({
      shift: shift._id,
      status: 'accepted',
    });

    if (newAcceptedCount >= shift.requiredEmployees) {
      await Application.updateMany(
        {
          shift: shift._id,
          status: 'pending',
          _id: { $ne: application._id },
        },
        {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: req.user._id,
          rejectionReason: 'Shift is now full',
        }
      );

      // Update shift status
      shift.status = 'accepted';
    }
    
    await shift.save();

    const populated = await Application.findById(application._id)
      .populate('shift')
      .populate('employee', getSafeUserFields('employee'));

    // Sanitize user data
    const appObj = populated?.toObject();
    if (appObj?.employee) {
      appObj.employee = sanitizeUser(appObj.employee);
    }
    if (appObj?.shift?.cafe) {
      appObj.shift.cafe = sanitizeUser(appObj.shift.cafe);
    }

    res.json(appObj);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/applications/:id/reject
// @desc    Reject application (Café only)
// @access  Private (Café)
router.put(
  '/:id/reject',
  protect,
  requireApproval,
  [body('rejectionReason').optional().trim()],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafés can reject applications' });
      }

      const application = await Application.findById(req.params.id).populate('shift');
      if (!application) {
        return res.status(404).json({ message: 'Application not found' });
      }

      const shift = application.shift as any;
      if (shift.cafe.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      if (application.status !== 'pending') {
        return res.status(400).json({ message: 'Application is not pending' });
      }

      application.status = 'rejected';
      application.reviewedAt = new Date();
      application.reviewedBy = req.user._id;
      application.rejectionReason = req.body.rejectionReason || 'Application rejected';
      await application.save();

      const populated = await Application.findById(application._id)
        .populate('shift')
        .populate('employee', getSafeUserFields('employee'));

      // Sanitize user data
      const appObj = populated?.toObject();
      if (appObj?.employee) {
        appObj.employee = sanitizeUser(appObj.employee);
      }
      if (appObj?.shift?.cafe) {
        appObj.shift.cafe = sanitizeUser(appObj.shift.cafe);
      }

      res.json(appObj);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/applications/:id/withdraw
// @desc    Withdraw application (Employee only)
// @access  Private (Employee)
router.put('/:id/withdraw', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({ message: 'Only employees can withdraw applications' });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    if (application.employee.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'Can only withdraw pending applications' });
    }

    application.status = 'withdrawn';
    await application.save();

    res.json(application);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
