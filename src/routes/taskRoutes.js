// src/routes/taskRoutes.js
const express = require('express');
const router = express.Router();
const { 
  createTask, 
  getMyTasks, 
  updateTaskStatus, 
  verifyTask 
} = require('../controllers/taskController');
const { protect, authorize } = require('../middleware/auth');

router.route('/')
  .post(protect, authorize('supervisor', 'admin'), createTask);

router.get('/my-tasks', protect, getMyTasks);
router.put('/:id/status', protect, updateTaskStatus);
router.put('/:id/verify', protect, authorize('supervisor', 'admin'), verifyTask);

module.exports = router;