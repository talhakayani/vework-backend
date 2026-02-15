import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';
import { maskPaymentDetails } from '../utils/maskPaymentDetails';
import { uploadAvatar } from '../utils/uploadAvatar';

const router = express.Router();

function userWithMaskedPayment(user: any): any {
  const u = user && typeof user.toObject === 'function' ? user.toObject() : { ...user };
  if (u.paymentDetails?.accountName) {
    u.paymentDetails = maskPaymentDetails(u.paymentDetails);
  }
  return u;
}

// @route   GET /api/profile
// @desc    Get current user profile (including preferences)
// @access  Private
router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?._id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(userWithMaskedPayment(user));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/profile
// @desc    Update basic profile (firstName, lastName)
// @access  Private
router.put(
  '/',
  protect,
  [body('firstName').optional().trim().notEmpty(), body('lastName').optional().trim().notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { firstName, lastName } = req.body;
      const updates: Record<string, any> = {};
      if (firstName != null) updates.firstName = firstName;
      if (lastName != null) updates.lastName = lastName;
      const user = await User.findByIdAndUpdate(req.user?._id, { $set: updates }, { new: true }).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   POST /api/profile/avatar
// @desc    Upload profile image (multipart/form-data, field: avatar)
// @access  Private
router.post(
  '/avatar',
  protect,
  uploadAvatar.single('avatar'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No image file provided' });
      const relativePath = `uploads/avatars/${req.file.filename}`;
      const user = await User.findByIdAndUpdate(
        req.user?._id,
        { $set: { profileImage: relativePath } },
        { new: true }
      ).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

const formatSortCode = (v: string): string => {
  const d = String(v).replace(/\D/g, '').slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
};

// @route   PUT /api/profile/payment-details
// @desc    Update bank details (UK Sort Code+Account, IBAN, or ACH)
// @access  Private
router.put(
  '/payment-details',
  protect,
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

      let paymentDetails: any = { type, accountName };

      if (type === 'uk_sort_code_account') {
        const sc = String(sortCode || '').replace(/\D/g, '');
        const ac = String(accountNumber || '').replace(/\D/g, '');
        if (sc.length !== 6) return res.status(400).json({ message: 'Sort code must be 6 digits' });
        if (ac.length !== 8) return res.status(400).json({ message: 'Account number must be 8 digits' });
        paymentDetails.sortCode = formatSortCode(sc);
        paymentDetails.accountNumber = ac;
      } else if (type === 'iban') {
        const ibanClean = String(iban || '').replace(/\s/g, '');
        if (ibanClean.length < 15 || ibanClean.length > 34) {
          return res.status(400).json({ message: 'IBAN must be 15–34 characters' });
        }
        if (!/^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]+$/.test(ibanClean)) {
          return res.status(400).json({ message: 'Invalid IBAN format' });
        }
        paymentDetails.iban = ibanClean.toUpperCase();
        if (bicSwift) paymentDetails.bicSwift = String(bicSwift).trim().toUpperCase();
      } else if (type === 'ach') {
        const rte = String(routingNumber || '').replace(/\D/g, '');
        const ach = String(achAccountNumber || '').replace(/\D/g, '');
        if (rte.length !== 9) return res.status(400).json({ message: 'Routing number must be 9 digits' });
        if (ach.length < 4 || ach.length > 17) return res.status(400).json({ message: 'ACH account number must be 4–17 digits' });
        paymentDetails.routingNumber = rte;
        paymentDetails.achAccountNumber = ach;
      }

      const user = await User.findByIdAndUpdate(
        req.user?._id,
        { $set: { paymentDetails } },
        { new: true }
      ).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/profile/notifications
router.put(
  '/notifications',
  protect,
  [
    body('emailShiftReminders').optional().isBoolean(),
    body('emailApplicationUpdates').optional().isBoolean(),
    body('emailInvoices').optional().isBoolean(),
    body('inAppEnabled').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const prefs = req.body;
      const updates: Record<string, boolean> = {};
      if (typeof prefs.emailShiftReminders === 'boolean') updates['notificationPreferences.emailShiftReminders'] = prefs.emailShiftReminders;
      if (typeof prefs.emailApplicationUpdates === 'boolean') updates['notificationPreferences.emailApplicationUpdates'] = prefs.emailApplicationUpdates;
      if (typeof prefs.emailInvoices === 'boolean') updates['notificationPreferences.emailInvoices'] = prefs.emailInvoices;
      if (typeof prefs.inAppEnabled === 'boolean') updates['notificationPreferences.inAppEnabled'] = prefs.inAppEnabled;
      if (Object.keys(updates).length === 0) {
        const user = await User.findById(req.user?._id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        return res.json(userWithMaskedPayment(user));
      }
      const user = await User.findByIdAndUpdate(req.user?._id, { $set: updates }, { new: true }).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/profile/addresses
// @desc    Update cafe business addresses (for shift location dropdown)
// @access  Private (cafe only)
router.put(
  '/addresses',
  protect,
  [
    body('addresses')
      .isArray()
      .withMessage('addresses must be an array'),
    body('addresses.*.address').trim().notEmpty().withMessage('Each address must have an address string'),
    body('addresses.*.latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('addresses.*.longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('addresses.*.placeId').optional().trim(),
    body('addresses.*.label').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Only cafe accounts can update addresses' });
      }
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { addresses } = req.body;
      const normalized = (addresses as any[]).map((a: any) => ({
        address: String(a.address).trim(),
        latitude: parseFloat(a.latitude),
        longitude: parseFloat(a.longitude),
        placeId: a.placeId ? String(a.placeId).trim() : undefined,
        label: a.label ? String(a.label).trim() : undefined,
      }));
      const user = await User.findByIdAndUpdate(
        req.user?._id,
        { $set: { addresses: normalized } },
        { new: true }
      ).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   PUT /api/profile/settings
router.put(
  '/settings',
  protect,
  [
    body('theme').optional().isIn(['light', 'dark', 'system']),
    body('language').optional().trim(),
    body('timezone').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { theme, language, timezone } = req.body;
      const updates: Record<string, any> = {};
      if (theme != null) updates['settings.theme'] = theme;
      if (language != null) updates['settings.language'] = language;
      if (timezone != null) updates['settings.timezone'] = timezone;
      if (Object.keys(updates).length === 0) {
        const user = await User.findById(req.user?._id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        return res.json(userWithMaskedPayment(user));
      }
      const user = await User.findByIdAndUpdate(req.user?._id, { $set: updates }, { new: true }).select('-password');
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json(userWithMaskedPayment(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;
