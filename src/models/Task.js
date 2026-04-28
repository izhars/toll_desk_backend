// src/models/Task.js
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    unique: true,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  report: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MaintenanceReport'
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'verified'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  dueDate: Date,
  completedDate: Date,
  checklist: [{
    item: String,
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: Date
  }],
  beforePhotos: [String],
  afterPhotos: [String],
  notes: String,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Task', taskSchema);