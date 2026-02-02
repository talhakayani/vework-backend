import express, { Response } from 'express';
import PlatformConfig from '../models/PlatformConfig';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';

const router = express.Router();

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

export default router;
