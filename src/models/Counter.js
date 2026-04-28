const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  value: { 
    type: Number, 
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Add compound index for better performance
counterSchema.index({ name: 1, value: 1 });

module.exports = mongoose.model('Counter', counterSchema);