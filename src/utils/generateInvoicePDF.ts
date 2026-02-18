import PDFDocument from 'pdfkit';
import { IInvoice } from '../models/Invoice';
import { formatDuration } from './formatDuration';

export function generateInvoicePDF(invoice: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);

    // Header
    doc.fontSize(24).text('INVOICE', { align: 'right' });
    doc.moveDown();
    
    // Invoice Number
    doc.fontSize(12).text(`Invoice Number: ${invoice.invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-GB')}`, { align: 'right' });
    doc.moveDown(2);

    // Cafe Information
    const cafe = invoice.cafe;
    if (cafe && typeof cafe === 'object') {
      doc.fontSize(14).text('Bill To:', { underline: true });
      doc.fontSize(10);
      if (cafe.shopName) doc.text(cafe.shopName);
      if (cafe.name) doc.text(cafe.name);
      if (cafe.email) doc.text(cafe.email);
      if (cafe.shopAddress) doc.text(cafe.shopAddress);
      doc.moveDown(2);
    }

    // Shift Details
    doc.fontSize(14).text('Shift Details:', { underline: true });
    doc.fontSize(10);
    doc.text(`Date: ${new Date(invoice.shiftDetails.date).toLocaleDateString('en-GB', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}`);
    doc.text(`Time: ${invoice.shiftDetails.startTime} - ${invoice.shiftDetails.endTime}`);
    doc.text(`Duration: ${formatDuration(invoice.shiftDetails.hours)}`);
    doc.text(`Employees: ${invoice.shiftDetails.employees}`);
    doc.moveDown(2);

    // Line Items Table
    const tableTop = doc.y;
    const itemHeight = 20;
    let currentY = tableTop;

    // Table Header
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Description', 50, currentY);
    doc.text('Amount', 450, currentY, { align: 'right', width: 100 });
    currentY += itemHeight;

    // Draw line
    doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
    currentY += 5;

    // Table Rows
    doc.font('Helvetica');
    doc.text('Base Amount', 50, currentY);
    doc.text(`£${invoice.baseAmount.toFixed(2)}`, 450, currentY, { align: 'right', width: 100 });
    currentY += itemHeight;

    if (invoice.platformFee > 0) {
      doc.text('Platform Fee', 50, currentY);
      doc.text(`£${invoice.platformFee.toFixed(2)}`, 450, currentY, { align: 'right', width: 100 });
      currentY += itemHeight;
    }

    if (invoice.penaltyAmount > 0) {
      doc.text('Penalty', 50, currentY);
      doc.text(`£${invoice.penaltyAmount.toFixed(2)}`, 450, currentY, { align: 'right', width: 100 });
      currentY += itemHeight;
    }

    // Total
    currentY += 10;
    doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
    currentY += 10;
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Total Amount', 50, currentY);
    doc.text(`£${invoice.totalAmount.toFixed(2)}`, 450, currentY, { align: 'right', width: 100 });

    // Status
    doc.moveDown(3);
    doc.fontSize(10).font('Helvetica');
    const statusLabels: Record<string, string> = {
      draft: 'DRAFT',
      approved: 'APPROVED (Awaiting payment)',
      pending_verification: 'PENDING VERIFICATION',
      paid: 'PAID',
    };
    const statusText = statusLabels[invoice.status] || invoice.status?.toUpperCase() || 'PENDING';
    const statusColor = invoice.status === 'paid' ? 'green' : invoice.status === 'draft' ? 'gray' : 'orange';
    doc.fillColor(statusColor).text(`Status: ${statusText}`, { align: 'right' });
    doc.fillColor('black');

    if (invoice.paidAt) {
      doc.text(`Paid on: ${new Date(invoice.paidAt).toLocaleDateString('en-GB')}`, { align: 'right' });
    }

    // Footer
    doc.fontSize(8).fillColor('gray');
    const pageHeight = doc.page.height;
    const pageWidth = doc.page.width;
    doc.text(
      'This is an automatically generated invoice. Please keep this for your records.',
      50,
      pageHeight - 50,
      { align: 'center', width: pageWidth - 100 }
    );

    doc.end();
  });
}
