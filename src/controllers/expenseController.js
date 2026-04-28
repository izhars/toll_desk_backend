const Expense = require('../models/Expense');
const AppError = require('../utils/AppError');
const { deleteFromCloudinary } = require('../middleware/upload');

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'amount', 'category', 'notes', 'expenseDate'];

// ─── Private Helpers ──────────────────────────────────────────────────────────

const buildReceiptPayload = (file) => ({
  url: file.path,
  publicId: file.public_id,
  uploadedAt: new Date(),
});

const safeDeleteFromCloudinary = async (publicId) => {
  try {
    await deleteFromCloudinary(publicId);
  } catch {
    // deletion failure must never block the main flow
  }
};

const buildExpenseFilter = async (query, user) => {
  const { status, category, startDate, endDate, minAmount, maxAmount } = query;
  const filter = {};

  if (status)   filter.status   = status.trim().toLowerCase();
  if (category) filter.category = category.trim().toLowerCase();

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate)   filter.date.$lte = new Date(endDate);
  }

  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }

  if (user.role === 'employee') {
    filter.submittedBy = user._id;
  } else if (user.role === 'supervisor') {
    const subordinates = await user.getAllSubordinates();
    filter.submittedBy = { $in: [user._id, ...subordinates.map((u) => u._id)] };
  }
  // admin: no scoping — sees everything

  return filter;
};

// ─── Controllers ──────────────────────────────────────────────────────────────

// 1️⃣ Create Expense
exports.createExpense = async (req, res, next) => {
  try {
    const expenseData = {
      ...req.body,
      submittedBy: req.user._id,
      department: req.user.department || 'general',
    };

    if (req.file) expenseData.receipt = buildReceiptPayload(req.file);

    const expense = await Expense.create(expenseData);
    res.status(201).json({ status: 'success', data: { expense } });
  } catch (err) {
    next(err);
  }
};

// 2️⃣ Get All Expenses
exports.getAllExpenses = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const filter = await buildExpenseFilter(req.query, req.user);

    const expenses = await Expense.find(filter)
      .sort('-date')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.status(200).json({ status: 'success', results: expenses.length, data: { expenses } });
  } catch (err) {
    next(err);
  }
};

// 3️⃣ Get Single Expense
exports.getExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return next(new AppError('Expense not found', 404));

    if (req.user.role === 'employee' && !expense.submittedBy._id.equals(req.user._id)) {
      return next(new AppError('Not authorized to view this expense', 403));
    }

    res.status(200).json({ status: 'success', data: { expense } });
  } catch (err) {
    next(err);
  }
};


// New method for getting expenses with filters
exports.getDateExpense = async (req, res, next) => {
  try {
    // Build filter object
    const filter = {};
    
    // Date filtering
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      
      if (req.query.startDate) {
        filter.date.$gte = new Date(req.query.startDate);
      }
      
      if (req.query.endDate) {
        // Add one day to include the end date fully
        const endDate = new Date(req.query.endDate);
        endDate.setDate(endDate.getDate() + 1);
        filter.date.$lt = endDate;
      }
    }

    // Add role-based filtering
    if (req.user.role === 'employee') {
      filter.submittedBy = req.user._id;
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Execute query
    const expenses = await Expense.find(filter)
      .populate('submittedBy', 'name email')
      .sort('-date')
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await Expense.countDocuments(filter);

    res.status(200).json({
      status: 'success',
      results: expenses.length,
      data: {
        expenses,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// 4️⃣ Update Expense
exports.updateExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return next(new AppError('Expense not found', 404));

    const isOwner = expense.submittedBy._id.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to update this expense', 403));
    }

    if (expense.status !== 'pending' && req.user.role !== 'admin') {
      return next(new AppError('Cannot update an approved or rejected expense', 403));
    }

    if (req.file) {
      if (expense.receipt?.publicId) await safeDeleteFromCloudinary(expense.receipt.publicId);
      expense.receipt = buildReceiptPayload(req.file);
    }

    ALLOWED_UPDATE_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) expense[field] = req.body[field];
    });

    await expense.save();
    res.status(200).json({ status: 'success', data: { expense } });
  } catch (err) {
    next(err);
  }
};

// 5️⃣ Delete Expense
exports.deleteExpense = async (req, res, next) => {
  try {
    // Find the expense by ID
    const expense = await Expense.findById(req.params.id);
    if (!expense) return next(new AppError('Expense not found', 404));

    const isOwner = expense.submittedBy._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    // Check authorization
    if (!isOwner && !isAdmin) {
      return next(new AppError('Not authorized to delete this expense', 403));
    }

    // Normal users can only delete pending expenses
    if (isOwner && expense.status !== 'pending') {
      return next(new AppError('Cannot delete a processed expense', 403));
    }

    // Delete receipt from Cloudinary if it exists
    if (expense.receipt?.publicId) {
      await safeDeleteFromCloudinary(expense.receipt.publicId);
    }

    // Delete the expense
    await Expense.findByIdAndDelete(req.params.id);

    res.status(204).json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
};

// 6️⃣ Approve / Reject Expense
exports.processExpense = async (req, res, next) => {
  try {
    const { action, rejectionReason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return next(new AppError('Invalid action — must be "approve" or "reject"', 400));
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return next(new AppError('Expense not found', 404));

    if (expense.status !== 'pending') {
      return next(new AppError('Expense has already been processed', 400));
    }

    if (req.user.role === 'supervisor') {
      const subordinates = await req.user.getAllSubordinates();
      const isSubordinate = subordinates.some((u) => u._id.equals(expense.submittedBy._id));
      if (!isSubordinate) return next(new AppError('Not allowed to process this expense', 403));
    }

    expense.status     = action === 'approve' ? 'approved' : 'rejected';
    expense.approvedBy = req.user._id;
    expense.approvedAt = new Date();
    if (action === 'reject' && rejectionReason) expense.rejectionReason = rejectionReason;

    await expense.save();
    res.status(200).json({ status: 'success', data: { expense } });
  } catch (err) {
    next(err);
  }
};