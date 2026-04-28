// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

// ==================== USER ROUTES (Authenticated users) ====================

// Get user's notifications (with pagination and filtering)
router.get('/notifications', protect, notificationController.getUserNotifications);

// Get unread notification count
router.get('/notifications/unread/count', protect, notificationController.getUnreadCount);

// Get single notification by ID
router.get('/notifications/:id', protect, notificationController.getNotificationById);

// Mark notification as read
router.put('/notifications/:id/read', protect, notificationController.markAsRead);

// Mark all notifications as read
router.put('/notifications/read-all', protect, notificationController.markAllAsRead);

// Delete notification
router.delete('/notifications/:id', protect, notificationController.deleteNotification);

// Bulk delete notifications
router.post('/notifications/bulk-delete', protect, notificationController.bulkDeleteNotifications);

// ==================== FCM TOKEN ROUTES ====================

// Register FCM token for push notifications
router.post('/fcm/register', protect, notificationController.registerFCMToken);

// Remove FCM token
router.post('/fcm/remove', protect, notificationController.removeFCMToken);

// ==================== ADMIN ONLY ROUTES ====================

// Get all notifications (admin view with filters)
router.get(
  '/admin/notifications',
  protect,
  authorize(USER_ROLES.ADMIN),
  notificationController.getAllNotifications
);

// Get notification statistics
router.get(
  '/admin/stats',
  protect,
  authorize(USER_ROLES.ADMIN),
  notificationController.getNotificationStats
);

// Send custom notification to specific users
router.post(
  '/admin/send-custom',
  protect,
  authorize(USER_ROLES.ADMIN),
  notificationController.sendCustomNotification
);

// Broadcast notification to all users or specific roles
router.post(
  '/admin/broadcast',
  protect,
  authorize(USER_ROLES.ADMIN),
  notificationController.broadcastNotification
);

// Archive old notifications
router.post(
  '/admin/archive',
  protect,
  authorize(USER_ROLES.ADMIN),
  notificationController.archiveOldNotifications
);

// ==================== SUPERVISOR ROUTES ====================

// Send notification to team members (supervisor only)
router.post(
  '/supervisor/send-to-team',
  protect,
  authorize(USER_ROLES.SUPERVISOR),
  async (req, res) => {
    try {
      const { title, body, type, data = {} } = req.body;
      const { id: supervisorId, role } = req.user;
      
      if (!title || !body) {
        return res.status(400).json({
          success: false,
          error: 'title and body are required'
        });
      }
      
      // Get team members (users under this supervisor)
      const teamMembers = await User.find({
        supervisorId: supervisorId,
        isActive: true
      }).select('_id role');
      
      const userIds = teamMembers.map(member => member._id);
      
      if (userIds.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No team members found'
        });
      }
      
      const notification = { title, body };
      const notificationData = { ...data, type: type || 'team_notification' };
      
      const result = await NotificationService.sendCombinedToMultipleUsers(
        userIds,
        notification,
        notificationData
      );
      
      res.json({
        success: true,
        data: result,
        message: `Notification sent to ${userIds.length} team members`
      });
    } catch (error) {
      console.error('Error sending team notification:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
);

// Get team notifications (supervisor viewing team's notifications)
router.get(
  '/supervisor/team-notifications',
  protect,
  authorize(USER_ROLES.SUPERVISOR),
  async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const { id: supervisorId } = req.user;
      
      // Get team members
      const teamMembers = await User.find({
        supervisorId: supervisorId,
        isActive: true
      }).select('_id');
      
      const memberIds = teamMembers.map(member => member._id);
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [notifications, total] = await Promise.all([
        InAppNotification.find({
          'recipient.userId': { $in: memberIds },
          isArchived: false
        })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('recipient.userId', 'name email role')
          .lean(),
        InAppNotification.countDocuments({
          'recipient.userId': { $in: memberIds },
          isArchived: false
        })
      ]);
      
      res.json({
        success: true,
        data: {
          notifications,
          total,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching team notifications:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
);

module.exports = router;