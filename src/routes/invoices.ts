import express, { Response } from 'express';
import Invoice from '../models/Invoice';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';
import { generateInvoicePDF } from '../utils/generateInvoicePDF';
import { uploadPaymentProof } from '../utils/uploadPaymentProof';

const router = express.Router();

// @route   GET /api/invoices
// @desc    Get invoices (filtered by role). Cafés only see approved/pending_verification/paid.
// @access  Private
router.get('/', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    let query: any = {};

    if (req.user?.role === 'cafe') {
      query.cafe = req.user._id;
      query.status = { $in: ['approved', 'pending_verification', 'paid'] };
    }

    const invoices = await Invoice.find(query)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate({
        path: 'shift',
        populate: {
          path: 'acceptedBy',
          select: 'firstName lastName email',
        },
      })
      .sort({ createdAt: -1 });

    // Sanitize cafe data
    const sanitizedInvoices = invoices.map(invoice => {
      const invoiceObj = invoice.toObject() as unknown as Record<string, unknown>;
      if (invoiceObj.cafe) {
        invoiceObj.cafe = sanitizeUser(invoiceObj.cafe as any);
      }
      return invoiceObj;
    });

    res.json(sanitizedInvoices);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/:id/pdf
// @desc    Download invoice as PDF
// @access  Private
router.get('/:id/pdf', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    // First, get invoice without population to check authorization
    const invoiceCheck = await Invoice.findById(req.params.id);

    if (!invoiceCheck) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Authorization: Cafes can only access their own invoices, admins can access all
    if (req.user?.role === 'cafe') {
      const cafeId = invoiceCheck.cafe.toString();
      if (cafeId !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }
    } else if (req.user?.role !== 'admin') {
      // Only cafes and admins can access invoices
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Now populate for PDF generation
    const invoice = await Invoice.findById(req.params.id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate('shift');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoice.toObject());

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`
    );

    // Send PDF
    res.send(pdfBuffer);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices/:id/submit-proof
// @desc    Submit payment proof (Café only). Only when status is 'approved'.
// @access  Private (Café)
router.post(
  '/:id/submit-proof',
  protect,
  requireApproval,
  uploadPaymentProof.single('paymentProof'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'cafe') {
        return res.status(403).json({ message: 'Not authorized' });
      }
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      if (invoice.cafe.toString() !== req.user!._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }
      if (invoice.status !== 'approved') {
        return res.status(400).json({
          message: 'Payment proof can only be submitted for invoices that are approved and awaiting payment',
        });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Payment proof file is required (image or PDF)' });
      }
      const paymentProofPath = `uploads/payment-proofs/${req.file.filename}`;
      invoice.paymentProof = paymentProofPath;
      invoice.paymentProofSubmittedAt = new Date();
      invoice.paymentProofNotes = typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;
      invoice.status = 'pending_verification';
      await invoice.save();
      const populated = await Invoice.findById(invoice._id)
        .populate('cafe', getSafeUserFields('cafe'))
        .populate({ path: 'shift', populate: { path: 'acceptedBy', select: 'firstName lastName email' } });
      res.json(populated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

// @route   GET /api/invoices/:id
// @desc    Get single invoice
// @access  Private
router.get('/:id', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    // First, get invoice without population to check authorization
    const invoiceCheck = await Invoice.findById(req.params.id);

    if (!invoiceCheck) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Authorization: Cafes can only access their own invoices, admins can access all
    if (req.user?.role === 'cafe') {
      const cafeId = invoiceCheck.cafe.toString();
      if (cafeId !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized' });
      }
    } else if (req.user?.role !== 'admin') {
      // Only cafes and admins can access invoices
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Now populate for response
    const invoice = await Invoice.findById(req.params.id)
      .populate('cafe', getSafeUserFields('cafe'))
      .populate({
        path: 'shift',
        populate: {
          path: 'acceptedBy',
          select: 'firstName lastName email',
        },
      });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Sanitize cafe data
    const invoiceObj = invoice.toObject() as unknown as Record<string, unknown>;
    if (invoiceObj.cafe) {
      invoiceObj.cafe = sanitizeUser(invoiceObj.cafe as any);
    }

    res.json(invoiceObj);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
