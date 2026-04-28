const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const {
  createExpense,
  getAllExpenses,
  getExpense,
  getDateExpense,
  updateExpense,
  deleteExpense,
  processExpense,
} = require('../controllers/expenseController');

// All routes require a valid JWT
router.use(protect);

router
  .route('/')
  .post(upload.single('receipt'), createExpense)
  .get(getAllExpenses);

router.get('/all', getDateExpense);

router
  .route('/:id')
  .get(getExpense)
  .patch(upload.single('receipt'), updateExpense)
  .delete(deleteExpense);

// Supervisors and admins only
router.patch('/:id/process', authorize('supervisor', 'admin'), processExpense);

module.exports = router;