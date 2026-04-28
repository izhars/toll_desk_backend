const mongoose = require('mongoose');

const maintenanceTaskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true
  },
  plazaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TollPlaza',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: ['preventive', 'corrective', 'emergency', 'routine'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  laneNumber: Number,
  equipmentType: String,
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  scheduledDate: Date,
  completionDate: Date,
  notes: String,
  cost: Number,
  partsUsed: [{
    partName: String,
    quantity: Number,
    cost: Number
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('MaintenanceTask', maintenanceTaskSchema);