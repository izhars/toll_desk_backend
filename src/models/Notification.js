// models/Notification.js
const mongoose = require('mongoose');
const { NOTIFICATION_TYPES, USER_ROLES } = require('../utils/constants');

const notificationSchema = new mongoose.Schema({
  recipient: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true
    }
  },
  type: {
    type: String,
    enum: Object.values(NOTIFICATION_TYPES),
    required: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  data: {
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    reportTitle: String,
    reportNumber: String,
    plazaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plaza' },
    status: String,
    previousStatus: String,
    priority: String,
    issueType: String,
    assignedBy: String,
    assignedTo: String,
    updatedBy: String,
    closedBy: String,
    satisfaction: String,
    reason: String,
    comment: String,
    // Additional dynamic data
    additionalData: mongoose.Schema.Types.Mixed
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(+new Date() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
});

// Indexes for efficient queries
notificationSchema.index({ 'recipient.userId': 1, createdAt: -1 });
notificationSchema.index({ 'recipient.userId': 1, isRead: 1 });
notificationSchema.index({ 'recipient.userId': 1, type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ✅ REMOVE the unique index that was causing issues
// Only keep this for status updates and assignments (not comments)
// notificationSchema.index(
//   { 'recipient.userId': 1, 'data.reportId': 1, type: 1 },
//   { unique: true, partialFilterExpression: { isArchived: false } }
// );

// ✅ Alternative: Add a non-unique index for better query performance
notificationSchema.index({ 'recipient.userId': 1, 'data.reportId': 1, type: 1 });

// Virtual for time ago
notificationSchema.virtual('timeAgo').get(function () {
  const now = new Date();
  const diff = Math.floor((now - this.createdAt) / 1000);

  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return `${Math.floor(diff / 604800)} weeks ago`;
});

notificationSchema.set('toJSON', { virtuals: true });
notificationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Notification', notificationSchema);