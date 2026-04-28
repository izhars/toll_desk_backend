// services/NotificationService.js
const admin = require('firebase-admin');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { NOTIFICATION_TYPES, USER_ROLES, REPORT_STATUS } = require('../utils/constants');

let firebaseApp;

try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase initialized from env variable');
    } else {
      try {
        const serviceAccount = require('../config/google-credentials.json');
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase initialized from config file');
      } catch (fileError) {
        console.error('Could not load service account file:', fileError.message);
      }
    }
  }
} catch (error) {
  console.error('Firebase initialization error:', error);
}

class NotificationService {

  // ==================== FCM PUSH NOTIFICATION METHODS ====================

  async sendToUser(userId, notification, data = {}) {
    try {
      console.log('🔔 sendToUser called');
      console.log('👤 Target userId:', userId);

      const userLean = await User.findById(userId).select('fcmTokens').lean();

      if (!userLean) {
        console.log(`❌ User not found: ${userId}`);
        return;
      }

      const activeTokens = (userLean.fcmTokens || [])
        .filter(t => t.isActive && t.token)
        .map(t => t.token);

      if (activeTokens.length === 0) {
        console.log(`⚠️ No FCM tokens found for user ${userId}`);
        return;
      }

      console.log(`📱 Found ${activeTokens.length} active FCM tokens`);

      const stringifiedData = Object.fromEntries(
        Object.entries({
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: data.type || 'maintenance_update'
        })
          .map(([k, v]) => [k, String(v)])
      );

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: stringifiedData,
        tokens: activeTokens
      };

      console.log('📤 Sending FCM notification...');
      const response = await admin.messaging().sendEachForMulticast(message);

      console.log('📊 FCM Response:', {
        successCount: response.successCount,
        failureCount: response.failureCount
      });

      if (response.failureCount > 0) {
        const invalidTokenErrors = [
          'registration-token-not-registered',
          'invalid-registration-token',
          'invalid-argument',
          'mismatched-credential',
          'unregistered'
        ];

        const failedTokens = response.responses
          .map((resp, idx) => {
            if (!resp.success) {
              const isInvalidToken = invalidTokenErrors.some(e =>
                resp.error?.code?.includes(e) ||
                resp.error?.message?.toLowerCase().includes(e)
              );
              return isInvalidToken ? activeTokens[idx] : null;
            }
            return null;
          })
          .filter(Boolean);

        if (failedTokens.length > 0) {
          console.log('🧹 Removing invalid tokens:', failedTokens);
          const userDoc = await User.findById(userId);
          userDoc.fcmTokens = userDoc.fcmTokens.filter(
            t => !failedTokens.includes(t.token)
          );
          await userDoc.save();
          console.log('✅ Invalid tokens removed from DB');
        }
      }

      console.log(`✅ Notification sent successfully to user ${userId}`);
      return response;

    } catch (error) {
      console.error('🔥 Error sending notification to user:', error.message);
      console.error(error);
    }
  }

  async sendToMultipleUsers(userIds, notification, data = {}) {
    try {
      const users = await User.find({
        _id: { $in: userIds },
        fcmTokens: { $exists: true, $ne: [] }
      }).select('fcmTokens');

      const allTokens = users.reduce((tokens, user) => {
        return tokens.concat(user.fcmTokens || []);
      }, []);

      if (allTokens.length === 0) {
        console.log('No valid FCM tokens found');
        return;
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: data.type || 'maintenance_update'
        },
        tokens: allTokens
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`Notification sent to ${response.successCount} devices`);
      return response;
    } catch (error) {
      console.error('Error sending notifications to multiple users:', error);
    }
  }

  async sendHighPriorityPush(userId, notification, data = {}) {
    try {
      const user = await User.findById(userId).select('fcmTokens').lean();
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) return;

      const activeTokens = user.fcmTokens
        .filter(t => t.isActive && t.token)
        .map(t => t.token);

      if (activeTokens.length === 0) return;

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: data.type || 'critical_alert'
        },
        tokens: activeTokens,
        android: {
          priority: 'high'
        },
        apns: {
          headers: {
            'apns-priority': '10'
          }
        }
      };

      return await admin.messaging().sendEachForMulticast(message);
    } catch (error) {
      console.error('Error sending high priority push:', error);
    }
  }

  // ==================== IN-APP NOTIFICATION METHODS ====================


  async checkExistingNotification(recipientId, reportId, type) {
    try {
      const existing = await Notification.findOne({
        'recipient.userId': recipientId,
        'data.reportId': reportId,
        type: type,
        isArchived: false,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours only
      });
      return existing;
    } catch (error) {
      console.error('Error checking existing notification:', error);
      return null;
    }
  }

  async storeInAppNotification(recipientId, recipientRole, notificationData) {
    try {
      const cleanedData = {};
      if (notificationData.data) {
        Object.keys(notificationData.data).forEach(key => {
          const value = notificationData.data[key];
          if (value && typeof value === 'object' && value._id) {
            cleanedData[key] = value._id;
          } else {
            cleanedData[key] = value;
          }
        });
      }

      // ✅ CRITICAL FIX: Use the exact same fields as the unique index
      const filter = {
        'recipient.userId': recipientId,
        'data.reportId': cleanedData.reportId,
        type: notificationData.type,
        isArchived: false
      };

      // ✅ Only check for existing notification within the last 24 hours
      // Remove the createdAt check from filter and handle it separately
      const existingNotification = await Notification.findOne(filter);

      if (existingNotification) {
        // Update existing notification instead of creating new one
        console.log(`📝 Updating existing notification for user ${recipientId}, report ${cleanedData.reportId}`);

        const updateData = {
          $set: {
            title: notificationData.title,
            body: notificationData.body,
            'data.status': cleanedData.status,
            'data.previousStatus': cleanedData.previousStatus,
            'data.reportTitle': cleanedData.reportTitle,
            'data.reportNumber': cleanedData.reportNumber,
            'data.plazaId': cleanedData.plazaId,
            'data.priority': cleanedData.priority,
            'data.issueType': cleanedData.issueType,
            'data.assignedBy': cleanedData.assignedBy,
            'data.assignedTo': cleanedData.assignedTo,
            'data.updatedBy': cleanedData.updatedBy,
            'data.type': cleanedData.type,
            updatedAt: new Date()
          },
          $setOnInsert: {
            recipient: {
              userId: recipientId,
              role: recipientRole
            },
            createdAt: new Date(),
            expiresAt: new Date(+new Date() + 30 * 24 * 60 * 60 * 1000)
          }
        };

        const result = await Notification.findOneAndUpdate(
          { _id: existingNotification._id },  // Update by _id to avoid index conflicts
          updateData,
          { new: true }
        );

        // Emit update event instead of new notification
        if (global.io) {
          global.io.to(`user_${recipientId}`).emit('notification_updated', {
            id: result._id,
            title: result.title,
            body: result.body,
            type: result.type,
            updatedAt: new Date(),
            timeAgo: this.calculateTimeAgo(result.createdAt)
          });
        }

        console.log(`✅ In-app notification updated: ${result._id}`);
        return result;
      }

      // Create new notification only if none exists
      console.log(`✨ Creating new notification for user ${recipientId}, report ${cleanedData.reportId}`);

      const newNotification = new Notification({
        recipient: {
          userId: recipientId,
          role: recipientRole
        },
        type: notificationData.type,
        title: notificationData.title,
        body: notificationData.body,
        data: cleanedData,
        createdAt: new Date(),
        expiresAt: new Date(+new Date() + 30 * 24 * 60 * 60 * 1000)
      });

      const result = await newNotification.save();

      if (global.io) {
        global.io.to(`user_${recipientId}`).emit('new_notification', {
          id: result._id,
          title: result.title,
          body: result.body,
          type: result.type,
          createdAt: result.createdAt,
          timeAgo: this.calculateTimeAgo(result.createdAt)
        });
      }

      console.log(`✅ New in-app notification created: ${result._id}`);
      return result;

    } catch (error) {
      if (error.code === 11000) {
        console.log(`⚠️ Duplicate notification prevented for user ${recipientId}, report ${notificationData.data?.reportId}`);
        // Try to fetch and return the existing one
        const existing = await Notification.findOne({
          'recipient.userId': recipientId,
          'data.reportId': notificationData.data?.reportId,
          type: notificationData.type,
          isArchived: false
        });
        return existing;
      }
      console.error('Error storing in-app notification:', error);
      return null;
    }
  }

  async sendCombinedNotification(userId, userRole, notification, data = {}) {
    console.log('🚀 sendCombinedNotification called');
    console.log('👉 userId:', userId);
    console.log('👉 userRole:', userRole);
    console.log('👉 notification:', notification);
    console.log('👉 data (initial):', data);

    try {
      // Ensure status is always included in data if it's a report-related notification
      const enhancedData = { ...data };
      console.log('🧩 enhancedData (before):', enhancedData);

      // If this is a report notification and status is missing, try to fetch it
      if (data.reportId && !data.status) {
        console.log('📄 ReportId found but status missing. Fetching from DB...');

        try {
          const Report = require('../models/MaintenanceReport');
          const report = await Report.findById(data.reportId).select('status');

          if (report) {
            enhancedData.status = report.status;
            console.log('✅ Fetched report status:', report.status);
          } else {
            console.warn('⚠️ Report not found for ID:', data.reportId);
          }
        } catch (err) {
          console.error('❌ Could not fetch report status:', err);
        }
      }

      console.log('🧩 enhancedData (after):', enhancedData);

      // Send push notification
      console.log('📲 Sending push notification...');
      const pushResult = await this.sendToUser(userId, notification, enhancedData);
      console.log('✅ Push result:', pushResult);

      // Store in-app notification
      console.log('💾 Storing in-app notification...');
      const inAppResult = await this.storeInAppNotification(
        userId,
        userRole,
        {
          ...notification,
          type: enhancedData.type,
          data: enhancedData
        }
      );
      console.log('✅ In-app result:', inAppResult);

      console.log('🎉 Notification flow completed successfully');

      return { pushResult, inAppResult };
    } catch (error) {
      console.error('🔥 Error in sendCombinedNotification:', error);
    }
  }


  async updateInAppNotificationsForReport(reportId, updateData) {
    try {
      // Find all unarchived notifications for this report
      const notifications = await Notification.find({
        'data.reportId': reportId,
        isArchived: false
      });

      if (notifications.length === 0) {
        console.log(`No in-app notifications found for report ${reportId}`);
        return { updatedCount: 0 };
      }

      let updatedCount = 0;
      let updatedIds = [];

      for (const notification of notifications) {
        let needsUpdate = false;

        // Update status if provided
        if (updateData.status && notification.data.status !== updateData.status) {
          notification.data.status = updateData.status;
          needsUpdate = true;
        }

        // Update previous status if provided
        if (updateData.previousStatus) {
          notification.data.previousStatus = updateData.previousStatus;
          needsUpdate = true;
        }

        // Update updatedBy if provided
        if (updateData.updatedBy) {
          notification.data.updatedBy = updateData.updatedBy;
          needsUpdate = true;
        }

        // Update body for new_report notifications when status changes
        if (updateData.shouldUpdateBody && updateData.newStatus) {
          if (notification.type === NOTIFICATION_TYPES.NEW_REPORT) {
            const oldBody = notification.body;
            // Only update if status changed from open to something else
            if (oldBody.includes('created a new report') && updateData.newStatus !== 'open') {
              notification.body = `${oldBody} (Now: ${updateData.newStatus})`;
              needsUpdate = true;
            }
          } else if (notification.type === NOTIFICATION_TYPES.ASSIGNED) {
            // Update assignment notification body if needed
            if (!notification.body.includes(`Status: ${updateData.newStatus}`)) {
              notification.body = `${notification.body} | Status: ${updateData.newStatus}`;
              needsUpdate = true;
            }
          }
        }

        // Add additional data if provided
        if (updateData.additionalData) {
          notification.data.additionalData = {
            ...notification.data.additionalData,
            ...updateData.additionalData
          };
          needsUpdate = true;
        }

        // Save if updated
        if (needsUpdate) {
          notification.updatedAt = new Date();
          await notification.save();
          updatedCount++;
          updatedIds.push(notification._id);

          // Emit real-time update via Socket.io
          if (global.io) {
            const recipientId = notification.recipient.userId;
            global.io.to(`user_${recipientId}`).emit('notification_updated', {
              notificationId: notification._id,
              data: notification.data,
              body: notification.body,
              updatedAt: notification.updatedAt,
              type: notification.type
            });
          }

          console.log(`✅ Updated notification ${notification._id} (${notification.type}) for report ${reportId}`);
        }
      }

      console.log(`✅ Updated ${updatedCount} in-app notifications for report ${reportId}`);
      return { updatedCount, updatedIds };
    } catch (error) {
      console.error('Error updating in-app notifications:', error);
      return { updatedCount: 0, error: error.message };
    }
  }

  async sendCombinedToMultipleUsers(userIds, notification, data = {}) {
    try {
      const users = await User.find({
        _id: { $in: userIds },
        isActive: true
      }).select('_id role');

      const results = [];

      for (const user of users) {
        const result = await this.sendCombinedNotification(
          user._id,
          user.role,
          notification,
          data
        );
        results.push(result);
      }

      return results;
    } catch (error) {
      console.error('Error sending combined notifications to multiple users:', error);
    }
  }

  async sendToSupervisorsAndAdminsWithInApp(notification, data = {}) {
    try {
      const users = await User.find({
        role: { $in: [USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN] },
        isActive: true
      }).select('_id role');

      for (const user of users) {
        await this.sendCombinedNotification(
          user._id,
          user.role,
          notification,
          data
        );
      }
    } catch (error) {
      console.error('Error sending to supervisors/admins:', error);
    }
  }

  // ==================== BUSINESS LOGIC NOTIFICATIONS ====================

  // Add to your NotificationService class

  async sendFixedForVerificationNotification({ report, fixedBy, recipients }) {
    try {
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const notification = {
        title: '🔧 Report Fixed - Ready for Verification',
        body: `${fixedBy.name || 'A technician'} fixed: ${report.title.substring(0, 50)}... Please verify the fix.`
      };

      const data = {
        type: NOTIFICATION_TYPES.READY_FOR_VERIFICATION,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        fixedBy: fixedBy.name || 'System',
        fixedByEmail: fixedBy.email || '',
        fixedAt: new Date().toISOString(),
        status: REPORT_STATUS.FIXED,
        priority: report.priority,
        fixSummary: report.fixDetails?.summary || ''
      };

      // ✅ ONLY send to assigned users (filter out reporter)
      const recipientsSet = new Set();

      // ✅ Only add assigned users from the report
      if (report.assignedTo && report.assignedTo.length > 0) {
        console.log('📋 Assigned users for verification notification:',
          report.assignedTo.map(a => ({
            id: a._id?.toString(),
            name: a.name,
            role: a.role
          })));

        for (const assignee of report.assignedTo) {
          if (assignee && assignee._id) {
            recipientsSet.add(assignee._id.toString());
          }
        }
      }

      // ❌ REMOVED - Don't add reporter automatically
      // The reporter should not get this notification unless they're assigned

      // Remove the person who fixed the report
      if (fixedBy && fixedBy.id) {
        recipientsSet.delete(fixedBy.id);
      }

      console.log(`👥 Verification notification recipients (assigned users only): ${Array.from(recipientsSet)}`);
      console.log(`📊 Total recipients: ${recipientsSet.size}`);

      // Send to assigned users only
      let sentCount = 0;
      for (const recipientId of recipientsSet) {
        const user = await User.findById(recipientId).select('role name email');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
          sentCount++;
        }
      }

      // ❌ REMOVED - Don't auto-notify all supervisors/admins for high priority
      // Only assigned users should get notifications, even for high priority
      // If you want supervisors/admins to be notified, they must be explicitly assigned
      /*
      if (report.priority === 'critical' || report.priority === 'high') {
        const supervisorNotification = {
          title: '⚠️ High Priority Fix Ready',
          body: `High priority report ${report.reportId} is ready for verification`
        };
  
        await this.sendToSupervisorsAndAdminsWithInApp(supervisorNotification, {
          ...data,
          type: NOTIFICATION_TYPES.ESCALATED,
          alertType: 'high_priority_fix_ready'
        });
      }
      */

      console.log(`✅ Fixed for verification notifications sent to ${sentCount} assigned user(s)`);

      return { sentCount };
    } catch (error) {
      console.error('Error sending fixed for verification notification:', error);
    }
  }

  async sendReportClosedNotification({ report, closedBy, satisfaction, recipient }) {
    try {
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const satisfactionEmoji = satisfaction === 'satisfied' ? '✅' :
        satisfaction === 'partial' ? '⚠️' : '❌';

      const notification = {
        title: `${satisfactionEmoji} Report Closed`,
        body: `Report ${report.reportId} was closed with ${satisfaction} satisfaction${satisfaction !== 'satisfied' ? ' - Needs attention' : ''}`
      };

      const data = {
        type: NOTIFICATION_TYPES.REPORT_CLOSED,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        closedBy: closedBy.name || 'System',
        closedByEmail: closedBy.email || '',
        satisfaction: satisfaction,
        satisfactionRating: satisfaction === 'satisfied' ? 100 : satisfaction === 'partial' ? 50 : 0,
        feedback: report.closureDetails?.feedback || '',
        closedAt: new Date().toISOString(),
        status: REPORT_STATUS.CLOSED,
        priority: report.priority,
        resolutionTime: report.fixedAt ?
          Math.round((new Date(report.closedAt) - new Date(report.fixedAt)) / (1000 * 60 * 60)) :
          null
      };

      // Send to the reporter (who closed it)
      if (recipient && recipient._id) {
        const user = await User.findById(recipient._id).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipient._id,
            user.role,
            notification,
            data
          );
        }
      }

      // Send to assigned users (who fixed it)
      if (report.assignedTo && report.assignedTo.length > 0) {
        for (const assignee of report.assignedTo) {
          if (assignee._id && assignee._id.toString() !== recipient?._id?.toString()) {
            const assigneeNotification = {
              title: `${satisfactionEmoji} Your Fix Was ${satisfaction === 'satisfied' ? 'Approved' : 'Rejected'}`,
              body: `The fix for report ${report.reportId} was marked as ${satisfaction} by ${closedBy.name}`
            };

            const assigneeData = {
              ...data,
              type: NOTIFICATION_TYPES.FIX_REVIEWED,
              reviewerFeedback: report.closureDetails?.feedback || ''
            };

            const user = await User.findById(assignee._id).select('role');
            if (user) {
              await this.sendCombinedNotification(
                assignee._id,
                user.role,
                assigneeNotification,
                assigneeData
              );
            }
          }
        }
      }

      // Send low satisfaction alert to supervisors/admins
      if (satisfaction === 'unsatisfied' || satisfaction === 'partial') {
        const supervisorNotification = {
          title: '⚠️ Low Satisfaction Alert',
          body: `Report ${report.reportId} was closed with ${satisfaction} satisfaction by ${closedBy.name}`
        };

        const supervisorData = {
          ...data,
          type: NOTIFICATION_TYPES.SATISFACTION_SURVEY,
          alertType: 'low_satisfaction',
          alertPriority: satisfaction === 'unsatisfied' ? 'high' : 'medium'
        };

        await this.sendToSupervisorsAndAdminsWithInApp(supervisorNotification, supervisorData);
      }

      console.log(`✅ Report closed notification sent for report ${report.reportId} with satisfaction: ${satisfaction}`);
    } catch (error) {
      console.error('Error sending report closed notification:', error);
    }
  }

  async sendNewReportNotifications(report, creator) {
    try {
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const notification = {
        title: 'New Maintenance Report',
        body: `${creator.name || 'Someone'} created a new report: ${report.title.substring(0, 50)}...`
      };

      const data = {
        type: NOTIFICATION_TYPES.NEW_REPORT,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        priority: report.priority,
        issueType: report.issueType,
        status: report.status || REPORT_STATUS.OPEN,
        createdAt: report.createdAt
      };

      const users = await User.find({
        role: { $in: [USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN] },
        isActive: true
      }).select('_id role');

      let sentCount = 0;
      let duplicateCount = 0;

      for (const user of users) {
        // Check if notification already exists for this user and report
        const existing = await this.checkExistingNotification(
          user._id.toString(),
          report._id.toString(),
          NOTIFICATION_TYPES.NEW_REPORT
        );

        if (existing) {
          console.log(`⏭️ Skipping duplicate new_report notification for user ${user._id}`);
          duplicateCount++;
          continue;
        }

        await this.sendCombinedNotification(
          user._id,
          user.role,
          notification,
          data
        );
        sentCount++;
      }

      console.log(`📊 New report notifications: ${sentCount} sent, ${duplicateCount} duplicates prevented`);

      if (report.priority === 'critical') {
        await this.sendCriticalReportAlert(report, creator);
      }
    } catch (error) {
      console.error('Error sending new report notifications:', error);
    }
  }

  // Update sendAssignmentNotification to include status
  async sendAssignmentNotification(report, assignee, assignedBy) {
    try {
      let userId;
      let userRole;

      if (assignee && typeof assignee === 'object') {
        userId = assignee._id || assignee;
        userRole = assignee.role;
      } else {
        userId = assignee;
      }

      // 🎯 CRITICAL: Don't send notification if user is assigning to themselves
      if (userId.toString() === assignedBy._id?.toString() || userId.toString() === assignedBy.id?.toString()) {
        console.log(`⏭️ Skipping self-assignment notification for user ${userId}`);
        return { skipped: true, reason: 'self_assignment' };
      }

      if (!userRole) {
        const user = await User.findById(userId).select('role');
        if (!user) {
          console.error(`User not found: ${userId}`);
          return;
        }
        userRole = user.role;
      }

      // Check if assignment notification already exists
      const existing = await this.checkExistingNotification(
        userId.toString(),
        report._id.toString(),
        NOTIFICATION_TYPES.ASSIGNED
      );

      if (existing) {
        console.log(`⏭️ Updating existing assignment notification for user ${userId} instead of creating duplicate`);
        // Update existing notification
        await this.updateInAppNotificationsForReport(report._id.toString(), {
          status: report.status,
          updatedBy: assignedBy.name,
          additionalData: {
            reassignedAt: new Date().toISOString(),
            reassignedBy: assignedBy.name
          }
        });
        return { updated: true };
      }

      const notification = {
        title: 'Report Assigned to You',
        body: `${assignedBy.name || 'A supervisor'} assigned you to: ${report.title.substring(0, 50)}...`
      };

      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const data = {
        type: NOTIFICATION_TYPES.ASSIGNED,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        priority: report.priority,
        assignedBy: assignedBy.name || 'System',
        status: report.status || REPORT_STATUS.ASSIGNED,
        assignedAt: new Date().toISOString(),
        isSelfAssignment: false
      };

      console.log(`Sending assignment notification to user: ${userId}, role: ${userRole}`);

      await this.sendCombinedNotification(
        userId,
        userRole,
        notification,
        data
      );

      return { sent: true };
    } catch (error) {
      console.error('Error sending assignment notification:', error);
      return { error: error.message };
    }
  }

  async sendStatusUpdateNotification(report, previousStatus, updatedBy) {
    try {
      // Extract plaza ID properly
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      // FIRST: Update all existing in-app notifications for this report
      await this.updateInAppNotificationsForReport(
        report._id.toString(),
        {
          status: report.status,
          previousStatus: previousStatus,
          updatedBy: updatedBy.name || 'System',
          newStatus: report.status,
          shouldUpdateBody: true,
          additionalData: {
            lastStatusUpdate: new Date().toISOString(),
            statusTransition: `${previousStatus}_to_${report.status}`
          }
        }
      );

      // THEN: Create a new notification for the status change
      const notification = {
        title: 'Report Status Updated',
        body: `Report ${report.reportId || report._id} changed from ${previousStatus} to ${report.status} by ${updatedBy.name || 'System'}`
      };

      const data = {
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        status: report.status,  // ✅ CURRENT STATUS
        previousStatus: previousStatus,  // ✅ PREVIOUS STATUS
        updatedBy: updatedBy.name || 'System',
        priority: report.priority,
        updatedAt: new Date().toISOString()
      };

      // ✅ ONLY add assigned users (remove reporter and auto-admins)
      const recipients = new Set();

      // ❌ REMOVED - Don't add the reporter automatically
      // if (report.reportedBy && report.reportedBy._id) {
      //   recipients.add(report.reportedBy._id.toString());
      // }

      // ✅ ONLY add assigned users
      if (report.assignedTo && report.assignedTo.length > 0) {
        console.log('📋 Assigned users for status update:',
          report.assignedTo.map(a => a._id?.toString()));

        for (const assignee of report.assignedTo) {
          if (assignee._id) {
            recipients.add(assignee._id.toString());
          } else if (typeof assignee === 'object' && assignee.toString) {
            recipients.add(assignee.toString());
          }
        }
      }

      // ❌ REMOVED - Don't auto-add supervisors/admins
      // Even for critical updates, only assigned users should get notifications
      // if (report.priority === 'critical' ||
      //   report.status === REPORT_STATUS.REOPENED ||
      //   (previousStatus === REPORT_STATUS.FIXED && report.status === REPORT_STATUS.REOPENED)) {
      //   const supervisorsAndAdmins = await User.find({
      //     role: { $in: [USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN] },
      //     isActive: true
      //   }).select('_id role');
      //
      //   for (const user of supervisorsAndAdmins) {
      //     recipients.add(user._id.toString());
      //   }
      // }

      // Remove the person who made the update
      if (updatedBy.id) {
        recipients.delete(updatedBy.id);
      }

      console.log(`👥 Status update recipients (assigned users only): ${Array.from(recipients)}`);
      console.log(`📊 Total recipients: ${recipients.size}`);

      // Send notifications to all recipients
      let sentCount = 0;
      for (const recipientId of recipients) {
        const user = await User.findById(recipientId).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
          sentCount++;
        }
      }

      // Get count of updated notifications
      const updatedCount = await Notification.countDocuments({
        'data.reportId': report._id.toString(),
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        isArchived: false
      });

      console.log(`✅ Status update completed: ${updatedCount} existing notifications updated, ${sentCount} new notifications sent to assigned users`);

      return {
        updatedExistingCount: updatedCount,
        newNotificationsSent: sentCount
      };
    } catch (error) {
      console.error('Error sending status update notification:', error);
    }
  }


  // Add this helper method to update existing notifications
  async updateInAppNotificationsForReport(reportId, updateData) {
    try {
      // Find all unarchived notifications for this report
      const notifications = await Notification.find({
        'data.reportId': reportId,
        isArchived: false
      });

      if (notifications.length === 0) {
        console.log(`No in-app notifications found for report ${reportId}`);
        return { updatedCount: 0 };
      }

      let updatedCount = 0;

      for (const notification of notifications) {
        // Update the notification data
        if (updateData.status) {
          notification.data.status = updateData.status;
        }
        if (updateData.previousStatus) {
          notification.data.previousStatus = updateData.previousStatus;
        }
        if (updateData.updatedBy) {
          notification.data.updatedBy = updateData.updatedBy;
        }
        if (updateData.additionalData) {
          notification.data.additionalData = {
            ...notification.data.additionalData,
            ...updateData.additionalData
          };
        }

        // Update the body to reflect status change
        if (updateData.shouldUpdateBody && updateData.newStatus) {
          if (notification.type === NOTIFICATION_TYPES.STATUS_UPDATE) {
            notification.body = `Report ${notification.data.reportNumber || ''} updated to ${updateData.newStatus}`;
          } else if (notification.type === NOTIFICATION_TYPES.NEW_REPORT) {
            // Also update new_report notifications to show current status
            notification.body = `${notification.body} (Status: ${updateData.newStatus})`;
          }
        }

        notification.updatedAt = new Date();
        await notification.save();
        updatedCount++;

        // Emit real-time update via Socket.io
        if (global.io) {
          const recipientId = notification.recipient.userId;
          global.io.to(`user_${recipientId}`).emit('notification_updated', {
            notificationId: notification._id,
            data: notification.data,
            body: notification.body,
            updatedAt: notification.updatedAt
          });
        }
      }

      console.log(`✅ Updated ${updatedCount} in-app notifications for report ${reportId}`);
      return { updatedCount };
    } catch (error) {
      console.error('Error updating in-app notifications:', error);
      return { updatedCount: 0, error: error.message };
    }
  }


  async sendFixedForVerificationNotification({ report, fixedBy, recipients }) {
    try {
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const notification = {
        title: '🔧 Report Fixed - Ready for Verification',
        body: `${fixedBy.name || 'A technician'} fixed: ${report.title.substring(0, 50)}... Please verify the fix.`
      };

      const data = {
        type: NOTIFICATION_TYPES.READY_FOR_VERIFICATION,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        fixedBy: fixedBy.name || 'System',
        fixedByEmail: fixedBy.email || '',
        fixedAt: new Date().toISOString(),
        status: REPORT_STATUS.FIXED,
        priority: report.priority,
        fixSummary: report.fixDetails?.summary || ''
      };

      // ✅ ONLY send to assigned users (filter out reporter)
      const recipientsSet = new Set();

      // ✅ Only add assigned users from the report
      if (report.assignedTo && report.assignedTo.length > 0) {
        console.log('📋 Assigned users for verification notification:',
          report.assignedTo.map(a => ({
            id: a._id?.toString(),
            name: a.name,
            role: a.role
          })));

        for (const assignee of report.assignedTo) {
          if (assignee && assignee._id) {
            recipientsSet.add(assignee._id.toString());
          }
        }
      }

      // ✅ CRITICAL FIX: Remove the person who fixed the report
      const fixedById = fixedBy.id || fixedBy._id?.toString();
      if (fixedById) {
        recipientsSet.delete(fixedById);
        console.log(`✅ Removed fixer (${fixedById}) from recipients`);
      }

      console.log(`👥 Verification notification recipients (assigned users only, excluding fixer): ${Array.from(recipientsSet)}`);
      console.log(`📊 Total recipients: ${recipientsSet.size}`);

      // Send to assigned users only (excluding fixer)
      let sentCount = 0;
      for (const recipientId of recipientsSet) {
        const user = await User.findById(recipientId).select('role name email');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
          sentCount++;
        }
      }

      console.log(`✅ Fixed for verification notifications sent to ${sentCount} assigned user(s) (excluding fixer)`);

      return { sentCount };
    } catch (error) {
      console.error('Error sending fixed for verification notification:', error);
    }
  }

  async sendReportClosedNotification({ report, closedBy, satisfaction, recipient }) {
    try {
      const notification = {
        title: 'Report Closed',
        body: `Report ${report.reportId} was closed with satisfaction: ${satisfaction}`
      };

      const data = {
        type: NOTIFICATION_TYPES.REPORT_CLOSED,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        closedBy: closedBy.name || 'System',
        satisfaction: satisfaction,
        closedAt: new Date().toISOString(),
        status: REPORT_STATUS.CLOSED
      };

      if (recipient && recipient._id) {
        const user = await User.findById(recipient._id).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipient._id,
            user.role,
            notification,
            data
          );
        }
      }

      if (satisfaction === 'unsatisfied' || satisfaction === 'partial') {
        const supervisorNotification = {
          title: 'Low Satisfaction Alert',
          body: `Report ${report.reportId} was closed with ${satisfaction} satisfaction`
        };

        const supervisorData = {
          ...data,
          type: NOTIFICATION_TYPES.SATISFACTION_SURVEY,
          alertType: 'low_satisfaction'
        };

        await this.sendToSupervisorsAndAdminsWithInApp(supervisorNotification, supervisorData);
      }
    } catch (error) {
      console.error('Error sending report closed notification:', error);
    }
  }

  async sendReportReopenedNotification(report, reopenedBy, reason) {
    try {
      const notification = {
        title: 'Report Reopened',
        body: `Report ${report.reportId} was reopened: ${reason || 'Issue persists'}`
      };

      const data = {
        type: NOTIFICATION_TYPES.REPORT_REOPENED,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        reopenedBy: reopenedBy.name || 'System',
        reason: reason || 'Not specified',
        reopenedAt: new Date().toISOString(),
        status: REPORT_STATUS.REOPENED
      };

      const recipients = new Set();

      if (report.assignedTo && report.assignedTo._id) {
        recipients.add(report.assignedTo._id.toString());
      }

      if (report.reportedBy && report.reportedBy._id) {
        recipients.add(report.reportedBy._id.toString());
      }

      for (const recipientId of recipients) {
        const user = await User.findById(recipientId).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
        }
      }

      await this.sendToSupervisorsAndAdminsWithInApp(notification, data);
    } catch (error) {
      console.error('Error sending report reopened notification:', error);
    }
  }

  async sendCriticalReportAlert(report, createdBy) {
    try {
      // Extract plaza ID properly
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      const notification = {
        title: '🚨 CRITICAL REPORT',
        body: `Critical issue: ${report.title.substring(0, 50)}...`
      };

      const data = {
        type: NOTIFICATION_TYPES.ESCALATED,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,  // Use extracted ID
        issueType: report.issueType,
        createdBy: createdBy.name || 'System',
        priority: 'critical',
        severity: 'critical'
      };

      const users = await User.find({
        role: { $in: [USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN] },
        isActive: true
      }).select('_id role');

      for (const user of users) {
        await this.sendCombinedNotification(
          user._id,
          user.role,
          notification,
          data
        );
        await this.sendHighPriorityPush(user._id, notification, data);
      }
    } catch (error) {
      console.error('Error sending critical report alert:', error);
    }
  }
  // ==================== FCM TOKEN MANAGEMENT ====================

  async registerToken(userId, token, deviceInfo = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.fcmTokens) {
        user.fcmTokens = [];
      }

      const tokenExists = user.fcmTokens.some(t => t.token === token);

      if (!tokenExists) {
        user.fcmTokens.push({
          token,
          deviceType: deviceInfo.deviceType || 'unknown',
          deviceModel: deviceInfo.deviceModel || 'unknown',
          osVersion: deviceInfo.osVersion || 'unknown',
          appVersion: deviceInfo.appVersion || 'unknown',
          lastUsed: new Date(),
          isActive: true
        });

        if (user.fcmTokens.length > 5) {
          user.fcmTokens = user.fcmTokens.slice(-5);
        }

        await user.save();
        console.log(`FCM token registered for user ${userId}`);
      } else {
        const tokenIndex = user.fcmTokens.findIndex(t => t.token === token);
        if (tokenIndex !== -1) {
          user.fcmTokens[tokenIndex].lastUsed = new Date();
          user.fcmTokens[tokenIndex].isActive = true;
          await user.save();
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error registering FCM token:', error);
      throw error;
    }
  }

  async removeToken(userId, token) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.fcmTokens) {
        return;
      }

      user.fcmTokens = user.fcmTokens.filter(t => t.token !== token);
      await user.save();

      console.log(`FCM token removed for user ${userId}`);
    } catch (error) {
      console.error('Error removing FCM token:', error);
    }
  }

  // ==================== IN-APP NOTIFICATION QUERIES ====================

  async getUserNotifications(userId, page = 1, limit = 20, filter = 'all') {
    try {
      const query = { 'recipient.userId': userId, isArchived: false };

      if (filter === 'unread') {
        query.isRead = false;
      } else if (filter === 'read') {
        query.isRead = true;
      }

      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        Notification.find(query) // ✅ Changed from InAppNotification
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments(query) // ✅ Changed from InAppNotification
      ]);

      notifications.forEach(notif => {
        notif.timeAgo = this.calculateTimeAgo(notif.createdAt);
      });

      return {
        notifications,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        unreadCount: await this.getUnreadNotificationCount(userId)
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      return { notifications: [], total: 0, page: 1, totalPages: 0, unreadCount: 0 };
    }
  }

  async getUnreadNotificationCount(userId) {
    try {
      return await Notification.countDocuments({ // ✅ Changed from InAppNotification
        'recipient.userId': userId,
        isRead: false,
        isArchived: false
      });
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate( // ✅ Changed from InAppNotification
        {
          _id: notificationId,
          'recipient.userId': userId
        },
        {
          isRead: true,
          readAt: new Date()
        },
        { new: true }
      );

      if (notification && global.io) {
        const unreadCount = await this.getUnreadNotificationCount(userId);
        global.io.to(`user_${userId}`).emit('unread_count', unreadCount);
      }

      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return null;
    }
  }

  async markAllAsRead(userId) {
    try {
      const result = await Notification.updateMany( // ✅ Changed from InAppNotification
        {
          'recipient.userId': userId,
          isRead: false
        },
        {
          isRead: true,
          readAt: new Date()
        }
      );

      if (global.io) {
        global.io.to(`user_${userId}`).emit('unread_count', 0);
      }

      return result;
    } catch (error) {
      console.error('Error marking all as read:', error);
      return null;
    }
  }

  async deleteNotification(notificationId, userId) {
    try {
      const result = await Notification.findOneAndUpdate( // ✅ Changed from InAppNotification
        {
          _id: notificationId,
          'recipient.userId': userId
        },
        { isArchived: true },
        { new: true }
      );

      if (result && global.io) {
        const unreadCount = await this.getUnreadNotificationCount(userId);
        global.io.to(`user_${userId}`).emit('unread_count', unreadCount);
      }

      return result;
    } catch (error) {
      console.error('Error deleting notification:', error);
      return null;
    }
  }

  async getAdminNotifications(filters = {}, page = 1, limit = 50) {
    try {
      const query = { isArchived: false };

      if (filters.userId) query['recipient.userId'] = filters.userId;
      if (filters.type) query.type = filters.type;
      if (filters.role) query['recipient.role'] = filters.role;
      if (filters.isRead !== undefined) query.isRead = filters.isRead;

      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        Notification.find(query) // ✅ Changed from InAppNotification
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('recipient.userId', 'name email role')
          .lean(),
        Notification.countDocuments(query) // ✅ Changed from InAppNotification
      ]);

      return {
        notifications,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('Error getting admin notifications:', error);
      return { notifications: [], total: 0, page: 1, totalPages: 0 };
    }
  }

  async archiveOldNotifications(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await Notification.updateMany( // ✅ Changed from InAppNotification
        {
          createdAt: { $lt: cutoffDate },
          isArchived: false
        },
        { isArchived: true }
      );

      console.log(`Archived ${result.modifiedCount} old notifications`);
      return result;
    } catch (error) {
      console.error('Error archiving old notifications:', error);
      return null;
    }
  }


  // Add to NotificationService class in services/NotificationService.js

  async sendCommentNotification({ report, comment, commentAuthor, recipients }) {
    try {
      // Extract plaza ID properly
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      // Handle both 'content' and 'text' field names
      const commentText = comment.content || comment.text || '';

      // Truncate comment for notification body
      const commentPreview = commentText.length > 60
        ? commentText.substring(0, 60) + '...'
        : commentText;

      const notification = {
        title: `💬 New Comment on Report ${report.reportId}`,
        body: `${commentAuthor.name || commentAuthor.email} commented: "${commentPreview}"`
      };

      const data = {
        type: NOTIFICATION_TYPES.NEW_COMMENT,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        commentId: comment._id.toString(),
        commentContent: commentText,
        commentAuthor: commentAuthor.name || commentAuthor.email,
        commentAuthorId: commentAuthor._id.toString(),
        commentCreatedAt: comment.createdAt || new Date().toISOString(),
        priority: report.priority,
        status: report.status,
        hasPhotos: comment.photos && comment.photos.length > 0,
        photoCount: comment.photos?.length || 0
      };

      let sentCount = 0;

      // Send to all recipients (excluding the comment author)
      for (const recipient of recipients) {
        // Skip if recipient is the comment author
        if (recipient._id.toString() === commentAuthor._id.toString()) {
          continue;
        }

        // Send new notification for each comment
        const user = await User.findById(recipient._id).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipient._id,
            user.role,
            notification,
            data
          );
          sentCount++;
        }
      }

      // For high-priority reports, also notify supervisors/admins
      if (report.priority === 'critical' || report.priority === 'high') {
        const supervisorNotification = {
          title: '⚠️ Important Comment on Critical Report',
          body: `${commentAuthor.name} commented on critical report ${report.reportId}: "${commentPreview}"`
        };

        const supervisorData = {
          ...data,
          alertType: 'critical_report_comment',
          requiresAttention: true
        };

        await this.sendToSupervisorsAndAdminsWithInApp(supervisorNotification, supervisorData);
      }

      console.log(`✅ Comment notifications sent: ${sentCount} recipient(s)`);

      return {
        sentCount,
        totalRecipients: recipients.length - 1 // Excluding author
      };
    } catch (error) {
      console.error('Error sending comment notification:', error);
      throw error;
    }
  }

  // ==================== UPDATE EXISTING NOTIFICATIONS ====================

  async updateInAppNotificationsForReport(reportId, updateData) {
    try {
      // Find all unarchived notifications for this report
      const notifications = await Notification.find({ // ✅ Changed from InAppNotification
        'data.reportId': reportId,
        isArchived: false
      });

      if (notifications.length === 0) {
        console.log(`No in-app notifications found for report ${reportId}`);
        return { updatedCount: 0 };
      }

      let updatedCount = 0;

      for (const notification of notifications) {
        // Update the notification data
        if (updateData.status) {
          notification.data.status = updateData.status;
        }
        if (updateData.previousStatus) {
          notification.data.previousStatus = updateData.previousStatus;
        }
        if (updateData.updatedBy) {
          notification.data.updatedBy = updateData.updatedBy;
        }
        if (updateData.additionalData) {
          notification.data.additionalData = {
            ...notification.data.additionalData,
            ...updateData.additionalData
          };
        }

        // Update the body to reflect status change (optional)
        if (updateData.shouldUpdateBody && updateData.newStatus) {
          // Only update specific notification types
          if (notification.type === NOTIFICATION_TYPES.STATUS_UPDATE) {
            notification.body = `Report ${notification.data.reportNumber || ''} updated to ${updateData.newStatus}`;
          }
        }

        notification.updatedAt = new Date();
        await notification.save();
        updatedCount++;

        // Emit real-time update via Socket.io
        if (global.io) {
          const recipientId = notification.recipient.userId;
          global.io.to(`user_${recipientId}`).emit('notification_updated', {
            notificationId: notification._id,
            data: notification.data,
            body: notification.body,
            updatedAt: notification.updatedAt
          });
        }
      }

      console.log(`✅ Updated ${updatedCount} in-app notifications for report ${reportId}`);
      return { updatedCount };
    } catch (error) {
      console.error('Error updating in-app notifications:', error);
      return { updatedCount: 0, error: error.message };
    }
  }


  async updateNotificationForStatusChange(report, previousStatus, updatedBy) {
    try {
      // Extract plaza ID properly
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      // Update existing notifications for this report
      const updateResult = await this.updateInAppNotificationsForReport(
        report._id.toString(),
        {
          status: report.status,
          previousStatus: previousStatus,
          updatedBy: updatedBy.name || 'System',
          newStatus: report.status,
          shouldUpdateBody: true,
          additionalData: {
            updatedAt: new Date().toISOString(),
            statusChangedBy: updatedBy._id || updatedBy.id,
            statusChangedByName: updatedBy.name || 'System'
          }
        }
      );

      // Also send a new status update notification (keeping both old and new)
      // This ensures users get a "new" notification for status changes
      const notification = {
        title: 'Report Status Updated',
        body: `Report ${report.reportId || report._id} changed from ${previousStatus} to ${report.status}`
      };

      const data = {
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        status: report.status,
        previousStatus: previousStatus,
        updatedBy: updatedBy.name || 'System',
        priority: report.priority,
        isUpdate: true, // Flag to indicate this is an update
        previousNotificationUpdated: updateResult.updatedCount > 0
      };

      const recipients = new Set();

      if (report.reportedBy && report.reportedBy._id) {
        recipients.add(report.reportedBy._id.toString());
      }

      if (report.assignedTo && report.assignedTo.length > 0) {
        for (const assignee of report.assignedTo) {
          if (assignee._id) {
            recipients.add(assignee._id.toString());
          } else if (typeof assignee === 'object' && assignee.toString) {
            recipients.add(assignee.toString());
          }
        }
      }

      // Send new notifications to all recipients
      for (const recipientId of recipients) {
        const user = await User.findById(recipientId).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
        }
      }

      return {
        updatedExisting: updateResult,
        newNotificationsSent: recipients.size
      };
    } catch (error) {
      console.error('Error updating notifications for status change:', error);
      return { error: error.message };
    }
  }

  // Replace your existing sendStatusUpdateNotification with this one
  async sendStatusUpdateNotification(report, previousStatus, updatedBy) {
    try {
      // Extract plaza ID properly
      let plazaIdString = '';
      if (report.plazaId) {
        plazaIdString = typeof report.plazaId === 'object'
          ? report.plazaId._id?.toString()
          : report.plazaId.toString();
      }

      // FIRST: Update all existing in-app notifications for this report
      await this.updateInAppNotificationsForReport(
        report._id.toString(),
        {
          status: report.status,
          previousStatus: previousStatus,
          updatedBy: updatedBy.name || 'System',
          newStatus: report.status,
          shouldUpdateBody: true,
          additionalData: {
            lastStatusUpdate: new Date().toISOString(),
            statusTransition: `${previousStatus}_to_${report.status}`
          }
        }
      );

      // SECOND: Create a new notification for the status change
      const notification = {
        title: 'Report Status Updated',
        body: `Report ${report.reportId || report._id} changed from ${previousStatus} to ${report.status} by ${updatedBy.name || 'System'}`
      };

      const data = {
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        reportId: report._id.toString(),
        reportTitle: report.title,
        reportNumber: report.reportId,
        plazaId: plazaIdString,
        status: report.status,
        previousStatus: previousStatus,
        updatedBy: updatedBy.name || 'System',
        priority: report.priority,
        updatedAt: new Date().toISOString()
      };

      const recipients = new Set();

      // ✅ ONLY add assigned users (remove reporter and auto-admins)
      if (report.assignedTo && report.assignedTo.length > 0) {
        console.log('📋 Assigned users for status update:',
          report.assignedTo.map(a => a._id?.toString()));

        for (const assignee of report.assignedTo) {
          if (assignee._id) {
            recipients.add(assignee._id.toString());
          } else if (typeof assignee === 'object' && assignee.toString) {
            recipients.add(assignee.toString());
          }
        }
      }

      // ✅ CRITICAL FIX: Remove the person who made the update
      const updatedById = updatedBy.id || updatedBy._id?.toString();
      if (updatedById) {
        recipients.delete(updatedById);
        console.log(`✅ Removed updater (${updatedById}) from recipients`);
      }

      // Send notifications to all recipients
      for (const recipientId of recipients) {
        const user = await User.findById(recipientId).select('role');
        if (user) {
          await this.sendCombinedNotification(
            recipientId,
            user.role,
            notification,
            data
          );
        }
      }

      // Get count of updated notifications
      const updatedCount = await Notification.countDocuments({ // ✅ Changed from InAppNotification
        'data.reportId': report._id.toString(),
        type: NOTIFICATION_TYPES.STATUS_UPDATE,
        isArchived: false
      });

      console.log(`✅ Status update completed: ${updatedCount} existing notifications updated, ${recipients.size} new notifications sent`);

      return {
        updatedExistingCount: updatedCount,
        newNotificationsSent: recipients.size
      };
    } catch (error) {
      console.error('Error sending status update notification:', error);
    }
  }

  // ==================== HELPER METHODS ====================

  calculateTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - new Date(date)) / 1000);

    if (diff < 60) return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
    return `${Math.floor(diff / 2592000)} months ago`;
  }
}

module.exports = new NotificationService();