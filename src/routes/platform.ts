import express, { Response, Request } from 'express';
import PlatformConfig from '../models/PlatformConfig';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';

const router = express.Router();

// @route   GET /api/platform/company-details
// @desc    Get company details for Terms, Privacy, and contact (public)
// @access  Public
router.get('/company-details', async (_req: Request, res: Response) => {
  try {
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    res.json({
      companyName: config?.companyName ?? 'Vework Ltd',
      companyNumber: config?.companyNumber ?? '16994650',
      registeredAddress: config?.registeredAddress ?? '4 Third Avenue, London, E12 6DU',
      supportEmail: config?.supportEmail ?? 'support@vework.co',
      supportPhone: config?.supportPhone ?? '+447777182292',
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/platform/bank-details
// @desc    Get platform bank details for payment (e.g. when creating shift)
// @access  Private (Café)
router.get('/bank-details', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can access platform bank details' });
    }
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    const bankDetails = config?.bankDetails ?? null;
    if (!bankDetails || !bankDetails.accountName) {
      return res.status(404).json({
        message: 'Platform bank details are not configured yet. Please contact admin.',
      });
    }
    res.json({ bankDetails });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/platform/config
// @desc    Get platform configuration (for employees to see price deduction percentage)
// @access  Private
router.get('/config', protect, async (req: AuthRequest, res: Response) => {
  try {
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    res.json({
      employeePriceDeductionPercentage: config?.employeePriceDeductionPercentage ?? 25,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/platform/shift-pricing
// @desc    Get shift pricing tiers and minimum hours (for create-shift form validation & live price)
// @access  Private (Café only)
router.get('/shift-pricing', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe') {
      return res.status(403).json({ message: 'Only cafés can access shift pricing' });
    }
    const config = await PlatformConfig.findOne({ key: 'platform' }).lean();
    res.json({
      minimumHoursBeforeShift: config?.minimumHoursBeforeShift ?? 3,
      basePriceTier3to12: config?.basePriceTier3to12 ?? 17,
      basePriceTier12to24: config?.basePriceTier12to24 ?? 16,
      basePriceTier24Plus: config?.basePriceTier24Plus ?? 14,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
