import express, { Response } from 'express';
import Invoice from '../models/Invoice';
import Shift from '../models/Shift';
import { protect, requireApproval, AuthRequest } from '../middleware/auth';
import { getHoursFromShift } from '../utils/calculateShiftCost';
import { getSafeUserFields, sanitizeUser } from '../utils/sanitizeUser';
import { generateInvoicePDF } from '../utils/generateInvoicePDF';

const router = express.Router();

// @route   GET /api/invoices
// @desc    Get invoices (filtered by role)
// @access  Private
router.get('/', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    let query: any = {};

    if (req.user?.role === 'cafe') {
      query.cafe = req.user._id;
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

// @route   POST /api/invoices/generate/:shiftId
// @desc    Generate invoice for shift
// @access  Private (Café or Admin)
router.post('/generate/:shiftId', protect, requireApproval, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'cafe' && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    if (req.user?.role === 'cafe' && shift.cafe.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Check if invoice already exists
    const existingInvoice = await Invoice.findOne({ shift: shift._id });
    if (existingInvoice) {
      return res.status(400).json({ message: 'Invoice already exists', invoice: existingInvoice });
    }

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
        employees: shift.acceptedBy.length,
      },
      baseAmount: shift.baseHourlyRate * hours * shift.acceptedBy.length,
      platformFee: shift.platformFee,
      penaltyAmount: shift.penaltyAmount || 0,
      totalAmount: shift.totalCost + (shift.penaltyAmount || 0),
      status: 'pending',
    });

    res.status(201).json(invoice);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

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
