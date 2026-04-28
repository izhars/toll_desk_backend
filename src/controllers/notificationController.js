// controllers/notificationController.js
const NotificationService = require('../services/notificationService');
const InAppNotification = require('../models/Notification');
const User = require('../models/User');
const Plaza = require('../models/TollPlaza');
const NotificationTransformer = require('../utils/transformNotification');

class NotificationController {
  
  async getUserNotifications(req, res) {
    try {
      const { page = 1, limit = 20, filter = 'all' } = req.query;
      
      const result = await NotificationService.getUserNotifications(
        req.user.id,
        parseInt(page),
        parseInt(limit),
        filter
      );
      
      // Use the transformer (with caching and batch queries)
      const transformedNotifications = await NotificationTransformer.transformMany(
        result.notifications || []
      );
      
      res.json({
        success: true,
        data: {
          ...result,
          notifications: transformedNotifications
        }
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Get unread notification count
  async getUnreadCount(req, res) {
    try {
      const count = await NotificationService.getUnreadNotificationCount(req.user.id);
      
      res.json({
        success: true,
        data: { unreadCount: count }
      });
    } catch (error) {
      console.error('Error getting unread count:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Mark a single notification as read
  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      const notification = await NotificationService.markAsRead(id, req.user.id);
      
      if (!notification) {
        return res.status(404).json({ 
          success: false, 
          error: 'Notification not found' 
        });
      }
      
      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      const result = await NotificationService.markAllAsRead(req.user.id);
      
      res.json({
        success: true,
        data: result,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Error marking all as read:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Delete (archive) a notification
  async deleteNotification(req, res) {
    try {
      const { id } = req.params;
      const notification = await NotificationService.deleteNotification(id, req.user.id);
      
      if (!notification) {
        return res.status(404).json({ 
          success: false, 
          error: 'Notification not found' 
        });
      }
      
      res.json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Bulk delete notifications
  async bulkDeleteNotifications(req, res) {
    try {
      const { notificationIds } = req.body;
      
      if (!notificationIds || !Array.isArray(notificationIds)) {
        return res.status(400).json({
          success: false,
          error: 'notificationIds array is required'
        });
      }
      
      const result = await InAppNotification.updateMany(
        {
          _id: { $in: notificationIds },
          'recipient.userId': req.user.id
        },
        { isArchived: true }
      );
      
      const unreadCount = await NotificationService.getUnreadNotificationCount(req.user.id);
      
      if (global.io) {
        global.io.to(`user_${req.user.id}`).emit('unread_count', unreadCount);
      }
      
      res.json({
        success: true,
        data: result,
        message: `${result.modifiedCount} notifications deleted successfully`
      });
    } catch (error) {
      console.error('Error bulk deleting notifications:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Get notification by ID
  async getNotificationById(req, res) {
    try {
      const { id } = req.params;
      const notification = await InAppNotification.findOne({
        _id: id,
        'recipient.userId': req.user.id,
        isArchived: false
      });
      
      if (!notification) {
        return res.status(404).json({ 
          success: false, 
          error: 'Notification not found' 
        });
      }
      
      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error fetching notification:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Register FCM token
  async registerFCMToken(req, res) {
    try {
      const { token, deviceInfo } = req.body;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'FCM token is required'
        });
      }
      
      await NotificationService.registerToken(req.user.id, token, deviceInfo || {});
      
      res.json({
        success: true,
        message: 'FCM token registered successfully'
      });
    } catch (error) {
      console.error('Error registering FCM token:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Remove FCM token
  async removeFCMToken(req, res) {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'FCM token is required'
        });
      }
      
      await NotificationService.removeToken(req.user.id, token);
      
      res.json({
        success: true,
        message: 'FCM token removed successfully'
      });
    } catch (error) {
      console.error('Error removing FCM token:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Send custom notification (Admin only)
  async sendCustomNotification(req, res) {
    try {
      const { userIds, title, body, type, data = {} } = req.body;
      
      if (!userIds || !userIds.length) {
        return res.status(400).json({
          success: false,
          error: 'userIds array is required'
        });
      }
      
      if (!title || !body) {
        return res.status(400).json({
          success: false,
          error: 'title and body are required'
        });
      }
      
      const notification = { title, body };
      const notificationData = { ...data, type: type || 'custom' };
      
      const result = await NotificationService.sendCombinedToMultipleUsers(
        userIds,
        notification,
        notificationData
      );
      
      res.json({
        success: true,
        data: result,
        message: `Notification sent to ${userIds.length} users`
      });
    } catch (error) {
      console.error('Error sending custom notification:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==================== ADMIN METHODS ====================

  // Get all notifications (admin view)
  async getAllNotifications(req, res) {
    try {
      const { page = 1, limit = 50, userId, type, role, isRead } = req.query;
      
      const filters = {};
      if (userId) filters.userId = userId;
      if (type) filters.type = type;
      if (role) filters.role = role;
      if (isRead !== undefined) filters.isRead = isRead === 'true';
      
      const result = await NotificationService.getAdminNotifications(
        filters,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error fetching all notifications:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Get notification statistics
  async getNotificationStats(req, res) {
    try {
      const stats = await InAppNotification.aggregate([
        {
          $facet: {
            totalByType: [
              { $group: { _id: '$type', count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ],
            totalByRole: [
              { $group: { _id: '$recipient.role', count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ],
            readVsUnread: [
              { $group: { _id: '$isRead', count: { $sum: 1 } } }
            ],
            last7Days: [
              {
                $match: {
                  createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                }
              },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                  count: { $sum: 1 }
                }
              },
              { $sort: { _id: 1 } }
            ]
          }
        }
      ]);
      
      res.json({
        success: true,
        data: stats[0]
      });
    } catch (error) {
      console.error('Error getting notification stats:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Archive old notifications
  async archiveOldNotifications(req, res) {
    try {
      const { daysOld = 30 } = req.body;
      const result = await NotificationService.archiveOldNotifications(daysOld);
      
      res.json({
        success: true,
        data: result,
        message: `Archived ${result.modifiedCount} notifications older than ${daysOld} days`
      });
    } catch (error) {
      console.error('Error archiving notifications:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // Broadcast notification to all users (admin only)
  async broadcastNotification(req, res) {
    try {
      const { title, body, type, roles, data = {} } = req.body;
      
      if (!title || !body) {
        return res.status(400).json({
          success: false,
          error: 'title and body are required'
        });
      }
      
      const userQuery = { isActive: true };
      if (roles && roles.length) {
        userQuery.role = { $in: roles };
      }
      
      const users = await User.find(userQuery).select('_id role');
      
      const notification = { title, body };
      const notificationData = { ...data, type: type || 'broadcast' };
      
      const results = [];
      for (const user of users) {
        const result = await NotificationService.sendCombinedNotification(
          user._id,
          user.role,
          notification,
          notificationData
        );
        results.push(result);
      }
      
      res.json({
        success: true,
        data: { totalUsers: users.length, results },
        message: `Broadcast sent to ${users.length} users`
      });
    } catch (error) {
      console.error('Error broadcasting notification:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
}

module.exports = new NotificationController();