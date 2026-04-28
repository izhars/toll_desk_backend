const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Expense title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500]
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR', 'GBP']
  },
  category: {
    type: String,
    enum: [
      'travel', 'food', 'accommodation', 'equipment', 'training',
      'office_supplies', 'maintenance', 'utilities', 'other'
    ],
    required: [true, 'Category is required']
  },
  date: {
    type: Date,
    required: [true, 'Expense date is required'],
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'reimbursed'],
    default: 'pending'
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  department: {
    type: String,
    enum: ['management', 'maintenance', 'electrical', 'plumbing', 'hvac', 'general']
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  // Receipt / Attachment via Cloudinary
  receipt: {
    url: String,
    publicId: String,
    uploadedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-populate submittedBy & approvedBy when needed
expenseSchema.pre(/^find/, function(next) {
  this.populate([
    { path: 'submittedBy', select: 'name email role department profileImage' },
    { path: 'approvedBy', select: 'name email role' }
  ]);
  next();
});

const Expense = mongoose.model('Expense', expenseSchema);
module.exports = Expense;