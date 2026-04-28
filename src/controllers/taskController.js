// src/controllers/taskController.js
const Task = require('../models/Task');

// @desc    Create task from report
// @route   POST /api/tasks
exports.createTask = async (req, res) => {
  try {
    const taskId = 'TSK-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    
    const task = await Task.create({
      ...req.body,
      taskId,
      assignedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get assigned tasks
// @route   GET /api/tasks/my-tasks
exports.getMyTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ assignedTo: req.user.id })
      .populate('assignedBy', 'name email')
      .populate('report')
      .sort('-createdAt');

    res.json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update task status
// @route   PUT /api/tasks/:id/status
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status, notes, afterPhotos } = req.body;
    
    const updateData = {
      status,
      notes
    };

    if (afterPhotos) {
      updateData.afterPhotos = afterPhotos;
    }

    if (status === 'completed') {
      updateData.completedDate = Date.now();
    }

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify task completion (Supervisor/Manager)
// @route   PUT /api/tasks/:id/verify
exports.verifyTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      {
        status: 'verified',
        verifiedBy: req.user.id,
        verifiedAt: Date.now()
      },
      { new: true }
    );

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


