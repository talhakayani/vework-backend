import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import Review from '../models/Review';
import Shift from '../models/Shift';
import User from '../models/User';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';

const router = express.Router();

// @route   POST /api/reviews
// @desc    Create review: Café reviews Employee, or Employee reviews Café (completed shift only)
// @access  Private
router.post(
  '/',
  protect,
  requireApproval,
  [
    body('shiftId').notEmpty(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().trim(),
    body('employeeId').optional(), // required only when café is reviewing an employee
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { shiftId, employeeId, rating, comment } = req.body;
      const isCafe = req.user?.role === 'cafe';
      const isEmployee = req.user?.role === 'employee';

      const shift = await Shift.findById(shiftId);
      if (!shift) {
        return res.status(404).json({ message: 'Shift not found' });
      }
      if (shift.status !== 'completed') {
        return res.status(400).json({ message: 'Can only review completed shifts' });
      }

      if (isCafe) {
        // Café reviewing employee
        if (!employeeId) {
          return res.status(400).json({ message: 'employeeId is required when reviewing an employee' });
        }
        if (shift.cafe.toString() !== req.user!._id.toString()) {
          return res.status(403).json({ message: 'Not authorized to review this shift' });
        }
        if (!shift.acceptedBy.some((id: any) => id.toString() === employeeId)) {
          return res.status(400).json({ message: 'Employee did not work this shift' });
        }

        const existingReview = await Review.findOne({ shift: shiftId, reviewed: employeeId });
        if (existingReview) {
          return res.status(400).json({ message: 'Review already exists for this employee' });
        }

        const review = await Review.create({
          shift: shiftId,
          reviewer: req.user!._id,
          reviewed: employeeId,
          rating,
          comment,
        });

        const employee = await User.findById(employeeId);
        if (employee) {
          const totalReviews = (employee.totalReviews || 0) + 1;
          const currentRating = employee.rating || 0;
          const newRating = ((currentRating * (totalReviews - 1)) + rating) / totalReviews;
          employee.rating = Math.round(newRating * 10) / 10;
          employee.totalReviews = totalReviews;
          await employee.save();
        }

        return res.status(201).json(review);
      }

      if (isEmployee) {
        // Employee reviewing café
        const acceptedIds = (shift.acceptedBy || []).map((id: any) => id.toString());
        if (!acceptedIds.includes(req.user!._id.toString())) {
          return res.status(403).json({ message: 'You did not work this shift' });
        }

        const cafeId = shift.cafe.toString();
        const existingReview = await Review.findOne({
          shift: shiftId,
          reviewer: req.user!._id,
          reviewed: cafeId,
        });
        if (existingReview) {
          return res.status(400).json({ message: 'You have already reviewed this shift' });
        }

        const review = await Review.create({
          shift: shiftId,
          reviewer: req.user!._id,
          reviewed: cafeId,
          rating,
          comment,
        });

        const cafe = await User.findById(cafeId);
        if (cafe) {
          const totalCafeReviews = (cafe.totalCafeReviews || 0) + 1;
          const currentRating = cafe.cafeRating || 0;
          const newRating = ((currentRating * (totalCafeReviews - 1)) + rating) / totalCafeReviews;
          cafe.cafeRating = Math.round(newRating * 10) / 10;
          cafe.totalCafeReviews = totalCafeReviews;
          await cafe.save();
        }

        return res.status(201).json(review);
      }

      return res.status(403).json({ message: 'Only cafés and employees can leave reviews' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/reviews/employee/:id
// @desc    Get reviews for an employee (reviews received from cafés)
// @access  Private
router.get('/employee/:id', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    const reviews = await Review.find({ reviewed: req.params.id })
      .populate('reviewer', getSafeUserFields('cafe'))
      .populate('shift', 'date startTime endTime')
      .sort({ createdAt: -1 })
      .lean();

    const sanitizedReviews = reviews.map((review: any) => {
      if (review.reviewer) {
        review.reviewer = sanitizeUser(review.reviewer);
      }
      return review;
    });

    res.json(sanitizedReviews);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reviews/cafe/:id
// @desc    Get reviews for a café (reviews received from employees)
// @access  Private
router.get('/cafe/:id', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    const reviews = await Review.find({ reviewed: req.params.id })
      .populate('reviewer', getSafeUserFields('employee'))
      .populate('shift', 'date startTime endTime')
      .sort({ createdAt: -1 })
      .lean();

    const sanitizedReviews = reviews.map((review: any) => {
      if (review.reviewer) {
        review.reviewer = sanitizeUser(review.reviewer);
      }
      return review;
    });

    res.json(sanitizedReviews);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reviews/for-shift/:shiftId
// @desc    Get all reviews for a shift: employeeReviews (café→employee), cafeReview (employee→café)
// @access  Private (café owner or employee who worked the shift)
router.get('/for-shift/:shiftId', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    const { shiftId } = req.params;
    const shift = await Shift.findById(shiftId).lean();
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    const isCafe = req.user?.role === 'cafe' && shift.cafe.toString() === req.user!._id.toString();
    const acceptedIds = (shift.acceptedBy || []).map((id: any) => id.toString());
    const isEmployeeOnShift = req.user?.role === 'employee' && acceptedIds.includes(req.user!._id.toString());

    if (!isCafe && !isEmployeeOnShift) {
      return res.status(403).json({ message: 'Not authorized to view reviews for this shift' });
    }

    // Reviews where café reviewed employees (reviewer = cafe, reviewed = employee)
    const employeeReviews = await Review.find({ shift: shiftId, reviewer: shift.cafe })
      .populate('reviewed', getSafeUserFields('employee'))
      .populate('shift', 'date startTime endTime')
      .sort({ createdAt: -1 })
      .lean();

    // Review where an employee reviewed the café (reviewer = employee, reviewed = cafe)
    const cafeReviews = await Review.find({ shift: shiftId, reviewed: shift.cafe })
      .populate('reviewer', getSafeUserFields('employee'))
      .populate('shift', 'date startTime endTime')
      .lean();

    const sanitizedEmployeeReviews = employeeReviews.map((r: any) => {
      if (r.reviewed) r.reviewed = sanitizeUser(r.reviewed);
      return r;
    });
    const sanitizedCafeReviews = cafeReviews.map((r: any) => {
      if (r.reviewer) r.reviewer = sanitizeUser(r.reviewer);
      return r;
    });

    res.json({
      employeeReviews: sanitizedEmployeeReviews,
      cafeReviews: sanitizedCafeReviews,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
