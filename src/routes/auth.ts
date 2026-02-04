import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import { generateToken } from '../utils/generateToken';
import { protect, AuthRequest } from '../middleware/auth';
import { upload } from '../utils/upload';
import { maskPaymentDetails } from '../utils/maskPaymentDetails';
import { generateVerificationToken, sendVerificationEmail } from '../utils/sendVerificationEmail';

const router = express.Router();

// @route   POST /api/auth/register/employee
// @desc    Register employee
// @access  Public
router.post(
  '/register/employee',
  upload.single('cv'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('dateOfBirth').isISO8601(),
    body('shareCode').trim().notEmpty(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, firstName, lastName, dateOfBirth, shareCode } = req.body;

      const userExists = await User.findOne({ email });
      if (userExists) {
        return res.status(400).json({ message: 'User already exists' });
      }

      const cvPath = req.file ? `uploads/${req.file.filename}` : undefined;
      const verificationToken = generateVerificationToken();

      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        dateOfBirth,
        shareCode,
        role: 'employee',
        approvalStatus: 'pending',
        cvPath,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      sendVerificationEmail(email, verificationToken, firstName).catch((err) =>
        console.error('Failed to send verification email:', err)
      );

      res.status(201).json({
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        approvalStatus: user.approvalStatus,
        token: generateToken(user._id.toString()),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   POST /api/auth/register/cafe
// @desc    Register café
// @access  Public
router.post(
  '/register/cafe',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('shopName').trim().notEmpty(),
    body('shopAddress').trim().notEmpty(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, firstName, lastName, shopName, shopAddress } = req.body;

      const userExists = await User.findOne({ email });
      if (userExists) {
        return res.status(400).json({ message: 'User already exists' });
      }

      const verificationToken = generateVerificationToken();

      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        shopName,
        shopAddress,
        role: 'cafe',
        approvalStatus: 'pending',
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      sendVerificationEmail(email, verificationToken, firstName).catch((err) =>
        console.error('Failed to send verification email:', err)
      );

      res.status(201).json({
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        shopName: user.shopName,
        role: user.role,
        approvalStatus: user.approvalStatus,
        token: generateToken(user._id.toString()),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await User.findOne({ email });
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const emailVerified = (user as any).emailVerified !== false; // Existing users without field = verified
      if (
        (user.role === 'employee' || user.role === 'cafe') &&
        process.env.VERIFY_EMAIL_REQUIRED === 'true' &&
        !emailVerified
      ) {
        return res.status(403).json({
          message: 'Please verify your email before logging in. Check your inbox for the verification link.',
        });
      }

      res.json({
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        approvalStatus: user.approvalStatus,
        token: generateToken(user._id.toString()),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/auth/verify-email
// @desc    Verify email with token
// @access  Public
router.get('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'Invalid verification token' });
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification link' });
    }

    (user as any).emailVerified = true;
    (user as any).emailVerificationToken = undefined;
    (user as any).emailVerificationExpires = undefined;
    await user.save();

    res.json({
      message: 'Email verified successfully. You can now log in.',
      token: generateToken(user._id.toString()),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?._id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    const u = user as any;
    if (u.paymentDetails?.accountName) {
      u.paymentDetails = maskPaymentDetails(u.paymentDetails);
    }
    res.json(u);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
