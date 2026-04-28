const TollMaintenanceReport = require('../models/MaintenanceReport');
const TollPlaza = require('../models/TollPlaza');
const InAppNotification = require('../models/Notification');
const User = require('../models/User');
const NotificationService = require('../services/notificationService');
const path = require('path');
const fs = require('fs');
const {deleteFromCloudinary } = require('../middleware/upload');
const generateReportId = require('../utils/generateReportId');
const { REPORT_STATUS, USER_ROLES, ERROR_MESSAGES } = require('../utils/constants');
const { sendAssignmentEmail } = require('../utils/emailService');


// ==================== CORE CRUD OPERATIONS ====================
// @desc    Create maintenance report
// @route   POST /api/toll-maintenance/reports
// @access  Private
exports.createReport = async (req, res) => {
  try {
    const plaza = await TollPlaza.findById(req.body.plazaId);
    if (!plaza) {
      return res.status(404).json({ success: false, message: 'Toll plaza not found' });
    }

    // ✅ FIX: await the async function and pass plaza name
    const reportId = await generateReportId(plaza._id, plaza.name);
    // Process photos with reportId as filename
    const photos = (req.files || []).map((file, index) => {
      const fileExtension = file.originalname ? file.originalname.split('.').pop() : 'jpg';
      const customFilename = `${reportId}_photo_${index + 1}.${fileExtension}`;

      return {
        url: file.path || file.secure_url,
        publicId: customFilename,
        uploadedBy: req.user.id,
        fileSize: file.size,
        fileType: file.mimetype,
        caption: req.body[`caption_${file.fieldname}`] || req.body.caption,
        originalFilename: file.originalname
      };
    });

    const reportData = {
      ...req.body,
      reportId: reportId, // ✅ Now a string, not a Promise
      reportedBy: req.user.id,
      photos,
      timeline: [{
        status: REPORT_STATUS.OPEN,
        changedBy: req.user.id,
        changedAt: new Date(),
        notes: 'Maintenance report created'
      }]
    };

    ['estimatedHours', 'costEstimate'].forEach(field => {
      if (req.body[field]) reportData[field] = parseFloat(req.body[field]);
    });

    const report = await TollMaintenanceReport.create(reportData);

    await report.populate([
      { path: 'reportedBy', select: 'name email' },
      { path: 'plazaId', select: 'name' },
      { path: 'assignedTo', select: 'name email' }
    ]);

    if (req.body.assignedTo) {
      await NotificationService.sendAssignmentNotification(report, { _id: req.body.assignedTo }, req.user);
    } else {
      NotificationService.sendNewReportNotifications(report, req.user).catch(console.error);
    }

    res.status(201).json({
      success: true,
      message: 'Maintenance report created successfully',
      data: report
    });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Admin creates report and optionally assigns supervisor
// @route   POST /api/toll-maintenance/admin/reports
// @access  Private (Admin only)
exports.adminCreateReport = async (req, res) => {
  try {
    console.log("🚀 Admin Create Report API Hit");

    // ✅ 1. Role check
    if (req.user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can access this endpoint'
      });
    }

    console.log("👤 Admin:", req.user.email);

    // ✅ 2. Check plaza
    const plaza = await TollPlaza.findById(req.body.plazaId);
    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    console.log("🏢 Plaza:", plaza.name);

    // ✅ 3. Generate reportId FIRST (await the async function)
    console.log("🏢 Plaza ID:", plaza._id);
    console.log("🏢 Plaza Name:", plaza.name);
    console.log("📝 Generating report ID with:", { plazaId: plaza._id.toString(), plazaName: plaza.name });
    const reportId = await generateReportId(plaza._id, plaza.name);
    console.log("📝 Generated Report ID:", reportId);

    // ✅ 4. Check supervisor
    let assignee = null;

    if (req.body.assignedTo) {
      assignee = await User.findOne({
        _id: req.body.assignedTo,
        role: USER_ROLES.SUPERVISOR,
        isActive: true
      });

      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: 'Assigned user must be an active supervisor'
        });
      }

      console.log("✅ Supervisor:", assignee.name);
    }

    // ✅ 5. Process photos with proper naming
    const photos = (req.files || []).map((file, index) => {
      const fileExtension = file.originalname ? file.originalname.split('.').pop() : 'jpg';
      const customFilename = `${reportId}_photo_${index + 1}.${fileExtension}`;

      return {
        url: file.path || file.secure_url,
        publicId: customFilename, // Use consistent naming
        uploadedBy: req.user.id,
        fileSize: file.size,
        fileType: file.mimetype,
        caption: req.body[`caption_${file.fieldname}`] || req.body.caption || ''
      };
    });

    console.log(`📸 Photos count: ${photos.length}`);

    // ✅ 6. Status
    const initialStatus = req.body.assignedTo
      ? REPORT_STATUS.ASSIGNED
      : REPORT_STATUS.OPEN;

    // ✅ 7. Timeline (NO DUPLICATE)
    const timeline = [];

    if (req.body.assignedTo) {
      timeline.push({
        status: REPORT_STATUS.ASSIGNED,
        changedBy: req.user.id,
        changedAt: new Date(),
        notes: `Report created and assigned to ${assignee.name}`
      });
    } else {
      timeline.push({
        status: REPORT_STATUS.OPEN,
        changedBy: req.user.id,
        changedAt: new Date(),
        notes: 'Maintenance report created by admin'
      });
    }

    // ✅ 8. Prepare data
    const reportData = {
      ...req.body,
      reportId: reportId, // ✅ Now a string, not a Promise
      reportedBy: req.user.id,
      photos,
      status: initialStatus,
      timeline
    };

    // ✅ 9. Assignment fields
    if (req.body.assignedTo) {
      reportData.assignedTo = req.body.assignedTo;
      reportData.assignedAt = new Date();
    }

    // ✅ 10. Parse numbers safely
    ['estimatedHours', 'costEstimate'].forEach(field => {
      if (req.body[field]) {
        reportData[field] = parseFloat(req.body[field]);
      }
    });

    console.log("📦 Final Payload:", {
      ...reportData,
      reportId: reportData.reportId // Should show string, not Promise
    });

    // ✅ 11. Create report
    const report = await TollMaintenanceReport.create(reportData);

    // ✅ 12. Populate
    await report.populate([
      { path: 'reportedBy', select: 'name email' },
      { path: 'plazaId', select: 'name location highway' },
      { path: 'assignedTo', select: 'name email role' }
    ]);

    console.log("✅ Report Created:", report.reportId);

    // ✅ 13. Notifications
    if (req.body.assignedTo) {
      await NotificationService.sendAssignmentNotification(
        report,
        { _id: req.body.assignedTo },
        req.user
      );
    }

    NotificationService
      .sendNewReportNotifications(report, req.user)
      .catch(console.error);

    // ✅ 14. Final response
    res.status(201).json({
      success: true,
      message: req.body.assignedTo
        ? `Report ${report.reportId} assigned to ${assignee.name} successfully`
        : `Report ${report.reportId} created successfully`,
      data: report
    });

  } catch (error) {
    console.error("💥 Error in adminCreateReport:", error);

    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Get all reports
// @route   GET /api/toll-maintenance/reports
// @access  Private
exports.getReports = async (req, res) => {
  try {
    const {
      status, priority, issueType, severity,
      plazaId, laneNumber,
      reportedBy, assignedTo,
      startDate, endDate, search,
      sortBy = '-createdAt',
      page = 1,
      limit = 10
    } = req.query;

    // 🧮 Pagination calculation
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // 🧠 Build Query
    let query = {};

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (issueType) query.issueType = issueType;
    if (severity) query.severity = severity;
    if (plazaId) query.plazaId = plazaId;
    if (laneNumber) query.laneNumber = laneNumber;
    if (reportedBy) query.reportedBy = reportedBy;
    if (assignedTo) query.assignedTo = assignedTo;

    // 🔥 DATE FILTER
    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // include full day
        query.createdAt.$lte = end;
      }
    }

    // 🔍 SEARCH
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // 🚀 Fetch Data + Count
    const [reports, total] = await Promise.all([
      TollMaintenanceReport.find(query)
        .populate('reportedBy', 'name email phone')
        .populate('assignedTo', 'name email')
        .populate('plazaId', 'name')
        .sort(sortBy)
        .skip(skip)
        .limit(limitNum)
        .lean(),

      TollMaintenanceReport.countDocuments(query)
    ]);

    // 🔄 Transform Data
    const transformedReports = reports.map(report => ({
      ...report,
      assigneesCount: report.assignedTo?.length || 0,
      currentAssignees: report.assignedTo || []
    }));

    // 📊 Pagination Info
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: {
        reports: transformedReports,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages
        }
      }
    });

  } catch (error) {
    console.error('Error fetching reports:', error);

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// @desc    Get single report
// @route   GET /api/toll-maintenance/reports/:id
// @access  Private
exports.getReportById = async (req, res) => {
  try {
    const report = await TollMaintenanceReport.findById(req.params.id)
      .populate('reportedBy', 'name email phone')
      .populate('assignedTo', 'name email') // Populates array
      .populate('plazaId', 'name')
      .populate('timeline.changedBy', 'name email')
      .populate('comments.user', 'name email')
      .populate('resolutionDetails.resolvedBy', 'name email')
      .populate('reopenDetails.reopenedBy', 'name email')
      .populate('closureDetails.closedBy', 'name email');

    if (!report) {
      return res.status(404).json({ success: false, message: ERROR_MESSAGES.NOT_FOUND });
    }

    // Add metadata about assignments
    const reportWithMeta = {
      ...report.toObject(),
      assigneesCount: report.assignedTo?.length || 0,
      currentAssignees: report.assignedTo || [],
    };

    res.json({ success: true, data: reportWithMeta });
  } catch (error) {
    console.error('Error fetching report:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Delete maintenance report
// @route   DELETE /api/toll-maintenance/reports/:id
// @access  Private (Admin / Supervisor or Creator)
exports.deleteReport = async (req, res) => {
  try {
    const report = await TollMaintenanceReport.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // permission check
    if (
      report.reportedBy.toString() !== req.user.id &&
      ![USER_ROLES.ADMIN, USER_ROLES.EMPLOYEE].includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this report"
      });
    }

    // delete photos from cloudinary
    if (report.photos && report.photos.length > 0) {
      for (const photo of report.photos) {
        if (photo.publicId) {
          try {
            await deleteFromCloudinary(photo.publicId);
          } catch (err) {
            console.error("Cloudinary delete error:", err);
          }
        }
      }
    }

    // Delete all notifications associated with this report
    const InAppNotification = require('../models/Notification');
    const deleteResult = await InAppNotification.deleteMany({
      'data.reportId': report._id
    });

    console.log(`Deleted ${deleteResult.deletedCount} notifications associated with report ${report._id}`);

    const deletedReport = report.toObject();
    await report.deleteOne();

    res.json({
      success: true,
      message: "Report deleted successfully",
      data: deletedReport
    });

  } catch (error) {
    console.error("Error deleting report:", error);

    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// ==================== ASSIGNMENT ROUTES ====================

// @desc    Assign report
// In your maintenanceReportController.js - Update the assignReport function
// Backend - Update your assignReport controller
exports.assignReport = async (req, res) => {
  const startTime = Date.now();
  console.log(`[ASSIGN_REPORT] Starting report assignment process at ${new Date().toISOString()}`);

  try {
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    const reportId = req.params.id;

    let assigneeIds = req.body.assignedTo || [requesterId];
    if (!Array.isArray(assigneeIds)) {
      assigneeIds = [assigneeIds];
    }

    const notes = req.body.notes;
    const reassignmentReason = req.body.reassignmentReason;
    const sendEmail = req.body.sendEmail !== false;

    // Fetch assignees
    const assignees = await User.find({
      _id: { $in: assigneeIds },
      isActive: true
    });

    if (assignees.length !== assigneeIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more assignees are invalid or inactive'
      });
    }

    // Authorization checks (same as before)
    if (requesterRole === USER_ROLES.ADMIN) {
      const invalidAssignees = assignees.filter(a => a.role !== USER_ROLES.SUPERVISOR);
      if (invalidAssignees.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Admin can only assign reports to supervisors'
        });
      }
    }

    if (requesterRole === USER_ROLES.SUPERVISOR) {
      const isSelfAssignment = assigneeIds.length === 1 &&
        assigneeIds[0].toString() === requesterId.toString();

      const invalidAssignees = assignees.filter(a => a.role !== USER_ROLES.SUPERVISOR);
      if (invalidAssignees.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Supervisors can only assign reports to other supervisors'
        });
      }

      // For self-assignment, need to check if report is already assigned
      if (isSelfAssignment) {
        // CRITICAL: Atomic check and update for self-assignment
        console.log(`[ASSIGN_REPORT] Attempting atomic self-assignment for supervisor ${requesterId}`);
        
        // Use findOneAndUpdate with condition to prevent race conditions
        const updatedReport = await TollMaintenanceReport.findOneAndUpdate(
          {
            _id: reportId,
            // Only assign if report is unassigned OR currently assigned to this supervisor
            $or: [
              { assignedTo: { $exists: false } },
              { assignedTo: { $size: 0 } },
              { assignedTo: requesterId } // Already assigned to this supervisor
            ]
          },
          {
            $addToSet: { assignedTo: requesterId },
            $set: {
              status: REPORT_STATUS.ASSIGNED,
              updatedAt: new Date()
            },
            $push: {
              timeline: {
                status: REPORT_STATUS.ASSIGNED,
                changedBy: requesterId,
                changedAt: new Date(),
                notes: `Assigned to self by ${req.user.name}`
              }
            }
          },
          { new: true } // Return updated document
        );

        if (!updatedReport) {
          // Check if report exists and who it's assigned to
          const existingReport = await TollMaintenanceReport.findById(reportId);
          if (!existingReport) {
            return res.status(404).json({ success: false, message: ERROR_MESSAGES.NOT_FOUND });
          }
          
          // If already assigned to another supervisor, prevent self-assignment
          if (existingReport.assignedTo && existingReport.assignedTo.length > 0) {
            const assignedToNames = await User.find({ 
              _id: { $in: existingReport.assignedTo } 
            }).select('name');
            
            return res.status(409).json({
              success: false,
              message: `Cannot self-assign. Report is already assigned to: ${assignedToNames.map(u => u.name).join(', ')}`,
              code: 'ALREADY_ASSIGNED'
            });
          }
          
          return res.status(500).json({
            success: false,
            message: 'Failed to assign report due to concurrent update'
          });
        }

        // Success! Now populate and return
        await updatedReport.populate('plazaId', 'name location');
        await updatedReport.populate('assignedTo', 'name email role');
        await updatedReport.populate('reportedBy', 'name email');
        await updatedReport.populate('timeline.changedBy', 'name email');

        // Send notifications
        if (sendEmail) {
          await sendAssignmentEmail({
            report: updatedReport,
            assignee: req.user,
            assignedBy: req.user,
            isReassignment: false,
            notes: notes
          });
        }

        console.log(`[ASSIGN_REPORT] Self-assignment successful for ${req.user.name}`);
        
        return res.json({
          success: true,
          message: 'Report assigned to you successfully',
          data: updatedReport
        });
      } else {
        // Supervisor assigning to others - must be currently assigned to them
        const report = await TollMaintenanceReport.findById(reportId);
        if (!report) {
          return res.status(404).json({ success: false, message: ERROR_MESSAGES.NOT_FOUND });
        }

        const isCurrentlyAssigned = report.assignedTo?.some(
          id => id.toString() === requesterId.toString()
        );

        if (!isCurrentlyAssigned) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign reports that are currently assigned to you'
          });
        }
      }
    }

    // For ADMIN or SUPERVISOR assigning to others (non-self)
    // Use atomic update to prevent race conditions
    console.log(`[ASSIGN_REPORT] Performing atomic assignment to multiple assignees`);
    
    // First, get current state to detect if this is a reassignment
    const currentReport = await TollMaintenanceReport.findById(reportId);
    if (!currentReport) {
      return res.status(404).json({ success: false, message: ERROR_MESSAGES.NOT_FOUND });
    }
    
    const originalStatus = currentReport.status;
    const originalAssignees = [...(currentReport.assignedTo || [])];
    
    // Calculate new assignees
    const newAssignees = assigneeIds.filter(
      id => !originalAssignees.some(existingId => existingId.toString() === id.toString())
    );
    
    if (newAssignees.length === 0) {
      // Already assigned to all requested users
      return res.json({
        success: true,
        message: 'Report already assigned to these users',
        data: currentReport
      });
    }
    
    const isReassignment = originalStatus === REPORT_STATUS.ASSIGNED && newAssignees.length > 0;
    
    // Build update object
    const updateObject = {
      $addToSet: { assignedTo: { $each: assigneeIds } }, // Add without duplicates
      $set: {}
    };
    
    // Update status if needed
    if (originalStatus !== REPORT_STATUS.ASSIGNED) {
      updateObject.$set.status = REPORT_STATUS.ASSIGNED;
    }
    
    // Add reassignment details if needed
    if (isReassignment && reassignmentReason) {
      updateObject.$set.reassignmentDetails = {
        reason: reassignmentReason,
        reassignedBy: requesterId,
        reassignedAt: new Date(),
        fromAssignee: originalAssignees,
        notes: notes || ''
      };
    }
    
    // Add timeline entries for new assignees
    const timelineEntries = [];
    for (const assigneeId of newAssignees) {
      const assignee = assignees.find(a => a._id.toString() === assigneeId.toString());
      let timelineNote;
      
      if (assigneeId.toString() === requesterId.toString()) {
        timelineNote = `Assigned to self by ${req.user.name}`;
      } else if (isReassignment) {
        timelineNote = `Reassigned to ${assignee.name} by ${req.user.name}${reassignmentReason ? ` - Reason: ${reassignmentReason}` : ''}`;
      } else {
        timelineNote = notes || `Assigned to ${assignee.name}`;
      }
      
      timelineEntries.push({
        status: REPORT_STATUS.ASSIGNED,
        changedBy: requesterId,
        changedAt: new Date(),
        notes: timelineNote
      });
    }
    
    if (timelineEntries.length > 0) {
      updateObject.$push = { timeline: { $each: timelineEntries } };
    }
    
    // Perform atomic update
    const updatedReport = await TollMaintenanceReport.findOneAndUpdate(
      { _id: reportId },
      updateObject,
      { new: true } // Return updated document
    );
    
    if (!updatedReport) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update report'
      });
    }
    
    // Populate for response
    await updatedReport.populate('plazaId', 'name location');
    await updatedReport.populate('assignedTo', 'name email role');
    await updatedReport.populate('reportedBy', 'name email');
    await updatedReport.populate('timeline.changedBy', 'name email');
    
    // Send notifications for new assignees only
    let notificationsSent = 0;
    let emailsSent = 0;
    
    for (const assigneeId of newAssignees) {
      if (assigneeId.toString() === requesterId.toString()) {
        continue;
      }
      
      const assignee = assignees.find(a => a._id.toString() === assigneeId.toString());
      
      try {
        await NotificationService.sendAssignmentNotification(updatedReport, assignee, req.user);
        notificationsSent++;
        
        if (sendEmail) {
          await sendAssignmentEmail({
            report: updatedReport,
            assignee,
            assignedBy: req.user,
            isReassignment: isReassignment,
            reassignmentReason: isReassignment ? (reassignmentReason || notes) : null,
            notes: notes
          });
          emailsSent++;
        }
      } catch (error) {
        console.error(`Failed to send notification to ${assignee.email}:`, error);
      }
    }
    
    const responseTime = Date.now() - startTime;
    console.log(`[ASSIGN_REPORT] Assignment completed in ${responseTime}ms`);
    
    res.json({
      success: true,
      message: `Report ${isReassignment ? 'reassigned' : 'assigned'} to ${newAssignees.length} new user(s) successfully`,
      data: updatedReport
    });
    
  } catch (error) {
    console.error(`[ASSIGN_REPORT] Error:`, error);
    res.status(500).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
};


// @desc    Unassign a user from a report
// @route   PUT /api/toll-maintenance/reports/:id/unassign
// @access  Private (Supervisor/Admin only)
exports.unassignUser = async (req, res) => {
  try {
    const reportId = req.params.id;
    const { userIds, reason } = req.body; // userIds can be single ID or array
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    // Validate input
    let usersToUnassign = [];
    if (Array.isArray(userIds)) {
      usersToUnassign = userIds;
    } else if (userIds) {
      usersToUnassign = [userIds];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId(s) to unassign'
      });
    }

    // Fetch the report
    const report = await TollMaintenanceReport.findById(reportId)
      .populate('assignedTo', 'name email role')
      .populate('reportedBy', 'name email')
      .populate('plazaId', 'name');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // Check if report can be unassigned (only if not fixed/closed)
    const cannotUnassignStatuses = [REPORT_STATUS.FIXED, REPORT_STATUS.CLOSED, REPORT_STATUS.RESOLVED];
    if (cannotUnassignStatuses.includes(report.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot unassign users from a report that is ${report.status}. Report must be reopened first if issue persists.`
      });
    }

    // Check which users are currently assigned
    const currentAssignees = report.assignedTo || [];
    const validUsersToUnassign = usersToUnassign.filter(userId =>
      currentAssignees.some(assignee =>
        assignee._id.toString() === userId.toString()
      )
    );

    if (validUsersToUnassign.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'None of the specified users are currently assigned to this report'
      });
    }

    // Authorization check
    const isAdmin = requesterRole === USER_ROLES.ADMIN;
    const isSupervisor = requesterRole === USER_ROLES.SUPERVISOR;
    
    // Check if supervisor is authorized to unassign
    if (isSupervisor) {
      const isRequesterAssigned = currentAssignees.some(
        assignee => assignee._id.toString() === requesterId.toString()
      );
      
      if (!isRequesterAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You can only unassign users from reports that are currently assigned to you'
        });
      }
    }

    if (!isAdmin && !isSupervisor) {
      return res.status(403).json({
        success: false,
        message: 'Only supervisors and admins can unassign users from reports'
      });
    }

    // Get details of users being unassigned
    const unassignedUsers = validUsersToUnassign.map(userId => {
      const user = currentAssignees.find(a => a._id.toString() === userId.toString());
      return {
        _id: userId,
        name: user?.name || 'Unknown',
        email: user?.email || 'N/A'
      };
    });

    // Remove users from assignedTo array
    report.assignedTo = currentAssignees.filter(
      assignee => !validUsersToUnassign.some(id => id.toString() === assignee._id.toString())
    );

    // Add timeline entry for unassignment
    await exports.addTimelineEntry(
      report,
      report.status, // Keep current status
      requesterId,
      `User(s) unassigned: ${unassignedUsers.map(u => u.name).join(', ')}. Reason: ${reason || 'No reason provided'}`
    );

    // If no assignees left, revert status to OPEN
    let statusChanged = false;
    const previousStatus = report.status;
    
    if (report.assignedTo.length === 0) {
      report.status = REPORT_STATUS.OPEN;
      statusChanged = true;
      
      await exports.addTimelineEntry(
        report,
        REPORT_STATUS.OPEN,
        requesterId,
        `All assignees removed. Report status reverted to OPEN.`
      );
    }

    await report.save();

    // Populate for response
    await report.populate([
      { path: 'assignedTo', select: 'name email role' },
      { path: 'reportedBy', select: 'name email' },
      { path: 'plazaId', select: 'name' }
    ]);

    // Send notifications to unassigned users
    // for (const unassignedUser of unassignedUsers) {
    //   try {
    //     await NotificationService.sendUnassignmentNotification({
    //       report,
    //       unassignedUser,
    //       unassignedBy: req.user,
    //       reason: reason || 'No reason provided',
    //       wasLastAssignee: report.assignedTo.length === 0
    //     });
    //   } catch (notifError) {
    //     console.error(`Failed to send unassignment notification to ${unassignedUser.email}:`, notifError);
    //   }
    // }

    // Send status change notification if status changed
    if (statusChanged) {
      await NotificationService.sendStatusUpdateNotification(report, previousStatus, req.user);
    }

    // Emit real-time updates via Socket.io
    if (global.io) {
      const recipientIds = new Set();
      
      // Add unassigned users
      unassignedUsers.forEach(user => recipientIds.add(user._id.toString()));
      
      // Add remaining assignees
      if (report.assignedTo && report.assignedTo.length > 0) {
        report.assignedTo.forEach(assignee => {
          if (assignee._id) recipientIds.add(assignee._id.toString());
        });
      }
      
      // Add reporter
      if (report.reportedBy && report.reportedBy._id) {
        recipientIds.add(report.reportedBy._id.toString());
      }
      
      // Exclude requester
      recipientIds.delete(requesterId);
      
      recipientIds.forEach(recipientId => {
        global.io.to(`user_${recipientId}`).emit('user_unassigned', {
          reportId: report._id,
          reportNumber: report.reportId,
          unassignedUsers: unassignedUsers.map(u => ({ id: u._id, name: u.name })),
          unassignedBy: req.user.name,
          reason: reason || 'No reason provided',
          remainingAssignees: report.assignedTo.map(a => ({ id: a._id, name: a.name })),
          newStatus: report.status,
          timestamp: new Date()
        });
      });
    }

    res.json({
      success: true,
      message: `Successfully unassigned ${unassignedUsers.length} user(s) from report ${report.reportId}`,
      data: {
        report,
        unassignedUsers: unassignedUsers.map(u => ({ id: u._id, name: u.name })),
        remainingAssignees: report.assignedTo.map(a => ({ id: a._id, name: a.name })),
        statusChanged: statusChanged,
        newStatus: report.status
      }
    });

  } catch (error) {
    console.error('Error unassigning user from report:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};



// Add this as a method in your controller or as a separate helper function
exports.addTimelineEntry = async (report, status, userId, notes) => {
  if (!report.timeline) {
    report.timeline = [];
  }

  report.timeline.push({
    status: status,
    changedBy: userId,
    changedAt: new Date(),
    notes: notes || `Status updated to ${status}`
  });

  return report;
};


// ==================== STATUS MANAGEMENT ROUTES ====================
exports.updateReportStatus = async (req, res) => {
  try {
    const { status, notes, actualHours, actualCost } = req.body;

    const report = await TollMaintenanceReport.findById(req.params.id)
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // Check authorization
    if (!this.canUpdateReport(report, req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this report'
      });
    }

    // Validate status transition
    if (!this.isValidStatusTransition(report.status, status, req.user)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${report.status} to ${status}`
      });
    }

    const previousStatus = report.status;
    report.status = status;

    await this.addTimelineEntry(report, status, req.user.id,
      notes || `Status changed from ${previousStatus} to ${status} by ${req.user.name}`);

    // Update additional fields based on status
    if (status === REPORT_STATUS.IN_PROGRESS && !report.startedAt) {
      report.startedAt = Date.now();
    }

    if (status === REPORT_STATUS.FIXED && !report.fixedAt) {
      report.fixedAt = Date.now();
    }

    if (status === REPORT_STATUS.CLOSED && !report.closedAt) {
      report.closedAt = Date.now();
    }

    if (actualHours) report.actualHours = parseFloat(actualHours);
    if (actualCost) report.actualCost = parseFloat(actualCost);

    await report.save();
    await report.populate('assignedTo reportedBy', 'name email');

    // Send notification with update capability
    await NotificationService.sendStatusUpdateNotification(report, previousStatus, req.user);

    // Also send real-time update via Socket.io
    if (global.io) {
      // Emit to all users who should see this update
      const recipientIds = new Set();
      if (report.reportedBy && report.reportedBy._id) {
        recipientIds.add(report.reportedBy._id.toString());
      }
      if (report.assignedTo && report.assignedTo.length > 0) {
        report.assignedTo.forEach(assignee => {
          if (assignee._id) recipientIds.add(assignee._id.toString());
        });
      }

      recipientIds.forEach(recipientId => {
        global.io.to(`user_${recipientId}`).emit('report_status_updated', {
          reportId: report._id,
          reportNumber: report.reportId,
          previousStatus,
          newStatus: status,
          updatedBy: req.user.name,
          updatedAt: new Date(),
          notes: notes || null
        });
      });
    }

    res.json({
      success: true,
      message: `Report status updated from ${previousStatus} to ${status} successfully`,
      data: report
    });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
};


// @desc    Get updated notifications for a report
// @route   GET /api/toll-maintenance/reports/:id/notifications
// @access  Private
exports.getReportNotifications = async (req, res) => {
  try {
    const reportId = req.params.id;
    const userId = req.user.id;

    const notifications = await InAppNotification.find({
      'data.reportId': reportId,
      'recipient.userId': userId,
      isArchived: false
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching report notifications:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Mark report as fixed (by supervisor/assigned user)
// @route   PUT /api/toll-maintenance/reports/:id/mark-fixed
// @access  Private (Assigned user/Supervisor)
// @desc    Mark report as fixed (by supervisor/assigned user)
// @route   PUT /api/toll-maintenance/reports/:id/mark-fixed
// @access  Private (Assigned user/Supervisor)
exports.markAsFixed = async (req, res) => {
  try {
    const { fixSummary, rootCause, preventiveMeasures } = req.body;

    const report = await TollMaintenanceReport.findById(req.params.id)
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // Authorization check
    const isAssigned = report.assignedTo?.some(a => a._id.toString() === req.user.id);
    const isSupervisorOrAdmin = [USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN].includes(req.user.role);

    if (!isAssigned && !isSupervisorOrAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only assigned user, supervisor, or admin can mark report as fixed'
      });
    }

    // Status validation
    if (![REPORT_STATUS.IN_PROGRESS, REPORT_STATUS.ASSIGNED].includes(report.status)) {
      return res.status(400).json({
        success: false,
        message: 'Report must be in progress or assigned to mark as fixed'
      });
    }

    const previousStatus = report.status;

    // Handle fix photos
    const fixPhotos = (req.files || []).map(file => ({
      url: file.path || file.secure_url,
      publicId: file.filename || file.public_id,
      uploadedBy: req.user.id,
      uploadedAt: new Date(),
      fileSize: file.size,
      fileType: file.mimetype,
      caption: req.body[`caption_${file.fieldname}`] || req.body.caption || ''
    }));

    // Update report
    report.status = REPORT_STATUS.FIXED;
    report.fixedAt = Date.now();
    report.resolutionDetails = {
      summary: fixSummary,
      rootCause: rootCause || '',
      preventiveMeasures: preventiveMeasures || '',
      resolvedBy: req.user.id,
      resolvedAt: new Date(),
      resolutionPhotos: fixPhotos.map(p => ({
        url: p.url,
        caption: p.caption,
        uploadedAt: p.uploadedAt
      }))
    };

    // Add timeline entry
    await this.addTimelineEntry(
      report,
      REPORT_STATUS.FIXED,
      req.user.id,
      `Issue fixed and ready for verification: ${fixSummary}`
    );

    await report.save();
    await report.populate('reportedBy assignedTo', 'name email');

    // ✅ Send status update notification - ONLY to assigned users
    await NotificationService.sendStatusUpdateNotification(report, previousStatus, req.user);

    // ✅ Send dedicated "fixed for verification" notification - ONLY to assigned users
    // ❌ REMOVED the reporter from recipients
    await NotificationService.sendFixedForVerificationNotification({
      report,
      fixedBy: req.user,
      recipients: [...(report.assignedTo || [])].filter(Boolean), // Only assigned users
    });

    // Emit real-time update via Socket.io - ONLY to assigned users
    if (global.io) {
      const recipientIds = new Set();

      if (report.assignedTo && report.assignedTo.length > 0) {
        report.assignedTo.forEach(assignee => {
          if (assignee._id) recipientIds.add(assignee._id.toString());
        });
      }

      // ✅ Remove the current user (the fixer)
      recipientIds.delete(req.user.id);

      // Send to remaining recipients
      recipientIds.forEach(recipientId => {
        global.io.to(`user_${recipientId}`).emit('report_fixed', {
          reportId: report._id,
          reportNumber: report.reportId,
          fixedBy: req.user.name,
          fixedAt: new Date(),
          summary: fixSummary
        });
      });
    }

    res.json({
      success: true,
      message: 'Report marked as fixed and ready for verification',
      data: report
    });

  } catch (error) {
    console.error('Error marking report as fixed:', error);
    res.status(500).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
};


// @desc    Resolve report (legacy - now redirects to markAsFixed)
// @route   PUT /api/toll-maintenance/reports/:id/resolve
// @access  Private
exports.resolveReport = async (req, res) => {
  try {
    const { resolutionSummary, rootCause, preventiveMeasures, partsUsed } = req.body;

    // Transform request to match markAsFixed format
    req.body.fixSummary = resolutionSummary;
    req.body.rootCause = rootCause;
    req.body.preventiveMeasures = preventiveMeasures;
    req.body.partsUsed = partsUsed;

    // Call markAsFixed
    return exports.markAsFixed(req, res);
  } catch (error) {
    console.error('Error resolving report:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Close report (by employee who created it)
// @route   PUT /api/toll-maintenance/reports/:id/close
// @access  Private (Reporter only)
exports.closeReport = async (req, res) => {
  try {
    const { satisfaction, feedback, verificationNotes, followUpRequired, followUpNotes } = req.body;

    const report = await TollMaintenanceReport.findById(req.params.id)
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // Check if user is the original reporter
    if (report.reportedBy._id.toString() !== req.user.id && req.user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only the original reporter can close this report'
      });
    }

    // Validate current status
    if (report.status !== REPORT_STATUS.FIXED) {
      return res.status(400).json({
        success: false,
        message: 'Report must be in FIXED status before closing'
      });
    }

    const previousStatus = report.status;

    // Add verification photos if any
    const verificationPhotos = (req.files || []).map(file => ({
      url: file.path || file.secure_url,
      publicId: file.filename || file.public_id,
      caption: 'Post-fix verification',
      uploadedBy: req.user.id,
      uploadedAt: new Date(),
      fileSize: file.size,
      fileType: file.mimetype
    }));

    // Determine final status based on satisfaction
    let finalStatus = REPORT_STATUS.CLOSED;
    if (satisfaction === 'unsatisfied') {
      finalStatus = REPORT_STATUS.REOPENED;
    } else if (satisfaction === 'partial' && followUpRequired) {
      finalStatus = REPORT_STATUS.REOPENED;
    }

    // Update report
    report.status = finalStatus;
    report.closedAt = Date.now();
    report.closureDetails = {
      closedBy: req.user.id,
      satisfaction: satisfaction,
      feedback: feedback || '',
      verificationNotes: verificationNotes || '',
      verifiedAt: new Date(),
      verificationPhotos: verificationPhotos,
      followUpRequired: followUpRequired || false,
      followUpNotes: followUpNotes || ''
    };

    // If reopened, set reopen details
    if (finalStatus === REPORT_STATUS.REOPENED) {
      report.reopenedAt = Date.now();
      report.reopenDetails = {
        reopenedBy: req.user.id,
        reason: satisfaction === 'unsatisfied' ? 'Issue still persists' : 'Partial fix, follow-up required',
        additionalDetails: feedback || '',
        previousStatus: REPORT_STATUS.FIXED,
        reopenedAt: new Date(),
        photos: verificationPhotos
      };
    }

    await this.addTimelineEntry(report, finalStatus, req.user.id,
      `Report ${finalStatus} by original reporter. Satisfaction: ${satisfaction}`);

    await report.save();
    await report.populate('reportedBy assignedTo', 'name email');

    // ✅ Send status update notification - ONLY to assigned users
    await NotificationService.sendStatusUpdateNotification(report, previousStatus, req.user);

    // Send appropriate notification based on outcome - ONLY to assigned users
    if (finalStatus === REPORT_STATUS.REOPENED) {
      await NotificationService.sendReportReopenedNotification(report, req.user,
        satisfaction === 'unsatisfied' ? 'Issue still persists after fix' : 'Partial fix, follow-up required');
    } else {
      await NotificationService.sendReportClosedNotification({
        report,
        closedBy: req.user,
        satisfaction,
        recipient: report.reportedBy  // This will be filtered in the notification service
      });
    }

    // Update lane status if fully satisfied
    if (report.laneNumber && satisfaction === 'satisfied') {
      await TollPlaza.findOneAndUpdate(
        {
          _id: report.plazaId,
          'lanes.laneNumber': report.laneNumber
        },
        {
          $set: {
            'lanes.$.status': 'operational',
            'lanes.$.lastMaintenance': Date.now()
          }
        }
      );
    }

    // Emit real-time update via Socket.io - ONLY to assigned users
    if (global.io) {
      const recipientIds = new Set();

      // ✅ ONLY add assigned users (not the reporter)
      if (report.assignedTo && report.assignedTo.length > 0) {
        console.log('📋 Sending socket events to assigned users:',
          report.assignedTo.map(a => a._id.toString()));

        report.assignedTo.forEach(assignee => {
          if (assignee._id) recipientIds.add(assignee._id.toString());
        });
      }

      // ❌ REMOVED - Don't add reporter automatically
      // if (report.reportedBy && report.reportedBy._id) {
      //   recipientIds.add(report.reportedBy._id.toString());
      // }

      const eventName = finalStatus === REPORT_STATUS.REOPENED ? 'report_reopened' : 'report_closed';

      recipientIds.forEach(recipientId => {
        global.io.to(`user_${recipientId}`).emit(eventName, {
          reportId: report._id,
          reportNumber: report.reportId,
          closedBy: req.user.name,
          closedAt: new Date(),
          satisfaction: satisfaction,
          finalStatus: finalStatus
        });
      });

      console.log(`✅ Socket events sent to ${recipientIds.size} assigned user(s)`);
    }

    res.json({
      success: true,
      message: finalStatus === REPORT_STATUS.REOPENED ? 'Report reopened for follow-up' : 'Report closed successfully',
      data: report
    });
  } catch (error) {
    console.error('Error closing report:', error);
    res.status(500).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
};

// @desc    Reopen report (by employee if issue persists)
// @route   PUT /api/toll-maintenance/reports/:id/reopen
// @access  Private (Reporter only)
exports.reopenReport = async (req, res) => {
  try {
    const { reason, additionalDetails, issuePersists, newSymptoms } = req.body;

    const report = await TollMaintenanceReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    // Check if user is the original reporter
    if (report.reportedBy.toString() !== req.user.id && req.user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only the original reporter can reopen this report'
      });
    }

    // Can reopen from FIXED or CLOSED status
    if (![REPORT_STATUS.FIXED, REPORT_STATUS.CLOSED].includes(report.status)) {
      return res.status(400).json({
        success: false,
        message: 'Report can only be reopened from FIXED or CLOSED status'
      });
    }

    // Store previous status for reference
    const previousStatus = report.status;

    // Add new photos if any
    const additionalPhotos = (req.files || []).map(file => ({
      url: file.path || file.secure_url,
      publicId: file.filename || file.public_id,
      caption: `Reopen evidence: ${reason}`,
      uploadedBy: req.user.id,
      uploadedAt: new Date(),
      fileSize: file.size,
      fileType: file.mimetype
    }));

    // Update report
    report.status = REPORT_STATUS.REOPENED;
    report.reopenedAt = Date.now();
    report.reopenDetails = {
      reopenedBy: req.user.id,
      reason: reason,
      additionalDetails: additionalDetails || '',
      issuePersists: issuePersists || true,
      newSymptoms: newSymptoms || '',
      previousStatus: previousStatus,
      reopenedAt: new Date(),
      photos: additionalPhotos
    };

    // Reset assignment if needed
    if (!report.assignedTo) {
      // Auto-assign to original fixer or supervisor
      if (report.fixDetails?.fixedBy) {
        report.assignedTo = report.fixDetails.fixedBy;
      } else {
        const supervisor = await User.findOne({
          role: USER_ROLES.SUPERVISOR,
          isActive: true
        });
        if (supervisor) {
          report.assignedTo = supervisor._id;
        }
      }
    }

    await this.addTimelineEntry(report, REPORT_STATUS.REOPENED, req.user.id,
      `Report reopened: ${reason}`);

    await report.save();
    await report.populate('reportedBy assignedTo', 'name email');

    // Update lane status to maintenance
    if (report.laneNumber) {
      await TollPlaza.findOneAndUpdate(
        {
          _id: report.plazaId,
          'lanes.laneNumber': report.laneNumber
        },
        {
          $set: {
            'lanes.$.status': 'maintenance'
          }
        }
      );
    }

    // Send notification
    await NotificationService.sendReportReopenedNotification(report, req.user, reason);

    res.json({
      success: true,
      message: 'Report reopened successfully',
      data: report
    });
  } catch (error) {
    console.error('Error reopening report:', error);
    res.status(500).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
};

// ==================== COMMENT ROUTES ====================

// @desc    Add comment
// @route   POST /api/toll-maintenance/reports/:id/comments
// @access  Private
exports.addComment = async (req, res) => {
  try {
    console.log('👉 [ADD COMMENT] Request received');

    const { id } = req.params;
    const { text = '', isInternal = false } = req.body;
    const userId = req.user.id;

    console.log('📌 Report ID:', id);
    console.log('👤 User ID:', userId);
    console.log('📝 Text:', text);
    console.log('🔒 Internal:', isInternal);

    // Process uploaded files if any
    let uploadedPhotos = [];
    if (req.files && req.files.length > 0) {
      console.log(`📸 ${req.files.length} files uploaded`);

      uploadedPhotos = req.files.map(file => ({
        url: file.path,
        publicId: file.filename || file.public_id,
        caption: '',
        uploadedAt: new Date()
      }));
    }

    // Photos from body
    let bodyPhotos = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      console.log(`📸 ${req.body.photos.length} photos from body`);
      bodyPhotos = req.body.photos;
    }

    const allPhotos = [...uploadedPhotos, ...bodyPhotos];
    console.log('📊 Total photos:', allPhotos.length);

    // Validation
    if (!text.trim() && allPhotos.length === 0) {
      console.warn('⚠️ Validation failed: No text or photos');

      return res.status(400).json({
        success: false,
        message: 'Comment must have text or at least one image'
      });
    }

    if (allPhotos.length > 0) {
      const invalidPhoto = allPhotos.find(p => !p.url);
      if (invalidPhoto) {
        console.warn('⚠️ Invalid photo detected');

        return res.status(400).json({
          success: false,
          message: 'Each photo must have a url'
        });
      }
    }

    console.log('🔍 Fetching report...');
    const report = await TollMaintenanceReport.findById(id)
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email role')
      .populate('plazaId', 'name code');

    if (!report) {
      console.error('❌ Report not found');

      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    console.log('✅ Report found:', report._id);

    const comment = {
      user: userId,
      text: text.trim() || '',
      isInternal,
      photos: allPhotos.map(p => ({
        url: p.url,
        publicId: p.publicId || null,
        caption: p.caption || '',
        uploadedAt: new Date()
      })),
      createdAt: new Date()
    };

    report.comments = report.comments || [];
    report.comments.push(comment);

    console.log('💬 Comment added to report');

    report.activityLog = report.activityLog || [];
    report.activityLog.push({
      action: 'comment_added',
      performedBy: userId,
      performedByName: req.user.name,
      details: {
        content: text.substring(0, 100),
        isInternal,
        photoCount: allPhotos.length
      },
      timestamp: new Date()
    });

    await report.save();
    console.log('💾 Report saved successfully');

    const populatedReport = await TollMaintenanceReport.findById(id)
      .populate('comments.user', 'name email role');

    const newComment = populatedReport.comments[populatedReport.comments.length - 1];

    console.log('🎯 New comment ID:', newComment._id);

    const formattedComment = {
      _id: newComment._id,
      text: newComment.text || '',
      photos: newComment.photos || [],
      isInternal: newComment.isInternal,
      createdAt: newComment.createdAt,
      user: newComment.user,
      authorName: newComment.user?.name || req.user.name,
      authorRole: newComment.user?.role || req.user.role
    };

    // 🔔 Notifications
    // 🔔 Notifications - ONLY to assigned users
    try {
      console.log('🔔 Preparing notifications...');

      const recipients = new Set();

      // ✅ ONLY add assigned users (no admins, no reporter unless assigned)
      if (Array.isArray(report.assignedTo)) {
        console.log('📋 Assigned users:', report.assignedTo.map(a => ({
          id: a?._id?.toString(),
          name: a?.name,
          role: a?.role
        })));

        report.assignedTo.forEach(assigned => {
          if (assigned?._id) {
            recipients.add(assigned._id.toString());
          }
        });
      }

      // Optional: Add reporter ONLY if they are also assigned to the report
      // Comment this out if you don't want reporter to get notifications
      if (report.reportedBy?._id) {
        const isReporterAssigned = Array.isArray(report.assignedTo) &&
          report.assignedTo.some(a => a?._id?.toString() === report.reportedBy._id.toString());

        if (isReporterAssigned) {
          recipients.add(report.reportedBy._id.toString());
        }
      }

      // Remove the comment author from recipients
      recipients.delete(userId);

      console.log('👥 Final recipients (assigned users only):', Array.from(recipients));
      console.log('📊 Total recipients:', recipients.size);

      if (recipients.size > 0) {
        const recipientUsers = await User.find({
          _id: { $in: Array.from(recipients) }
        }).select('_id name email role');

        if (recipientUsers?.length > 0 && notificationService) {
          await notificationService.sendCommentNotification({
            report: report.toObject(),
            comment: {
              _id: newComment._id,
              text: newComment.text,
              photos: newComment.photos || []
            },
            commentAuthor: {
              _id: userId,
              name: req.user.name,
              email: req.user.email
            },
            recipients: recipientUsers
          });

          console.log('✅ Notifications sent to assigned users');
        } else {
          console.log('⚠️ No valid recipients found among assigned users');
        }
      } else {
        console.log('ℹ️ No assigned users to notify');
      }
    } catch (notifError) {
      console.error('❌ Notification error:', notifError.message);
    }

    // ⚡ Socket
    try {
      if (global.io) {
        console.log('⚡ Emitting socket events');

        const involvedUsers = new Set();

        if (report.reportedBy?._id)
          involvedUsers.add(report.reportedBy._id.toString());

        if (report.assignedTo) {
          report.assignedTo.forEach(a => {
            if (a?._id) involvedUsers.add(a._id.toString());
          });
        }

        involvedUsers.delete(userId);

        involvedUsers.forEach(id => {
          global.io.to(`user_${id}`).emit('new_comment', {
            reportId: report._id,
            comment: {
              id: newComment._id,
              text: newComment.text
            }
          });
        });

        console.log('✅ Socket events emitted');
      }
    } catch (socketError) {
      console.error('❌ Socket error:', socketError.message);
    }

    console.log('🎉 Comment added successfully');

    res.status(201).json({
      success: true,
      data: formattedComment,
      message: 'Comment added successfully'
    });

  } catch (error) {
    console.error('🔥 Fatal error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
};

// Delete comment
// @route DELETE /api/maintenance/reports/:id/comments/:commentId
// @access Private
exports.deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;

    const report = await TollMaintenanceReport.findById(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    const comment = report.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found"
      });
    }

    // store deleted comment
    const deletedComment = comment.toObject();

    // delete it
    comment.deleteOne();

    await report.save();

    res.json({
      success: true,
      message: "Comment deleted successfully",
      data: deletedComment
    });

  } catch (error) {
    console.error("Error deleting comment:", error);

    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};


// @desc    Delete photo
// @route   DELETE /api/toll-maintenance/reports/:id/photos/:photoId
// @access  Private
exports.deletePhoto = async (req, res) => {
  try {
    const report = await TollMaintenanceReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    const photo = report.photos.id(req.params.photoId);
    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Check authorization (only uploader or admin can delete)
    if (photo.uploadedBy.toString() !== req.user.id && req.user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own photos'
      });
    }

    // Delete from Cloudinary if applicable
    if (photo.publicId) {
      await deleteFromCloudinary(photo.publicId).catch(console.error);
    }

    photo.remove();
    await report.save();

    res.json({
      success: true,
      message: 'Photo deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// ==================== USER-SPECIFIC REPORT ROUTES ====================

// @desc    Get reports assigned to the logged-in user
// @route   GET /api/toll-maintenance/reports/my-assignments
// @access  Private
exports.getMyAssignedReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, priority, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Convert to numbers (important)
    const pageNumber = Math.max(parseInt(page), 1);
    const limitNumber = Math.max(parseInt(limit), 1);
    const skip = (pageNumber - 1) * limitNumber;

    // Query where user is in the assignedTo array
    const query = { assignedTo: userId };

    if (status) query.status = status;
    if (priority) query.priority = priority;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Run both queries in parallel (faster ⚡)
    const [reports, total] = await Promise.all([
      TollMaintenanceReport.find(query)
        .populate('reportedBy', 'name email')
        .populate('plazaId', 'name')
        .populate('assignedTo', 'name email')
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNumber)
        .lean(),

      TollMaintenanceReport.countDocuments(query)
    ]);

    // Summary should ideally be from ALL matching docs (not just page)
    const allReports = await TollMaintenanceReport.find(query)
      .select('status assignedTo')
      .lean();

    const summary = {
      total: total,
      pending: allReports.filter(r => r.status === REPORT_STATUS.ASSIGNED).length,
      inProgress: allReports.filter(r => r.status === REPORT_STATUS.IN_PROGRESS).length,
      fixed: allReports.filter(r => r.status === REPORT_STATUS.FIXED).length,
      reopened: allReports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
      teamAssignments: allReports.filter(r => r.assignedTo.length > 1).length
    };

    res.json({
      success: true,
      data: {
        reports,
        summary,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
          hasNextPage: pageNumber < Math.ceil(total / limitNumber),
          hasPrevPage: pageNumber > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching my assigned reports:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get reports created by the logged-in user
// @route   GET /api/toll-maintenance/reports/my-reports
// @access  Private
exports.getMyCreatedReports = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      status,
      priority,
      issueType,
      plazaId,
      startDate,
      endDate,
      sortBy = '-createdAt',
      page = 1,
      limit = 10
    } = req.query;

    // Build query
    const query = { reportedBy: userId };

    // Apply filters
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (issueType) query.issueType = issueType;
    if (plazaId) query.plazaId = plazaId;

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Execute queries
    const [reports, total] = await Promise.all([
      TollMaintenanceReport.find(query)
        .populate('plazaId', 'name') // Only name exists
        .populate('assignedTo', 'name email')
        .populate('resolutionDetails.resolvedBy', 'name email')
        .select('-__v')
        .sort(sortBy)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TollMaintenanceReport.countDocuments(query)
    ]);

    // Calculate summary statistics
    const summary = {
      total: total,
      open: reports.filter(r => r.status === REPORT_STATUS.OPEN).length,
      inProgress: reports.filter(r => r.status === REPORT_STATUS.IN_PROGRESS).length,
      assigned: reports.filter(r => r.status === REPORT_STATUS.ASSIGNED).length,
      fixed: reports.filter(r => r.status === REPORT_STATUS.FIXED).length,
      reopened: reports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
      closed: reports.filter(r => r.status === REPORT_STATUS.CLOSED).length,
      byPriority: {
        low: reports.filter(r => r.priority === 'low').length,
        medium: reports.filter(r => r.priority === 'medium').length,
        high: reports.filter(r => r.priority === 'high').length,
        critical: reports.filter(r => r.priority === 'critical').length
      }
    };

    res.json({
      success: true,
      data: {
        reports,
        summary,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching my created reports:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching your reports',
      error: error.message
    });
  }
};

// ==================== DASHBOARD ROUTES ====================

// @desc    Get dashboard data based on user role
// @route   GET /api/toll-maintenance/dashboard
// @access  Private
exports.getDashboard = async (req, res) => {
  try {
    const user = req.user;
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let dashboardData = {};

    // Common data for all users
    const commonData = await exports.getCommonDashboardData(user, {
      startOfToday,
      startOfWeek,
      startOfMonth
    });

    dashboardData = { ...commonData };

    // Role-specific data
    if (user.role === USER_ROLES.EMPLOYEE) {
      const employeeData = await exports.getEmployeeDashboardData(user.id, {
        startOfToday,
        startOfWeek,
        startOfMonth
      });
      dashboardData = { ...dashboardData, ...employeeData };
    }
    else if (user.role === USER_ROLES.SUPERVISOR) {
      const supervisorData = await exports.getSupervisorDashboardData(user.id, {
        startOfToday,
        startOfWeek,
        startOfMonth
      });
      dashboardData = { ...dashboardData, ...supervisorData };
    }
    else if (user.role === USER_ROLES.ADMIN) {
      const adminData = await exports.getAdminDashboardData({
        startOfToday,
        startOfWeek,
        startOfMonth
      });
      dashboardData = { ...dashboardData, ...adminData };
    }

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};



// @desc    Get plaza maintenance summary
// @route   GET /api/toll-maintenance/plaza/:plazaId/summary
// @access  Private
exports.getPlazaMaintenanceSummary = async (req, res) => {
  try {
    const plaza = await TollPlaza.findById(req.params.plazaId);
    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const reports = await TollMaintenanceReport.find({
      plazaId: req.params.plazaId,
      createdAt: { $gte: thirtyDaysAgo }
    });

    const summary = {
      plazaName: plaza.name,
      totalReports: reports.length,
      openReports: reports.filter(r => r.status === REPORT_STATUS.OPEN).length,
      inProgress: reports.filter(r => r.status === REPORT_STATUS.IN_PROGRESS).length,
      fixed: reports.filter(r => r.status === REPORT_STATUS.FIXED).length,
      reopened: reports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
      resolved: reports.filter(r => r.status === REPORT_STATUS.RESOLVED).length,
      closed: reports.filter(r => r.status === REPORT_STATUS.CLOSED).length,
      byEquipmentType: {},
      totalCost: reports.reduce((sum, r) => sum + (r.actualCost || 0), 0),
      averageSatisfaction: this.calculateAverageSatisfaction(reports),
      laneStatus: plaza.lanes.reduce((acc, lane) => {
        acc[lane.laneNumber] = lane.status;
        return acc;
      }, {})
    };

    reports.forEach(report => {
      if (report.equipmentType) {
        summary.byEquipmentType[report.equipmentType] =
          (summary.byEquipmentType[report.equipmentType] || 0) + 1;
      }
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Error fetching plaza summary:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// ==================== HELPER METHODS ====================

exports.buildReportQuery = (user, filters) => {
  const query = {};

  // Apply direct filters
  const filterFields = [
    'status',
    'priority',
    'issueType',
    'severity',
    'plazaId',
    'equipmentType'
  ];

  filterFields.forEach(field => {
    if (filters[field]) query[field] = filters[field];
  });

  // Lane number
  if (filters.laneNumber) {
    query.laneNumber = parseInt(filters.laneNumber);
  }

  // Assigned/Reported by (only if explicitly passed)
  if (filters.reportedBy) query.reportedBy = filters.reportedBy;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;

  // Date range
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endDate;
    }
  }

  // Search (safe implementation)
  if (filters.search) {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { title: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
        { reportId: { $regex: filters.search, $options: 'i' } }
      ]
    });
  }

  return query;
};

// Update the isUserAuthorized method
exports.isUserAuthorized = (report, user) => {
  if (user.role === USER_ROLES.ADMIN) return true;
  if (user.role === USER_ROLES.SUPERVISOR) return true;
  if (report.reportedBy.toString() === user.id) return true;
  // Check if user is in the assignedTo array
  if (report.assignedTo && Array.isArray(report.assignedTo)) {
    if (report.assignedTo.some(id => id && id.toString() === user.id)) return true;
  }
  return false;
};

// Update the canUpdateReport method
exports.canUpdateReport = (report, user) => {
  if (user.role === USER_ROLES.ADMIN) return true;

  // Check if user is in the assignedTo array
  const isAssigned = report.assignedTo && Array.isArray(report.assignedTo) &&
    report.assignedTo.some(id => id && id.toString() === user.id);

  if (isAssigned) return true;

  if (report.reportedBy.toString() === user.id &&
    [REPORT_STATUS.FIXED, REPORT_STATUS.REOPENED, REPORT_STATUS.CLOSED].includes(report.status)) {
    return true;
  }

  return false;
};

exports.isValidStatusTransition = (currentStatus, newStatus, user) => {
  // Define valid transitions
  const validTransitions = {
    [REPORT_STATUS.OPEN]: [REPORT_STATUS.ASSIGNED, REPORT_STATUS.CLOSED],
    [REPORT_STATUS.ASSIGNED]: [REPORT_STATUS.IN_PROGRESS, REPORT_STATUS.FIXED, REPORT_STATUS.REOPENED],
    [REPORT_STATUS.IN_PROGRESS]: [REPORT_STATUS.FIXED, REPORT_STATUS.REOPENED],
    [REPORT_STATUS.FIXED]: [REPORT_STATUS.CLOSED, REPORT_STATUS.REOPENED],
    [REPORT_STATUS.REOPENED]: [REPORT_STATUS.ASSIGNED, REPORT_STATUS.IN_PROGRESS, REPORT_STATUS.FIXED],
    [REPORT_STATUS.CLOSED]: [REPORT_STATUS.REOPENED]
  };

  return validTransitions[currentStatus]?.includes(newStatus) || false;
};

exports.addTimelineEntry = async (report, status, userId, notes) => {
  report.timeline.push({
    status,
    changedBy: userId,
    changedAt: new Date(),
    notes
  });
};

exports.generateStatistics = async (query) => {
  const reports = await TollMaintenanceReport.find(query);

  // Count reports by status (case-insensitive)
  const byStatus = {
    open: 0,
    assigned: 0,
    inProgress: 0,
    fixed: 0,
    reopened: 0,
    resolved: 0,
    closed: 0
  };

  // Count reports by priority
  const byPriority = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };

  // Count by issue type
  const byIssueType = {};

  // Count by equipment type
  const byEquipmentType = {};

  let totalEstimatedCost = 0;
  let totalActualCost = 0;
  let totalResolutionTime = 0;
  let resolvedCount = 0;
  let reopenedCount = 0;
  let satisfiedCount = 0;
  let satisfactionCount = 0;

  for (const report of reports) {
    // Status counting - FIX: Use lowercase for consistency
    const status = report.status?.toLowerCase();
    if (byStatus.hasOwnProperty(status)) {
      byStatus[status]++;
    } else if (status === 'in_progress') {
      byStatus.inProgress++;
    }

    // Priority counting
    const priority = report.priority?.toLowerCase();
    if (byPriority.hasOwnProperty(priority)) {
      byPriority[priority]++;
    }

    // Issue type counting
    const issueType = report.issueType?.toLowerCase();
    if (issueType) {
      byIssueType[issueType] = (byIssueType[issueType] || 0) + 1;
    }

    // Equipment type counting
    const equipmentType = report.equipmentType?.toLowerCase();
    if (equipmentType) {
      byEquipmentType[equipmentType] = (byEquipmentType[equipmentType] || 0) + 1;
    }

    // Financials
    totalEstimatedCost += (report.costEstimate || 0);
    totalActualCost += (report.actualCost || 0);

    // Resolution time calculation (FIXED or CLOSED)
    const endDate = report.closedAt || report.fixedAt || report.resolvedAt;
    if (endDate && report.createdAt) {
      const resolutionTime = (new Date(endDate) - new Date(report.createdAt)) / (1000 * 60 * 60);
      totalResolutionTime += resolutionTime;
      resolvedCount++;
    }

    // Reopened rate
    if (status === 'reopened') {
      reopenedCount++;
    }

    // Satisfaction rate
    if (report.closureDetails?.satisfaction) {
      satisfactionCount++;
      if (report.closureDetails.satisfaction === 'satisfied') {
        satisfiedCount++;
      }
    }
  }

  return {
    total: reports.length,
    byStatus,
    byPriority,
    byIssueType,
    byEquipmentType,
    totalEstimatedCost,
    totalActualCost,
    averageResolutionTime: resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount) : 0,
    reopenedRate: reports.length > 0 ? Math.round((reopenedCount / reports.length) * 100) : 0,
    satisfactionRate: satisfactionCount > 0 ? Math.round((satisfiedCount / satisfactionCount) * 100) : 0
  };
};

exports.calculateAverageResolutionTime = (reports) => {
  const resolvedReports = reports.filter(r => r.fixedAt || r.closedAt);
  if (resolvedReports.length === 0) return 0;

  const totalTime = resolvedReports.reduce((sum, r) => {
    const endTime = r.closedAt || r.fixedAt || r.resolvedAt;
    return sum + (new Date(endTime) - new Date(r.createdAt));
  }, 0);

  return Math.round(totalTime / resolvedReports.length / (1000 * 60 * 60)); // hours
};

exports.calculateReopenedRate = (reports) => {
  const closedReports = reports.filter(r => r.status === REPORT_STATUS.CLOSED);
  const reopenedReports = reports.filter(r => r.status === REPORT_STATUS.REOPENED);

  if (closedReports.length === 0) return 0;
  return Math.round((reopenedReports.length / closedReports.length) * 100);
};

exports.calculateSatisfactionRate = (reports) => {
  const reportsWithSatisfaction = reports.filter(r => r.closureDetails?.satisfaction);
  if (reportsWithSatisfaction.length === 0) return 0;

  const satisfied = reportsWithSatisfaction.filter(r =>
    r.closureDetails.satisfaction === 'satisfied'
  ).length;

  return Math.round((satisfied / reportsWithSatisfaction.length) * 100);
};

exports.calculateAverageSatisfaction = (reports) => {
  const reportsWithSatisfaction = reports.filter(r => r.closureDetails?.satisfaction);
  if (reportsWithSatisfaction.length === 0) return 'N/A';

  const counts = {
    satisfied: reportsWithSatisfaction.filter(r => r.closureDetails.satisfaction === 'satisfied').length,
    partial: reportsWithSatisfaction.filter(r => r.closureDetails.satisfaction === 'partial').length,
    unsatisfied: reportsWithSatisfaction.filter(r => r.closureDetails.satisfaction === 'unsatisfied').length
  };

  return counts;
};

exports.calculateAverageReopenTime = (reports) => {
  const reopenedReports = reports.filter(r => r.reopenedAt);
  if (reopenedReports.length === 0) return 0;

  const totalTime = reopenedReports.reduce((sum, r) => {
    const previousFixTime = r.fixDetails?.fixedAt || r.fixedAt;
    if (!previousFixTime) return sum;
    return sum + (new Date(r.reopenedAt) - new Date(previousFixTime));
  }, 0);

  return Math.round(totalTime / reopenedReports.length / (1000 * 60 * 60 * 24)); // days
};

exports.groupByPlaza = (reports) => {
  const grouped = {};
  reports.forEach(report => {
    const plazaId = report.plazaId?._id || report.plazaId;
    const plazaName = report.plazaId?.name || 'Unknown';

    if (!grouped[plazaId]) {
      grouped[plazaId] = {
        plazaName,
        count: 0,
        reports: []
      };
    }

    grouped[plazaId].count++;
    grouped[plazaId].reports.push(report);
  });

  return Object.values(grouped);
};

// ==================== DASHBOARD HELPER METHODS ====================

const getTeamWorkloadData = async (plazaId = null, dateRange = null) => {
  try {
    const [workload, distribution, overdueTasks] = await Promise.all([
      TollMaintenanceReport.getTeamWorkload(plazaId, dateRange?.start, dateRange?.end),
      TollMaintenanceReport.getWorkloadDistribution(plazaId),
      TollMaintenanceReport.getOverdueTasks()
    ]);

    // Sort workload by totalReports (highest first)
    const sortedWorkload = [...workload].sort((a, b) => 
      (b.totalReports || 0) - (a.totalReports || 0)
    );

    // Calculate team summary using sortedWorkload if needed,
    // but summary should use the same sorted data
    const teamSummary = {
      totalActiveReports: sortedWorkload.reduce((sum, w) => sum + (w.openReports || 0), 0),
      totalTeamMembers: sortedWorkload.length,
      averageWorkloadScore: sortedWorkload.length > 0
        ? sortedWorkload.reduce((sum, w) => sum + (w.workloadScore || 0), 0) / sortedWorkload.length
        : 0,
      averageCompletionRate: sortedWorkload.length > 0
        ? sortedWorkload.reduce((sum, w) => sum + (w.completionRate || 0), 0) / sortedWorkload.length
        : 0,
      totalOverdueTasks: overdueTasks.reduce((sum, t) => sum + (t.overdueReports?.length || 0), 0),
      workloadDistribution: distribution
    };

    return {
      teamWorkload: sortedWorkload,
      workloadDistribution: distribution,
      overdueTasks: overdueTasks,
      teamSummary: teamSummary
    };
  } catch (error) {
    console.error('Error fetching team workload:', error);
    throw error;
  }
};

// Get common dashboard data for all users
exports.getCommonDashboardData = async (user, dateRanges) => {
  const { startOfToday, startOfWeek, startOfMonth } = dateRanges;

  // Get all plazas for reference
  const plazas = await TollPlaza.find().select('name').lean();

  let teamWorkload = null;
  if (user.role === USER_ROLES.SUPERVISOR || user.role === USER_ROLES.ADMIN) {
    const plazaFilter = user.role === USER_ROLES.SUPERVISOR ? user.plazaId : null;
    teamWorkload = await getTeamWorkloadData(plazaFilter, {
      start: startOfMonth,
      end: new Date()
    });
  }

  // ✅ FIXED: Use lowercase status values to match database
  const totalReports = await TollMaintenanceReport.countDocuments();
  const openReports = await TollMaintenanceReport.countDocuments({
    status: { $in: ['open'] }
  });
  const closedReports = await TollMaintenanceReport.countDocuments({ status: 'closed' });
  const fixedToday = await TollMaintenanceReport.countDocuments({
    status: 'fixed',
    fixedAt: { $gte: startOfToday }
  });
  const fixedReports = await TollMaintenanceReport.countDocuments({ status: 'fixed' });
  const assignedReports = await TollMaintenanceReport.countDocuments({ status: 'assigned' });
  const inProgressReports = await TollMaintenanceReport.countDocuments({ status: 'in_progress' });
  const reopenedReports = await TollMaintenanceReport.countDocuments({ status: 'reopened' });
  const resolvedReports = await TollMaintenanceReport.countDocuments({ status: 'resolved' });

  // Get recent reports with populated data
  const recentReports = await TollMaintenanceReport.find()
    .populate('reportedBy', 'name email')
    .populate('assignedTo', 'name email')
    .populate('plazaId', 'name')
    .sort('-createdAt')
    .limit(10)
    .lean();

  // Get reports by priority
  const priorityStats = await TollMaintenanceReport.aggregate([
    {
      $group: {
        _id: '$priority',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get reports by status
  const statusStats = await TollMaintenanceReport.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get reports by issue type
  const issueTypeStats = await TollMaintenanceReport.aggregate([
    {
      $group: {
        _id: '$issueType',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get weekly trend
  const weeklyTrend = await exports.getWeeklyReportTrend();

  return {
    overview: {
      totalReports,
      openReports,
      closedReports,
      fixedToday,
      inProgressReports,
      fixedReports,
      assignedReports,
      reopenedReports,
      resolvedReports,  // Added resolved reports count
      activePlazas: plazas.length,
      teamWorkload
    },
    charts: {
      byPriority: exports.formatAggregation(priorityStats),
      byStatus: exports.formatAggregation(statusStats),
      byIssueType: exports.formatAggregation(issueTypeStats),
      weeklyTrend
    },
    recentReports,
    plazas: plazas.slice(0, 5)
  };
};

// Get employee-specific dashboard data
exports.getEmployeeDashboardData = async (userId, dateRanges) => {
  const { startOfToday, startOfWeek, startOfMonth } = dateRanges;

  // Reports created by this employee
  const myReports = await TollMaintenanceReport.find({ reportedBy: userId })
    .populate('plazaId', 'name')
    .populate('assignedTo', 'name')
    .sort('-createdAt')
    .limit(5)
    .lean();

  // Reports waiting for my verification (FIXED status)
  const pendingVerification = await TollMaintenanceReport.find({
    reportedBy: userId,
    status: 'FIXED'
  })
    .populate('resolutionDetails.resolvedBy', 'name email')
    .sort('-fixedAt')
    .lean();

  // Reports assigned to me
  const assignedToMe = await TollMaintenanceReport.find({
    assignedTo: userId,
    status: { $in: ['ASSIGNED', 'IN_PROGRESS'] }
  })
    .populate('plazaId', 'name')
    .sort('-createdAt')
    .lean();

  // My performance metrics
  const myResolvedReports = await TollMaintenanceReport.find({
    assignedTo: userId,
    status: 'CLOSED'
  });

  const avgResolutionTime = exports.calculateAverageResolutionTime(myResolvedReports);

  // Reports by status for this employee
  const myReportsByStatus = await TollMaintenanceReport.aggregate([
    { $match: { $or: [{ reportedBy: userId }, { assignedTo: userId }] } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  return {
    personal: {
      myReportsCount: myReports.length,
      pendingVerification: pendingVerification.length,
      pendingAssignments: assignedToMe.length,
      myPerformance: {
        avgResolutionTime: avgResolutionTime || 0,
        totalResolved: myResolvedReports.length
      }
    },
    myReports: {
      list: myReports,
      byStatus: exports.formatAggregation(myReportsByStatus)
    },
    pendingVerification: {
      count: pendingVerification.length,
      list: pendingVerification
    },
    assignedToMe: {
      count: assignedToMe.length,
      list: assignedToMe
    }
  };
};

// Get supervisor-specific dashboard data
// @desc    Get supervisor-specific dashboard data
// @route   GET /api/toll-maintenance/dashboard
// @access  Private (Supervisor only)
exports.getSupervisorDashboardData = async (userId, dateRanges) => {
  const { startOfToday, startOfWeek, startOfMonth } = dateRanges;

  try {
    // ==================== FIXED PLAZA PERFORMANCE QUERY ====================
    
    // Option 1: Try with direct ObjectId matching (MOST LIKELY TO WORK)
    let plazasWithStats = await TollPlaza.aggregate([
      {
        $lookup: {
          from: 'tollmaintenancereports',
          localField: '_id',
          foreignField: 'plazaId',
          as: 'reports'
        }
      },
      {
        $addFields: {
          reportsCount: { $size: '$reports' }
        }
      },
      {
        $match: {
          reportsCount: { $gt: 0 }  // Only plazas with reports
        }
      },
      {
        $addFields: {
          latestReportDate: { $max: '$reports.createdAt' },
          totalReports: { $size: '$reports' },

          // Status breakdown
          openReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: {
                  $in: [
                    { $toLower: '$$report.status' },
                    ['open', 'assigned', 'in_progress', 'reopened']
                  ]
                }
              }
            }
          },
          fixedReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'fixed'] }
              }
            }
          },
          closedReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'closed'] }
              }
            }
          },
          reopenedReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'reopened'] }
              }
            }
          },
          inProgressReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'in_progress'] }
              }
            }
          },
          assignedReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'assigned'] }
              }
            }
          },
          resolvedReports: {
            $size: {
              $filter: {
                input: '$reports',
                as: 'report',
                cond: { $eq: [{ $toLower: '$$report.status' }, 'resolved'] }
              }
            }
          }
        }
      },
      {
        $project: {
          name: 1,
          totalReports: 1,
          openReports: 1,
          fixedReports: 1,
          closedReports: 1,
          reopenedReports: 1,
          inProgressReports: 1,
          assignedReports: 1,
          resolvedReports: 1,
          latestReportDate: 1,
          reportsCount: 1
        }
      },
      {
        $sort: { latestReportDate: -1 }  // Sort by newest report first
      }
    ]);

    // If no results, try alternative approach with string matching
    if (plazasWithStats.length === 0) {
      // Alternative: Check if reports have string plazaId
      const stringPlazaReports = await TollMaintenanceReport.find({
        plazaId: { $type: 'string' }
      }).select('plazaId').limit(5).lean();

      if (stringPlazaReports.length > 0) {
        // Get plaza codes from TollPlaza
        const allPlazas = await TollPlaza.find().select('_id name plazaId').lean();
        const plazaCodes = allPlazas.map(p => p.plazaId).filter(Boolean);

        // Try matching on plazaId string field instead
        plazasWithStats = await TollPlaza.aggregate([
          {
            $lookup: {
              from: 'tollmaintenancereports',
              let: { plazaCode: '$plazaId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ['$plazaId', { $toString: '$$plazaCode' }]
                    }
                  }
                }
              ],
              as: 'reports'
            }
          },
          {
            $match: {
              'reports.0': { $exists: true }
            }
          },
          {
            $addFields: {
              latestReportDate: { $max: '$reports.createdAt' },
              totalReports: { $size: '$reports' }
            }
          },
          {
            $sort: { latestReportDate: -1 }
          }
        ]);
      }
    }

    // If STILL no results, create mock data for testing
    if (plazasWithStats.length === 0) {
      // Get any plazas that exist
      const existingPlazas = await TollPlaza.find().limit(5).lean();

      if (existingPlazas.length > 0) {
        plazasWithStats = existingPlazas.map(plaza => ({
          _id: plaza._id,
          name: plaza.name,
          totalReports: 0,
          openReports: 0,
          fixedReports: 0,
          closedReports: 0,
          reopenedReports: 0,
          inProgressReports: 0,
          assignedReports: 0,
          resolvedReports: 0,
          latestReportDate: plaza.createdAt || new Date(),
          reportsCount: 0
        }));
      }
    }

    // ==================== CONTINUE WITH OTHER DASHBOARD DATA ====================
    
    // Plaza Performance (limit to top 10)
    const plazaPerformance = plazasWithStats.slice(0, 10);

    // ─── Team Members ────────────────────────────────────────────────────────────
    const teamMembers = await User.find({
      role: { $in: [USER_ROLES.SUPERVISOR, USER_ROLES.EMPLOYEE] },
      isActive: true
    }).select('name email role');

    // ─── Pending Assignment ───────────────────────────────────────────────────────
    const pendingAssignmentCount = await TollMaintenanceReport.countDocuments({
      status: { $in: ['open', 'OPEN'] }
    });

    const pendingAssignmentList = await TollMaintenanceReport.find({
      status: { $in: ['open', 'OPEN'] }
    })
      .populate('plazaId', 'name')
      .populate('reportedBy', 'name')
      .sort({ priority: -1, createdAt: 1 })
      .limit(5)
      .lean();

    // ─── Pending Verification ─────────────────────────────────────────────────────
    const pendingVerificationCount = await TollMaintenanceReport.countDocuments({
      status: { $in: ['fixed', 'FIXED'] }
    });

    const pendingVerificationList = await TollMaintenanceReport.find({
      status: { $in: ['fixed', 'FIXED'] }
    })
      .populate('plazaId', 'name')
      .populate('resolutionDetails.resolvedBy', 'name email')
      .sort({ fixedAt: -1 })
      .limit(5)
      .lean();

    // ─── My Assigned Reports ──────────────────────────────────────────────────────
    const myAssignedReports = await TollMaintenanceReport.find({
      assignedTo: userId,
      status: { $in: ['assigned', 'ASSIGNED', 'in_progress', 'IN_PROGRESS'] }
    })
      .populate('plazaId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // ─── Team Assigned Reports ────────────────────────────────────────────────────
    const teamAssignedReports = await TollMaintenanceReport.find({
      assignedTo: { $ne: null },
      status: { $in: ['assigned', 'ASSIGNED', 'in_progress', 'IN_PROGRESS'] }
    })
      .populate('assignedTo', 'name email')
      .populate('plazaId', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // ─── Reopened Reports ─────────────────────────────────────────────────────────
    const reopenedReportsCount = await TollMaintenanceReport.countDocuments({
      status: { $in: ['reopened', 'REOPENED'] }
    });

    // ─── Critical / High Priority Reports ────────────────────────────────────────
    const criticalReports = await TollMaintenanceReport.find({
      priority: { $in: ['critical', 'high', 'CRITICAL', 'HIGH'] },
      status: { $nin: ['closed', 'CLOSED', 'resolved', 'RESOLVED'] }
    })
      .populate('plazaId', 'name')
      .populate('reportedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // ─── Team Workload Distribution ───────────────────────────────────────────────
    let workloadDistribution = [];
    try {
      workloadDistribution = await TollMaintenanceReport.aggregate([
        {
          $match: {
            assignedTo: { $ne: null },
            status: { $in: ['assigned', 'ASSIGNED', 'in_progress', 'IN_PROGRESS'] }
          }
        },
        { $unwind: { path: '$assignedTo', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$assignedTo',
            count: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $sort: { count: -1 } }
      ]);
    } catch (err) {
      workloadDistribution = [];
    }

    // ─── Team Performance ─────────────────────────────────────────────────────────
    let teamPerformance = [];
    try {
      teamPerformance = await exports.getTeamPerformanceMetrics() ?? [];
    } catch (err) {
      teamPerformance = [];
    }

    // ─── Format Workload ──────────────────────────────────────────────────────────
    let formattedWorkload = [];
    try {
      formattedWorkload = exports.formatWorkloadData(workloadDistribution) ?? [];
    } catch (err) {
      formattedWorkload = workloadDistribution
        .filter(item => Array.isArray(item.user) && item.user.length > 0)
        .map(item => ({
          userId: item._id,
          userName: item.user[0]?.name ?? 'Unknown',
          userEmail: item.user[0]?.email ?? '',
          count: item.count
        }));
    }

    // ─── Return ───────────────────────────────────────────────────────────────────
    return {
      supervision: {
        teamSize: teamMembers.length,
        pendingAssignment: pendingAssignmentCount,
        pendingVerification: pendingVerificationCount,
        activeAssignments: teamAssignedReports.length,
        reopenedReports: reopenedReportsCount,
        criticalItems: criticalReports.length,
        myAssignments: myAssignedReports.length
      },

      myAssignments: {
        count: myAssignedReports.length,
        list: myAssignedReports
      },

      pendingAssignment: {
        count: pendingAssignmentCount,
        list: pendingAssignmentList
      },

      pendingVerification: {
        count: pendingVerificationCount,
        list: pendingVerificationList
      },

      criticalReports: {
        count: criticalReports.length,
        list: criticalReports
      },

      plazaPerformance: plazaPerformance,  // ✅ Fixed: Now shows plazas with recent reports

      teamActivity: {
        assignedReports: teamAssignedReports,
        workload: formattedWorkload,
        performance: teamPerformance
      }
    };

  } catch (error) {
    // Return empty data structure instead of throwing
    return {
      supervision: {
        teamSize: 0,
        pendingAssignment: 0,
        pendingVerification: 0,
        activeAssignments: 0,
        reopenedReports: 0,
        criticalItems: 0,
        myAssignments: 0
      },
      myAssignments: { count: 0, list: [] },
      pendingAssignment: { count: 0, list: [] },
      pendingVerification: { count: 0, list: [] },
      criticalReports: { count: 0, list: [] },
      plazaPerformance: [],
      teamActivity: { assignedReports: [], workload: [], performance: [] }
    };
  }
};

// Get admin-specific dashboard data
exports.getAdminDashboardData = async (dateRanges) => {
  const { startOfToday, startOfWeek, startOfMonth } = dateRanges;

  // Get all users count
  const totalUsers = await User.countDocuments({ isActive: true });
  const supervisors = await User.countDocuments({ role: USER_ROLES.SUPERVISOR, isActive: true });
  const employees = await User.countDocuments({ role: USER_ROLES.EMPLOYEE, isActive: true });

  // Get all plazas with stats
  const plazasWithStats = await TollPlaza.aggregate([
    {
      $lookup: {
        from: 'tollmaintenancereports',
        localField: '_id',
        foreignField: 'plazaId',
        as: 'reports'
      }
    },
    {
      $project: {
        name: 1,
        createdAt: 1,  // Include createdAt field
        totalReports: { $size: '$reports' },
        openReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $in: ['$$report.status', ['open', 'assigned', 'in_progress', 'reopened']] }
            }
          }
        },
        fixedReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'fixed'] }
            }
          }
        },
        reopenedReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'reopened'] }
            }
          }
        },
        closedReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'closed'] }
            }
          }
        },
        resolvedReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'resolved'] }
            }
          }
        },
        inProgressReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'in_progress'] }
            }
          }
        },
        assignedReports: {
          $size: {
            $filter: {
              input: '$reports',
              as: 'report',
              cond: { $eq: ['$$report.status', 'assigned'] }
            }
          }
        }
      }
    },
    { $sort: { createdAt: -1 } }  // ✅ Changed: Sort by newest first
  ]);

  // Financial overview
  const financialStats = await TollMaintenanceReport.aggregate([
    {
      $group: {
        _id: null,
        totalEstimatedCost: { $sum: '$costEstimate' },
        totalActualCost: { $sum: '$actualCost' },
        avgEstimatedCost: { $avg: '$costEstimate' },
        avgActualCost: { $avg: '$actualCost' },
        reportsWithCost: {
          $sum: { $cond: [{ $gt: ['$actualCost', 0] }, 1, 0] }
        }
      }
    }
  ]);

  // Quality metrics
  const qualityMetrics = await exports.getQualityMetrics();

  // System health metrics
  const systemHealth = {
    totalReports: await TollMaintenanceReport.countDocuments(),
    reportsThisMonth: await TollMaintenanceReport.countDocuments({
      createdAt: { $gte: startOfMonth }
    }),
    resolutionRate: await exports.calculateResolutionRate(),
    avgResponseTime: await exports.calculateAvgResponseTime(),
    satisfactionRate: await exports.calculateOverallSatisfactionRate(),
    reopenedRate: await exports.calculateOverallReopenedRate()
  };

  return {
    systemOverview: {
      users: {
        total: totalUsers,
        supervisors,
        employees
      },
      plazas: plazasWithStats.length,
      financial: financialStats[0] || {
        totalEstimatedCost: 0,
        totalActualCost: 0,
        avgEstimatedCost: 0,
        avgActualCost: 0,
        reportsWithCost: 0
      },
      systemHealth,
      qualityMetrics
    },
    plazaPerformance: plazasWithStats.slice(0, 10),
    recentActivity: await TollMaintenanceReport.find()
      .populate('reportedBy', 'name')
      .populate('plazaId', 'name')
      .populate('assignedTo', 'name')
      .sort('-updatedAt')
      .limit(10)
      .lean()
  };
};


exports.getWeeklyReportTrend = async () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const count = await TollMaintenanceReport.countDocuments({
      createdAt: { $gte: date, $lt: nextDate }
    });

    days.push({
      date: date.toLocaleDateString('en-US', { weekday: 'short' }),
      count
    });
  }
  return days;
};

exports.getTeamPerformanceMetrics = async () => {
  const teamStats = await TollMaintenanceReport.aggregate([
    {
      $match: {
        assignedTo: { $ne: null },
        status: 'CLOSED'
      }
    },
    {
      $group: {
        _id: '$assignedTo',
        resolvedCount: { $sum: 1 },
        avgResolutionTime: {
          $avg: {
            $subtract: ['$closedAt', '$createdAt']
          }
        },
        satisfactionRate: {
          $avg: {
            $cond: [
              { $eq: ['$closureDetails.satisfaction', 'satisfied'] },
              100,
              {
                $cond: [
                  { $eq: ['$closureDetails.satisfaction', 'partial'] },
                  50,
                  0
                ]
              }
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $sort: { resolvedCount: -1 } },
    { $limit: 10 }
  ]);

  return teamStats.map(stat => ({
    name: stat.user[0]?.name || 'Unknown',
    resolvedCount: stat.resolvedCount,
    avgResolutionHours: Math.round(stat.avgResolutionTime / (1000 * 60 * 60)),
    satisfactionRate: Math.round(stat.satisfactionRate || 0)
  }));
};

exports.getQualityMetrics = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const reports = await TollMaintenanceReport.find({
    createdAt: { $gte: thirtyDaysAgo }
  });

  const totalClosed = reports.filter(r => r.status === 'CLOSED').length;
  const totalReopened = reports.filter(r => r.status === 'REOPENED').length;
  const reportsWithSatisfaction = reports.filter(r => r.closureDetails?.satisfaction);

  const satisfied = reportsWithSatisfaction.filter(r =>
    r.closureDetails.satisfaction === 'satisfied'
  ).length;

  return {
    satisfactionRate: totalClosed ? Math.round((satisfied / totalClosed) * 100) : 0,
    reopenedRate: totalClosed ? Math.round((totalReopened / totalClosed) * 100) : 0,
    firstTimeFixRate: totalClosed ? Math.round(((totalClosed - totalReopened) / totalClosed) * 100) : 0,
    avgTimeToClose: exports.calculateAverageResolutionTime(reports)
  };
};


exports.calculateResolutionRate = async () => {
  const total = await TollMaintenanceReport.countDocuments();
  const closed = await TollMaintenanceReport.countDocuments({ status: 'CLOSED' });
  return total > 0 ? Math.round((closed / total) * 100) : 0;
};

exports.calculateAvgResponseTime = async () => {
  const assignedReports = await TollMaintenanceReport.find({
    assignedTo: { $ne: null },
    createdAt: { $exists: true }
  }).select('createdAt assignedAt');

  if (assignedReports.length === 0) return 0;

  const totalTime = assignedReports.reduce((sum, report) => {
    const assignedTime = report.assignedAt || report.updatedAt;
    return sum + (new Date(assignedTime) - new Date(report.createdAt));
  }, 0);

  return Math.round(totalTime / assignedReports.length / (1000 * 60 * 60));
};

exports.calculateOverallSatisfactionRate = async () => {
  const closedReports = await TollMaintenanceReport.find({
    status: 'CLOSED',
    'closureDetails.satisfaction': { $exists: true }
  });

  if (closedReports.length === 0) return 0;

  const satisfied = closedReports.filter(r =>
    r.closureDetails.satisfaction === 'satisfied'
  ).length;

  return Math.round((satisfied / closedReports.length) * 100);
};

exports.calculateOverallReopenedRate = async () => {
  const closedReports = await TollMaintenanceReport.countDocuments({ status: 'CLOSED' });
  const reopenedReports = await TollMaintenanceReport.countDocuments({ status: 'REOPENED' });
  return closedReports > 0 ? Math.round((reopenedReports / closedReports) * 100) : 0;
};

exports.calculateAverageResolutionTime = (reports) => {
  const resolvedReports = reports.filter(r => r.fixedAt || r.closedAt);
  if (resolvedReports.length === 0) return 0;

  const totalTime = resolvedReports.reduce((sum, r) => {
    const endTime = r.closedAt || r.fixedAt || r.resolvedAt;
    return sum + (new Date(endTime) - new Date(r.createdAt));
  }, 0);

  return Math.round(totalTime / resolvedReports.length / (1000 * 60 * 60));
};


// ==================== FORMATTING HELPERS ====================

exports.formatAggregation = (data) => {
  const result = {};
  data.forEach(item => {
    result[item._id || 'unknown'] = item.count;
  });
  return result;
};

// Update the formatWorkloadData function to handle errors better
exports.formatWorkloadData = (data) => {
  if (!data || !Array.isArray(data)) return [];

  return data
    .filter(item => item != null && item.user && Array.isArray(item.user))
    .map(item => ({
      userName: item.user[0]?.name || 'Unknown',
      userEmail: item.user[0]?.email || '',
      userId: item._id,
      assignedCount: item.count || 0
    }));
};

exports.formatPlazaReports = (data) => {
  return data.map(item => ({
    plazaName: item.plaza[0]?.name || 'Unknown',
    // Remove plazaId reference
    totalReports: item.count,
    openReports: item.open,
    resolvedReports: item.resolved
  }));
};



// ==================== PLAZA-SPECIFIC REPORT ROUTES ====================

// @desc    Get all reports for a specific plaza
// @route   GET /api/toll-maintenance/reports/plaza/:plazaId
// @access  Private
exports.getReportsByPlazaId = async (req, res) => {
  try {
    const { plazaId } = req.params;
    const {
      status,
      priority,
      issueType,
      severity,
      laneNumber,
      startDate,
      endDate,
      search,
      sortBy = '-createdAt',
      page = 1,
      limit = 10,
      includeStats = true
    } = req.query;

    // Validate plaza exists
    const plaza = await TollPlaza.findById(plazaId);
    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    // Build query
    const query = { plazaId };

    // Apply filters
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (issueType) query.issueType = issueType;
    if (severity) query.severity = severity;
    if (laneNumber) query.laneNumber = parseInt(laneNumber);

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reportId: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Execute queries in parallel
    const [reports, total] = await Promise.all([
      TollMaintenanceReport.find(query)
        .populate('reportedBy', 'name email')
        .populate('assignedTo', 'name email')
        .populate('plazaId', 'name')
        .populate('timeline.changedBy', 'name email')
        .sort(sortBy)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TollMaintenanceReport.countDocuments(query)
    ]);

    // Transform reports to include additional metadata
    const transformedReports = reports.map(report => ({
      ...report,
      assigneesCount: report.assignedTo?.length || 0,
      currentAssignees: report.assignedTo || [],
      // Add formatted dates for convenience
      formattedDates: {
        createdAt: report.createdAt ? new Date(report.createdAt).toLocaleString() : null,
        fixedAt: report.fixedAt ? new Date(report.fixedAt).toLocaleString() : null,
        closedAt: report.closedAt ? new Date(report.closedAt).toLocaleString() : null,
        reopenedAt: report.reopenedAt ? new Date(report.reopenedAt).toLocaleString() : null
      }
    }));

    // Prepare response
    const response = {
      success: true,
      data: {
        plaza: {
          id: plaza._id,
          name: plaza.name,
          // Add any other plaza fields you want to include
        },
        reports: transformedReports,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNextPage: pageNum * limitNum < total,
          hasPrevPage: pageNum > 1
        },

      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error fetching reports by plaza ID:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};

// @desc    Get comprehensive statistics for a specific plaza
// @route   GET /api/toll-maintenance/reports/plaza/:plazaId/stats
// @access  Private
exports.getPlazaReportStats = async (req, res) => {
  try {
    const { plazaId } = req.params;
    const { days = 30, includeTrends = true } = req.query;

    // Validate plaza exists
    const plaza = await TollPlaza.findById(plazaId);
    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    const dateRange = {};
    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      dateRange.createdAt = { $gte: startDate };
    }

    const baseQuery = { plazaId, ...dateRange };

    // Get all reports for this plaza within date range
    const reports = await TollMaintenanceReport.find(baseQuery).lean();

    // Calculate comprehensive statistics
    const stats = {
      overview: {
        totalReports: reports.length,
        activeReports: reports.filter(r =>
          ![REPORT_STATUS.CLOSED, REPORT_STATUS.RESOLVED].includes(r.status)
        ).length,
        completionRate: reports.length > 0
          ? Math.round((reports.filter(r => r.status === REPORT_STATUS.CLOSED).length / reports.length) * 100)
          : 0
      },
      byStatus: {
        open: reports.filter(r => r.status === REPORT_STATUS.OPEN).length,
        assigned: reports.filter(r => r.status === REPORT_STATUS.ASSIGNED).length,
        inProgress: reports.filter(r => r.status === REPORT_STATUS.IN_PROGRESS).length,
        fixed: reports.filter(r => r.status === REPORT_STATUS.FIXED).length,
        reopened: reports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
        resolved: reports.filter(r => r.status === REPORT_STATUS.RESOLVED).length,
        closed: reports.filter(r => r.status === REPORT_STATUS.CLOSED).length
      },
      byPriority: {
        low: reports.filter(r => r.priority === 'low').length,
        medium: reports.filter(r => r.priority === 'medium').length,
        high: reports.filter(r => r.priority === 'high').length,
        critical: reports.filter(r => r.priority === 'critical').length
      },
      byIssueType: reports.reduce((acc, r) => {
        acc[r.issueType] = (acc[r.issueType] || 0) + 1;
        return acc;
      }, {}),
      byLane: reports.reduce((acc, r) => {
        if (r.laneNumber) {
          acc[`Lane ${r.laneNumber}`] = (acc[`Lane ${r.laneNumber}`] || 0) + 1;
        }
        return acc;
      }, {}),
      financial: {
        totalEstimatedCost: reports.reduce((sum, r) => sum + (r.costEstimate || 0), 0),
        totalActualCost: reports.reduce((sum, r) => sum + (r.actualCost || 0), 0),
        averageEstimatedCost: reports.length > 0
          ? Math.round(reports.reduce((sum, r) => sum + (r.costEstimate || 0), 0) / reports.length)
          : 0,
        averageActualCost: reports.length > 0
          ? Math.round(reports.reduce((sum, r) => sum + (r.actualCost || 0), 0) / reports.length)
          : 0,
        costVariance: reports.reduce((sum, r) => sum + ((r.actualCost || 0) - (r.costEstimate || 0)), 0)
      },
      performance: {
        averageResolutionTime: this.calculateAverageResolutionTime(reports),
        averageResponseTime: await this.calculatePlazaAvgResponseTime(plazaId),
        reopenedRate: reports.length > 0
          ? Math.round((reports.filter(r => r.status === REPORT_STATUS.REOPENED).length / reports.length) * 100)
          : 0,
        satisfactionRate: await this.calculatePlazaSatisfactionRate(plazaId)
      },
      monthlyTrend: await this.getPlazaMonthlyTrend(plazaId, parseInt(days))
    };

    // Add equipment type stats if available
    const equipmentStats = reports.reduce((acc, r) => {
      if (r.equipmentType) {
        acc[r.equipmentType] = {
          count: (acc[r.equipmentType]?.count || 0) + 1,
          averageResolutionTime: 0 // Would need additional calculation
        };
      }
      return acc;
    }, {});

    stats.byEquipmentType = equipmentStats;

    // Add lane status information
    if (plaza.lanes && plaza.lanes.length > 0) {
      stats.laneStatus = plaza.lanes.map(lane => ({
        laneNumber: lane.laneNumber,
        status: lane.status,
        reportCount: reports.filter(r => r.laneNumber === lane.laneNumber).length,
        lastMaintenance: lane.lastMaintenance
      }));
    }

    res.json({
      success: true,
      data: {
        plaza: {
          id: plaza._id,
          name: plaza.name,
          // Include other plaza fields as needed
        },
        stats,
        dateRange: {
          from: dateRange.createdAt?.$gte || null,
          to: new Date(),
          days: parseInt(days)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching plaza report stats:', error);
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR,
      error: error.message
    });
  }
};


// ==================== HELPER METHODS FOR PLAZA REPORTS ====================
// ==================== HELPER METHODS FOR PLAZA REPORTS ====================

// Helper: Calculate average response time for a plaza
exports.calculatePlazaAvgResponseTime = async (plazaId) => {
  const assignedReports = await TollMaintenanceReport.find({
    plazaId,
    assignedTo: { $ne: null },
    createdAt: { $exists: true }
  }).select('createdAt assignedAt');

  if (assignedReports.length === 0) return 0;

  const totalTime = assignedReports.reduce((sum, report) => {
    const assignedTime = report.assignedAt || report.updatedAt;
    return sum + (new Date(assignedTime) - new Date(report.createdAt));
  }, 0);

  return Math.round(totalTime / assignedReports.length / (1000 * 60 * 60)); // hours
};

// Helper: Calculate satisfaction rate for a plaza
exports.calculatePlazaSatisfactionRate = async (plazaId) => {
  const closedReports = await TollMaintenanceReport.find({
    plazaId,
    status: REPORT_STATUS.CLOSED,
    'closureDetails.satisfaction': { $exists: true }
  });

  if (closedReports.length === 0) return 0;

  const satisfied = closedReports.filter(r =>
    r.closureDetails.satisfaction === 'satisfied'
  ).length;

  return Math.round((satisfied / closedReports.length) * 100);
};

// Helper: Get monthly trend for a plaza
exports.getPlazaMonthlyTrend = async (plazaId, months = 6) => {
  const trend = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

    const reports = await TollMaintenanceReport.find({
      plazaId,
      createdAt: { $gte: startDate, $lte: endDate }
    });

    trend.push({
      month: startDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
      total: reports.length,
      closed: reports.filter(r => r.status === REPORT_STATUS.CLOSED).length,
      reopened: reports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
      averageCost: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.actualCost || 0), 0) / reports.length)
        : 0
    });
  }

  return trend;
};

// Helper: Get plaza report statistics
exports.getPlazaReportStats = async (plazaId, baseQuery = {}) => {
  const reports = await TollMaintenanceReport.find({ ...baseQuery, plazaId }).lean();

  return {
    total: reports.length,
    open: reports.filter(r => r.status === REPORT_STATUS.OPEN).length,
    inProgress: reports.filter(r => r.status === REPORT_STATUS.IN_PROGRESS).length,
    fixed: reports.filter(r => r.status === REPORT_STATUS.FIXED).length,
    closed: reports.filter(r => r.status === REPORT_STATUS.CLOSED).length,
    reopened: reports.filter(r => r.status === REPORT_STATUS.REOPENED).length,
    byPriority: {
      critical: reports.filter(r => r.priority === 'critical').length,
      high: reports.filter(r => r.priority === 'high').length,
      medium: reports.filter(r => r.priority === 'medium').length,
      low: reports.filter(r => r.priority === 'low').length
    },
    completionRate: reports.length > 0
      ? Math.round((reports.filter(r => r.status === REPORT_STATUS.CLOSED).length / reports.length) * 100)
      : 0
  };
};

// ==================== DATE HELPER FUNCTIONS ====================

// Helper function to safely parse date from various formats
// Parse date from various formats
const parseDate = (dateValue) => {
  if (!dateValue) return null;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) return dateValue;
  if (typeof dateValue === 'string') {
    const csvMatch = dateValue.match(/(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+):(\d+)\s*(am|pm)/i);
    if (csvMatch) {
      const day = parseInt(csvMatch[1]);
      const month = parseInt(csvMatch[2]) - 1;
      const year = parseInt(csvMatch[3]);
      let hour = parseInt(csvMatch[4]);
      const minute = parseInt(csvMatch[5]);
      const second = parseInt(csvMatch[6]);
      const ampm = csvMatch[7].toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      return new Date(year, month, day, hour, minute, second);
    }
    const isoDate = new Date(dateValue);
    if (!isNaN(isoDate.getTime())) return isoDate;
  }
  return null;
};

// Get date from timeline by status
const getDateFromTimeline = (report, targetStatus) => {
  if (report.timeline && Array.isArray(report.timeline) && report.timeline.length > 0) {
    const timelineEntry = report.timeline.find(entry =>
      entry.status && entry.status.toUpperCase() === targetStatus.toUpperCase()
    );
    if (timelineEntry && timelineEntry.changedAt) {
      return parseDate(timelineEntry.changedAt);
    }
  }
  return null;
};

// Format date for display
const formatDate = (date) => {
  if (!date) return 'N/A';
  if (date instanceof Date && !isNaN(date.getTime())) {
    return date.toLocaleString('en-GB');
  }
  return 'N/A';
};

// Get week number
const getWeekNumber = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'N/A';
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};
// Helper functions for week calculations
function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getEndOfWeek(date) {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

// ==================== SHEET HELPER FUNCTIONS ====================

// Summary Sheet
const addSummarySheet = async (sheet, exportData, dateInfo) => {
  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'MAINTENANCE REPORTS EXPORT SUMMARY';
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: 'center' };

  sheet.getCell('A3').value = 'Export Date & Time:';
  sheet.getCell('B3').value = new Date().toLocaleString();

  sheet.getCell('A4').value = 'Total Reports:';
  sheet.getCell('B4').value = exportData.length;

  sheet.getCell('A5').value = 'Date Range:';
  if (dateInfo.period) {
    sheet.getCell('B5').value = `Period: ${dateInfo.period.replace(/_/g, ' ').toUpperCase()}`;
  } else if (dateInfo.startDate || dateInfo.endDate) {
    const start = dateInfo.startDate ? new Date(dateInfo.startDate).toLocaleDateString() : 'Beginning';
    const end = dateInfo.endDate ? new Date(dateInfo.endDate).toLocaleDateString() : 'Today';
    sheet.getCell('B5').value = `${start} to ${end}`;
  } else {
    sheet.getCell('B5').value = 'All Time';
  }

  sheet.getCell('A7').value = 'STATISTICS SUMMARY';
  sheet.getCell('A7').font = { size: 12, bold: true };

  const totalCost = exportData.reduce((sum, r) => sum + (parseFloat(r['Actual Cost (₹)']) || 0), 0);
  const totalEstCost = exportData.reduce((sum, r) => sum + (parseFloat(r['Estimated Cost (₹)']) || 0), 0);

  const stats = [
    ['Total Reports', exportData.length],
    ['Open Reports', exportData.filter(r => r.Status === 'OPEN').length],
    ['Assigned Reports', exportData.filter(r => r.Status === 'ASSIGNED').length],
    ['Fixed Reports', exportData.filter(r => r.Status === 'FIXED').length],
    ['Closed Reports', exportData.filter(r => r.Status === 'CLOSED').length],
    ['Reopened Reports', exportData.filter(r => r.Status === 'REOPENED').length],
    ['Critical Priority', exportData.filter(r => r.Priority === 'CRITICAL').length],
    ['High Priority', exportData.filter(r => r.Priority === 'HIGH').length],
    ['Total Estimated Cost', `₹${totalEstCost.toLocaleString()}`],
    ['Total Actual Cost', `₹${totalCost.toLocaleString()}`],
    ['Cost Variance', `₹${(totalCost - totalEstCost).toLocaleString()}`],
  ];

  stats.forEach((stat, index) => {
    sheet.getCell(`A${9 + index}`).value = stat[0];
    sheet.getCell(`B${9 + index}`).value = stat[1];
  });

  sheet.getColumn('A').width = 30;
  sheet.getColumn('B').width = 25;
};

// Reports Sheet
const addReportsSheet = async (sheet, exportData) => {
  if (exportData.length === 0) {
    sheet.getCell('A1').value = 'No reports found matching the criteria';
    return;
  }

  const headers = Object.keys(exportData[0]);
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };

  exportData.forEach(row => {
    const dataRow = sheet.addRow(Object.values(row));

    const statusIndex = headers.indexOf('Status');
    if (statusIndex !== -1) {
      const status = row['Status'];
      const colors = {
        'OPEN': 'FFFF0000',
        'ASSIGNED': 'FFFFC000',
        'IN_PROGRESS': 'FF0070C0',
        'FIXED': 'FF00B050',
        'RESOLVED': 'FF92D050',
        'CLOSED': 'FF808080',
        'REOPENED': 'FFFF0000',
        'CANCELLED': 'FFA0A0A0'
      };

      if (colors[status]) {
        dataRow.getCell(statusIndex + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors[status] }
        };
      }
    }
  });

  sheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + headers.length)}${exportData.length + 1}`
  };

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  headers.forEach((header, index) => {
    let width = Math.min(30, Math.max(15, header.length + 5));
    if (header === 'Description') width = 50;
    if (header === 'Resolution Summary') width = 40;
    sheet.getColumn(index + 1).width = width;
  });
};

// Status Breakdown Sheet
const addStatusBreakdownSheet = async (sheet, exportData) => {
  sheet.getCell('A1').value = 'STATUS BREAKDOWN ANALYSIS';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const statusCounts = exportData.reduce((acc, r) => {
    const status = r.Status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  sheet.getCell('A3').value = 'Status';
  sheet.getCell('B3').value = 'Count';
  sheet.getCell('C3').value = 'Percentage';
  sheet.getCell('D3').value = 'Chart';
  sheet.getCell('A3:D3').font = { bold: true };
  sheet.getCell('A3:D3').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  sheet.getCell('A3:D3').font = { color: { argb: 'FFFFFFFF' }, bold: true };

  let row = 4;
  Object.entries(statusCounts).forEach(([status, count]) => {
    const percentage = ((count / exportData.length) * 100).toFixed(1);
    sheet.getCell(`A${row}`).value = status;
    sheet.getCell(`B${row}`).value = count;
    sheet.getCell(`C${row}`).value = `${percentage}%`;

    const barLength = Math.floor(parseFloat(percentage) / 2);
    sheet.getCell(`D${row}`).value = { formula: `REPT("█", ${barLength})`, result: '█'.repeat(barLength) };

    row++;
  });

  sheet.getColumn('A').width = 20;
  sheet.getColumn('B').width = 15;
  sheet.getColumn('C').width = 15;
  sheet.getColumn('D').width = 30;
};

// Priority Analysis Sheet
const addPriorityAnalysisSheet = async (sheet, exportData) => {
  sheet.getCell('A1').value = 'PRIORITY ANALYSIS';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const priorityCounts = exportData.reduce((acc, r) => {
    const priority = r.Priority || 'UNKNOWN';
    acc[priority] = (acc[priority] || 0) + 1;
    return acc;
  }, {});

  sheet.getCell('A3').value = 'Priority';
  sheet.getCell('B3').value = 'Count';
  sheet.getCell('C3').value = 'Percentage';
  sheet.getCell('D3').value = 'Avg Resolution (Hours)';
  sheet.getCell('A3:D3').font = { bold: true };
  sheet.getCell('A3:D3').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  sheet.getCell('A3:D3').font = { color: { argb: 'FFFFFFFF' }, bold: true };

  let row = 4;
  Object.entries(priorityCounts).forEach(([priority, count]) => {
    const percentage = ((count / exportData.length) * 100).toFixed(1);

    const priorityReports = exportData.filter(r => r.Priority === priority);
    const avgResolution = priorityReports.reduce((sum, r) => {
      const resTime = parseFloat(r['Resolution Time (Hours)']);
      return sum + (isNaN(resTime) ? 0 : resTime);
    }, 0) / (priorityReports.filter(r => !isNaN(parseFloat(r['Resolution Time (Hours)']))).length || 1);

    sheet.getCell(`A${row}`).value = priority;
    sheet.getCell(`B${row}`).value = count;
    sheet.getCell(`C${row}`).value = `${percentage}%`;
    sheet.getCell(`D${row}`).value = avgResolution.toFixed(1);
    row++;
  });

  sheet.getColumn('A').width = 20;
  sheet.getColumn('B').width = 15;
  sheet.getColumn('C').width = 15;
  sheet.getColumn('D').width = 25;
};

// Financial Summary Sheet
const addFinancialSummarySheet = async (sheet, exportData) => {
  sheet.getCell('A1').value = 'FINANCIAL SUMMARY';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const totalEstCost = exportData.reduce((sum, r) => sum + (parseFloat(r['Estimated Cost (₹)']) || 0), 0);
  const totalActualCost = exportData.reduce((sum, r) => sum + (parseFloat(r['Actual Cost (₹)']) || 0), 0);
  const costVariance = totalActualCost - totalEstCost;
  const avgCostPerReport = exportData.length > 0 ? totalActualCost / exportData.length : 0;
  const highCostReports = exportData.filter(r => (parseFloat(r['Actual Cost (₹)']) || 0) > 1000).length;

  const costByPriority = {};
  exportData.forEach(r => {
    const priority = r.Priority || 'UNKNOWN';
    const cost = parseFloat(r['Actual Cost (₹)']) || 0;
    costByPriority[priority] = (costByPriority[priority] || 0) + cost;
  });

  sheet.getCell('A3').value = 'Metric';
  sheet.getCell('B3').value = 'Value';
  sheet.getCell('A3:B3').font = { bold: true };
  sheet.getCell('A3:B3').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  sheet.getCell('A3:B3').font = { color: { argb: 'FFFFFFFF' }, bold: true };

  const financialData = [
    ['Total Estimated Cost', `₹${totalEstCost.toLocaleString()}`],
    ['Total Actual Cost', `₹${totalActualCost.toLocaleString()}`],
    ['Cost Variance', `₹${costVariance.toLocaleString()}`],
    ['Average Cost per Report', `₹${avgCostPerReport.toFixed(2)}`],
    ['Reports with Cost > ₹1000', highCostReports],
    ['', ''],
    ['COST BY PRIORITY:', ''],
  ];

  financialData.forEach((data, index) => {
    sheet.getCell(`A${4 + index}`).value = data[0];
    sheet.getCell(`B${4 + index}`).value = data[1];
  });

  let row = 4 + financialData.length;
  Object.entries(costByPriority).forEach(([priority, cost]) => {
    sheet.getCell(`A${row}`).value = `  ${priority}`;
    sheet.getCell(`B${row}`).value = `₹${cost.toLocaleString()}`;
    row++;
  });

  sheet.getColumn('A').width = 30;
  sheet.getColumn('B').width = 25;
};

// Daily Trend Sheet
const addDailyTrendSheet = async (sheet, reports) => {
  sheet.getCell('A1').value = 'DAILY REPORT TREND';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const dailyData = {};

  reports.forEach(report => {
    if (report.createdAt) {
      const date = new Date(report.createdAt);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!dailyData[dateKey]) {
        dailyData[dateKey] = {
          date: dateKey,
          total: 0,
          created: 0,
          closed: 0,
          resolved: 0,
          fixed: 0,
          reopened: 0,
          inProgress: 0,
          assigned: 0,
          open: 0,
          totalCost: 0,
          resolutionTimes: []
        };
      }

      // Count by creation date
      dailyData[dateKey].created++;
      dailyData[dateKey].total++;

      // Track status counts (lowercase)
      switch (report.status) {
        case 'closed':
          dailyData[dateKey].closed++;
          dailyData[dateKey].totalCost += report.actualCost || 0;
          if (report.closedAt) {
            const resolutionTime = (new Date(report.closedAt) - new Date(report.createdAt)) / (1000 * 60 * 60);
            dailyData[dateKey].resolutionTimes.push(resolutionTime);
          }
          break;
        case 'resolved':
          dailyData[dateKey].resolved++;
          break;
        case 'fixed':
          dailyData[dateKey].fixed++;
          break;
        case 'reopened':
          dailyData[dateKey].reopened++;
          break;
        case 'in_progress':
          dailyData[dateKey].inProgress++;
          break;
        case 'assigned':
          dailyData[dateKey].assigned++;
          break;
        case 'open':
          dailyData[dateKey].open++;
          break;
      }
    }
  });

  // Calculate averages
  Object.values(dailyData).forEach(day => {
    if (day.resolutionTimes.length > 0) {
      const totalTime = day.resolutionTimes.reduce((sum, time) => sum + time, 0);
      day.avgResolutionTime = Math.round(totalTime / day.resolutionTimes.length);
    } else {
      day.avgResolutionTime = 0;
    }
  });

  // Headers
  sheet.getCell('A3').value = 'Date';
  sheet.getCell('B3').value = 'Created';
  sheet.getCell('C3').value = 'Open';
  sheet.getCell('D3').value = 'Assigned';
  sheet.getCell('E3').value = 'In Progress';
  sheet.getCell('F3').value = 'Fixed';
  sheet.getCell('G3').value = 'Resolved';
  sheet.getCell('H3').value = 'Closed';
  sheet.getCell('I3').value = 'Reopened';
  sheet.getCell('J3').value = 'Closure Rate';
  sheet.getCell('K3').value = 'Total Cost (₹)';
  sheet.getCell('L3').value = 'Avg Resolution (Hrs)';
  sheet.getCell('A3:L3').font = { bold: true };

  // Fill data (last 30 days)
  let row = 4;
  const sortedDates = Object.keys(dailyData).sort().reverse().slice(0, 30);

  for (const dateKey of sortedDates) {
    const day = dailyData[dateKey];
    sheet.getCell(`A${row}`).value = day.date;
    sheet.getCell(`B${row}`).value = day.created;
    sheet.getCell(`C${row}`).value = day.open;
    sheet.getCell(`D${row}`).value = day.assigned;
    sheet.getCell(`E${row}`).value = day.inProgress;
    sheet.getCell(`F${row}`).value = day.fixed;
    sheet.getCell(`G${row}`).value = day.resolved;
    sheet.getCell(`H${row}`).value = day.closed;
    sheet.getCell(`I${row}`).value = day.reopened;
    sheet.getCell(`J${row}`).value = day.total > 0 ? `${((day.closed / day.total) * 100).toFixed(1)}%` : '0%';
    sheet.getCell(`K${row}`).value = day.totalCost;
    sheet.getCell(`L${row}`).value = day.avgResolutionTime;
    row++;
  }

  // Optional: Set column widths manually if needed
  // sheet.getColumn(1).width = 12; // Date
  // sheet.getColumn(2).width = 10; // Created
  // etc.
};


// Weekly Summary Sheet
const addWeeklySummarySheet = async (sheet, reports) => {
  sheet.getCell('A1').value = 'WEEKLY SUMMARY';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const weeklyData = {};

  reports.forEach(report => {
    if (report.createdAt) {
      const date = new Date(report.createdAt);
      const weekKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          week: weekKey,
          startDate: getStartOfWeek(date),
          endDate: getEndOfWeek(date),
          total: 0,
          closed: 0,
          resolved: 0,      // Add resolved count
          fixed: 0,         // Add fixed count
          reopened: 0,
          totalCost: 0,
          avgResolutionTime: 0
        };
      }

      weeklyData[weekKey].total++;

      // Check for closed status (lowercase)
      if (report.status === 'closed') {
        weeklyData[weekKey].closed++;
        weeklyData[weekKey].totalCost += report.actualCost || 0;
        if (report.closedAt) {
          const resolutionTime = (new Date(report.closedAt) - new Date(report.createdAt)) / (1000 * 60 * 60);
          weeklyData[weekKey].avgResolutionTime += resolutionTime;
        }
      }

      // Also count 'resolved' and 'fixed' as completed if needed
      if (report.status === 'resolved' || report.status === 'fixed') {
        weeklyData[weekKey].resolved++;
        weeklyData[weekKey].fixed++;
        // Optionally add to cost calculation for these statuses too
        if (report.status === 'resolved' || report.status === 'fixed') {
          weeklyData[weekKey].totalCost += report.actualCost || 0;
        }
      }

      if (report.status === 'reopened') {
        weeklyData[weekKey].reopened++;
      }
    }
  });

  Object.values(weeklyData).forEach(week => {
    if (week.closed > 0) {
      week.avgResolutionTime = Math.round(week.avgResolutionTime / week.closed);
    }
  });

  sheet.getCell('A3').value = 'Week';
  sheet.getCell('B3').value = 'Start Date';
  sheet.getCell('C3').value = 'End Date';
  sheet.getCell('D3').value = 'Total Reports';
  sheet.getCell('E3').value = 'Closed';
  sheet.getCell('F3').value = 'Resolved/Fixed';  // Updated label
  sheet.getCell('G3').value = 'Reopened';
  sheet.getCell('H3').value = 'Closure Rate';
  sheet.getCell('I3').value = 'Total Cost';
  sheet.getCell('J3').value = 'Avg Resolution (Hrs)';
  sheet.getCell('A3:J3').font = { bold: true };

  let row = 4;
  const sortedWeeks = Object.keys(weeklyData).sort().reverse();

  sortedWeeks.forEach(weekKey => {
    const week = weeklyData[weekKey];
    sheet.getCell(`A${row}`).value = week.week;
    sheet.getCell(`B${row}`).value = week.startDate.toLocaleDateString();
    sheet.getCell(`C${row}`).value = week.endDate.toLocaleDateString();
    sheet.getCell(`D${row}`).value = week.total;
    sheet.getCell(`E${row}`).value = week.closed;
    sheet.getCell(`F${row}`).value = week.resolved + week.fixed;  // Combined count
    sheet.getCell(`G${row}`).value = week.reopened;
    sheet.getCell(`H${row}`).value = week.total > 0 ? `${((week.closed / week.total) * 100).toFixed(1)}%` : '0%';
    sheet.getCell(`I${row}`).value = week.totalCost;
    sheet.getCell(`J${row}`).value = week.avgResolutionTime;
    row++;
  });
};

// Monthly Summary Sheet
const addMonthlySummarySheet = async (sheet, reports) => {
  sheet.getCell('A1').value = 'MONTHLY SUMMARY';
  sheet.getCell('A1').font = { size: 14, bold: true };

  const monthlyData = {};

  reports.forEach(report => {
    if (report.createdAt) {
      const date = new Date(report.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('default', { month: 'long' });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthKey,
          monthName: monthName,
          year: date.getFullYear(),
          total: 0,
          closed: 0,
          resolved: 0,
          fixed: 0,
          reopened: 0,
          inProgress: 0,
          assigned: 0,
          open: 0,
          cancelled: 0,
          totalCost: 0,
          resolutionTimes: [],
          weeklyBreakdown: {}
        };
      }

      // Count by creation date
      monthlyData[monthKey].total++;

      // Track status counts (lowercase)
      switch (report.status) {
        case 'closed':
          monthlyData[monthKey].closed++;
          monthlyData[monthKey].totalCost += report.actualCost || 0;
          if (report.closedAt) {
            const resolutionTime = (new Date(report.closedAt) - new Date(report.createdAt)) / (1000 * 60 * 60);
            monthlyData[monthKey].resolutionTimes.push(resolutionTime);
          }
          break;
        case 'resolved':
          monthlyData[monthKey].resolved++;
          break;
        case 'fixed':
          monthlyData[monthKey].fixed++;
          break;
        case 'reopened':
          monthlyData[monthKey].reopened++;
          break;
        case 'in_progress':
          monthlyData[monthKey].inProgress++;
          break;
        case 'assigned':
          monthlyData[monthKey].assigned++;
          break;
        case 'open':
          monthlyData[monthKey].open++;
          break;
        case 'cancelled':
          monthlyData[monthKey].cancelled++;
          break;
      }

      // Track weekly breakdown within month
      const weekNumber = getWeekNumber(date);
      const weekKey = `${monthKey}-W${weekNumber}`;
      if (!monthlyData[monthKey].weeklyBreakdown[weekKey]) {
        monthlyData[monthKey].weeklyBreakdown[weekKey] = {
          week: weekNumber,
          total: 0,
          closed: 0
        };
      }
      monthlyData[monthKey].weeklyBreakdown[weekKey].total++;
      if (report.status === 'closed') {
        monthlyData[monthKey].weeklyBreakdown[weekKey].closed++;
      }
    }
  });

  // Calculate averages and additional metrics
  Object.values(monthlyData).forEach(month => {
    if (month.resolutionTimes.length > 0) {
      const totalTime = month.resolutionTimes.reduce((sum, time) => sum + time, 0);
      month.avgResolutionTime = Math.round(totalTime / month.resolutionTimes.length);
    } else {
      month.avgResolutionTime = 0;
    }

    month.closureRate = month.total > 0 ? (month.closed / month.total) * 100 : 0;
    month.completionRate = month.total > 0 ? ((month.closed + month.resolved + month.fixed) / month.total) * 100 : 0;
  });

  // Sort months in descending order
  const sortedMonths = Object.keys(monthlyData).sort().reverse();

  // Main Summary Table
  sheet.getCell('A3').value = 'MONTHLY PERFORMANCE SUMMARY';
  sheet.getCell('A3').font = { bold: true, size: 12 };

  sheet.getCell('A5').value = 'Month';
  sheet.getCell('B5').value = 'Year';
  sheet.getCell('C5').value = 'Total';
  sheet.getCell('D5').value = 'Closed';
  sheet.getCell('E5').value = 'Fixed';
  sheet.getCell('F5').value = 'Resolved';
  sheet.getCell('G5').value = 'In Progress';
  sheet.getCell('H5').value = 'Assigned';
  sheet.getCell('I5').value = 'Open';
  sheet.getCell('J5').value = 'Reopened';
  sheet.getCell('K5').value = 'Cancelled';
  sheet.getCell('L5').value = 'Closure Rate';
  sheet.getCell('M5').value = 'Completion Rate';
  sheet.getCell('N5').value = 'Total Cost (₹)';
  sheet.getCell('O5').value = 'Avg Resolution (Hrs)';
  sheet.getCell('A5:O5').font = { bold: true };

  let row = 6;
  sortedMonths.forEach(monthKey => {
    const month = monthlyData[monthKey];
    sheet.getCell(`A${row}`).value = month.monthName;
    sheet.getCell(`B${row}`).value = month.year;
    sheet.getCell(`C${row}`).value = month.total;
    sheet.getCell(`D${row}`).value = month.closed;
    sheet.getCell(`E${row}`).value = month.fixed;
    sheet.getCell(`F${row}`).value = month.resolved;
    sheet.getCell(`G${row}`).value = month.inProgress;
    sheet.getCell(`H${row}`).value = month.assigned;
    sheet.getCell(`I${row}`).value = month.open;
    sheet.getCell(`J${row}`).value = month.reopened;
    sheet.getCell(`K${row}`).value = month.cancelled;
    sheet.getCell(`L${row}`).value = `${month.closureRate.toFixed(1)}%`;
    sheet.getCell(`M${row}`).value = `${month.completionRate.toFixed(1)}%`;
    sheet.getCell(`N${row}`).value = month.totalCost;
    sheet.getCell(`O${row}`).value = month.avgResolutionTime;
    row++;
  });

  // Weekly Breakdown Table for each month
  row += 2;
  sheet.getCell(`A${row}`).value = 'WEEKLY BREAKDOWN BY MONTH';
  sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 2;

  sheet.getCell(`A${row}`).value = 'Month';
  sheet.getCell(`B${row}`).value = 'Week';
  sheet.getCell(`C${row}`).value = 'Total Reports';
  sheet.getCell(`D${row}`).value = 'Closed';
  sheet.getCell(`E${row}`).value = 'Weekly Closure Rate';
  sheet.getCell(`A${row}:E${row}`).font = { bold: true };
  row++;

  sortedMonths.forEach(monthKey => {
    const month = monthlyData[monthKey];
    const weeks = Object.keys(month.weeklyBreakdown).sort();

    weeks.forEach(weekKey => {
      const week = month.weeklyBreakdown[weekKey];
      sheet.getCell(`A${row}`).value = month.monthName;
      sheet.getCell(`B${row}`).value = `Week ${week.week}`;
      sheet.getCell(`C${row}`).value = week.total;
      sheet.getCell(`D${row}`).value = week.closed;
      sheet.getCell(`E${row}`).value = week.total > 0 ? `${((week.closed / week.total) * 100).toFixed(1)}%` : '0%';
      row++;
    });
  });

  // Monthly Trends (last 12 months)
  row += 2;
  sheet.getCell(`A${row}`).value = 'MONTHLY TRENDS (Last 12 Months)';
  sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 2;

  sheet.getCell(`A${row}`).value = 'Month';
  sheet.getCell(`B${row}`).value = 'Total';
  sheet.getCell(`C${row}`).value = 'Closed';
  sheet.getCell(`D${row}`).value = 'Closure Rate';
  sheet.getCell(`E${row}`).value = 'Total Cost';
  sheet.getCell(`F${row}`).value = 'Avg Resolution';
  sheet.getCell(`A${row}:F${row}`).font = { bold: true };
  row++;

  const last12Months = sortedMonths.slice(0, 12);
  last12Months.forEach(monthKey => {
    const month = monthlyData[monthKey];
    sheet.getCell(`A${row}`).value = `${month.monthName} ${month.year}`;
    sheet.getCell(`B${row}`).value = month.total;
    sheet.getCell(`C${row}`).value = month.closed;
    sheet.getCell(`D${row}`).value = `${month.closureRate.toFixed(1)}%`;
    sheet.getCell(`E${row}`).value = month.totalCost;
    sheet.getCell(`F${row}`).value = month.avgResolutionTime;
    row++;
  });

  // Summary Statistics
  row += 2;
  sheet.getCell(`A${row}`).value = 'SUMMARY STATISTICS';
  sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 2;

  // Calculate overall stats
  let totalAllReports = 0;
  let totalClosedAll = 0;
  let totalCostAll = 0;
  let allResolutionTimes = [];

  Object.values(monthlyData).forEach(month => {
    totalAllReports += month.total;
    totalClosedAll += month.closed;
    totalCostAll += month.totalCost;
    allResolutionTimes.push(...month.resolutionTimes);
  });

  const overallClosureRate = totalAllReports > 0 ? (totalClosedAll / totalAllReports) * 100 : 0;
  const overallAvgResolution = allResolutionTimes.length > 0
    ? Math.round(allResolutionTimes.reduce((a, b) => a + b, 0) / allResolutionTimes.length)
    : 0;

  sheet.getCell(`A${row}`).value = 'Total Reports (All Time):';
  sheet.getCell(`B${row}`).value = totalAllReports;
  sheet.getCell(`A${row + 1}`).value = 'Total Closed Reports:';
  sheet.getCell(`B${row + 1}`).value = totalClosedAll;
  sheet.getCell(`A${row + 2}`).value = 'Overall Closure Rate:';
  sheet.getCell(`B${row + 2}`).value = `${overallClosureRate.toFixed(1)}%`;
  sheet.getCell(`A${row + 3}`).value = 'Total Cost Incurred:';
  sheet.getCell(`B${row + 3}`).value = totalCostAll;
  sheet.getCell(`A${row + 4}`).value = 'Average Resolution Time:';
  sheet.getCell(`B${row + 4}`).value = `${overallAvgResolution} hours`;
  sheet.getCell(`A${row + 5}`).value = 'Total Months Analyzed:';
  sheet.getCell(`B${row + 5}`).value = Object.keys(monthlyData).length;

  // Style the summary section
  for (let i = 0; i <= 5; i++) {
    sheet.getCell(`A${row + i}`).font = { bold: true };
  }
};

// CSV conversion helper
const convertToCSV = async (data) => {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map((header) => {
      let val = row[header];
      if (val === null || val === undefined) return '';
      val = val.toString().replace(/"/g, '""');
      return `"${val}"`;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
};

// ==================== MAIN EXPORT FUNCTION ====================

// @desc    Export reports to Excel with time period presets
// @route   GET /api/toll-maintenance/reports/export/excel
// @access  Private (Admin, Supervisor)
exports.exportReportsToExcel = async (req, res) => {
  try {
    const {
      status, priority, issueType, severity,
      plazaId, laneNumber,
      reportedBy, assignedTo,
      startDate, endDate, search,
      period,
      format = 'excel'
    } = req.query;

    let query = {};

    // Status filter
    if (status && status !== '' && status !== 'undefined') {
      query.status = status.toUpperCase();
    }
    if (status && status.includes(',')) {
      const statuses = status.split(',').map(s => s.trim().toUpperCase());
      query.status = { $in: statuses };
    }

    if (priority && priority !== '') query.priority = priority;
    if (issueType && issueType !== '') query.issueType = issueType;
    if (severity && severity !== '') query.severity = severity;
    if (plazaId && plazaId !== '') query.plazaId = plazaId;
    if (laneNumber && laneNumber !== '') query.laneNumber = parseInt(laneNumber);
    if (reportedBy && reportedBy !== '') query.reportedBy = reportedBy;
    if (assignedTo && assignedTo !== '') query.assignedTo = assignedTo;

    // Date filter
    let dateFilter = {};
    const now = new Date();

    if (period) {
      switch (period) {
        case 'today':
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          dateFilter = { $gte: today, $lt: tomorrow };
          break;
        case 'yesterday':
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          yesterday.setHours(0, 0, 0, 0);
          const todayStart = new Date(yesterday);
          todayStart.setDate(todayStart.getDate() + 1);
          dateFilter = { $gte: yesterday, $lt: todayStart };
          break;
        case 'this_week':
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay());
          startOfWeek.setHours(0, 0, 0, 0);
          dateFilter = { $gte: startOfWeek, $lte: now };
          break;
        case 'last_week':
          const startOfLastWeek = new Date(now);
          startOfLastWeek.setDate(now.getDate() - now.getDay() - 7);
          startOfLastWeek.setHours(0, 0, 0, 0);
          const endOfLastWeek = new Date(startOfLastWeek);
          endOfLastWeek.setDate(endOfLastWeek.getDate() + 6);
          endOfLastWeek.setHours(23, 59, 59, 999);
          dateFilter = { $gte: startOfLastWeek, $lte: endOfLastWeek };
          break;
        case 'this_month':
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          dateFilter = { $gte: startOfMonth, $lte: now };
          break;
        case 'last_month':
          const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
          dateFilter = { $gte: startOfLastMonth, $lte: endOfLastMonth };
          break;
        case 'last_30_days':
          const thirtyDaysAgo = new Date(now);
          thirtyDaysAgo.setDate(now.getDate() - 30);
          thirtyDaysAgo.setHours(0, 0, 0, 0);
          dateFilter = { $gte: thirtyDaysAgo, $lte: now };
          break;
        case 'last_90_days':
          const ninetyDaysAgo = new Date(now);
          ninetyDaysAgo.setDate(now.getDate() - 90);
          ninetyDaysAgo.setHours(0, 0, 0, 0);
          dateFilter = { $gte: ninetyDaysAgo, $lte: now };
          break;
        case 'this_quarter':
          const currentQuarter = Math.floor(now.getMonth() / 3);
          const startOfQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);
          dateFilter = { $gte: startOfQuarter, $lte: now };
          break;
        case 'this_year':
          const startOfYear = new Date(now.getFullYear(), 0, 1);
          dateFilter = { $gte: startOfYear, $lte: now };
          break;
      }
    }

    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    }

    if (Object.keys(dateFilter).length > 0) {
      query.createdAt = dateFilter;
    }

    // Search
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reportId: { $regex: search, $options: 'i' } }
      ];
    }

    // Role-based restrictions
    if (req.user && req.user.role === 'employee') {
      query.$or = [
        { reportedBy: req.user.id },
        { assignedTo: req.user.id }
      ];
    }

    console.log('Export query:', JSON.stringify(query, null, 2));

    // Fetch reports
    const reports = await TollMaintenanceReport.find(query)
      .populate('reportedBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('plazaId', 'name')
      .populate('timeline.changedBy', 'name email')
      .populate('resolutionDetails.resolvedBy', 'name email')
      .populate('closureDetails.closedBy', 'name email')
      .populate('reopenDetails.reopenedBy', 'name email')
      .sort('-createdAt')
      .lean();

    // Transform data for export
    const exportData = reports.map(report => {
      const createdAt = parseDate(report.createdAt) || new Date();
      const closedAt = parseDate(report.closedAt);

      // Get dates from timeline or direct fields
      const assignedDate = getDateFromTimeline(report, 'ASSIGNED') || parseDate(report.assignedAt);
      const startedDate = getDateFromTimeline(report, 'IN_PROGRESS') ||
        getDateFromTimeline(report, 'STARTED') ||
        parseDate(report.startedAt);
      const fixedDate = getDateFromTimeline(report, 'FIXED') ||
        getDateFromTimeline(report, 'RESOLVED') ||
        parseDate(report.fixedAt);

      // Calculate metrics
      let responseTime = 'N/A';
      if (assignedDate && createdAt) {
        responseTime = Math.round((assignedDate - createdAt) / (1000 * 60 * 60));
      }

      let resolutionTime = 'N/A';
      if (closedAt && createdAt) {
        resolutionTime = Math.round((closedAt - createdAt) / (1000 * 60 * 60));
      } else if (fixedDate && createdAt) {
        resolutionTime = Math.round((fixedDate - createdAt) / (1000 * 60 * 60));
      }

      let daysOpen = 'N/A';
      if (createdAt) {
        const endDate = closedAt || new Date();
        daysOpen = Math.floor((endDate - createdAt) / (1000 * 60 * 60 * 24));
      }

      // Get assignee info
      let assignedToNames = 'Unassigned';
      let assigneeEmails = 'N/A';
      let assigneesCount = 0;

      if (report.assignedTo) {
        if (Array.isArray(report.assignedTo)) {
          assignedToNames = report.assignedTo.map(a => a.name || a).join(', ');
          assigneeEmails = report.assignedTo.map(a => a.email || 'N/A').join(', ');
          assigneesCount = report.assignedTo.length;
        }
      }

      // Calculate financials
      const estimatedCost = parseFloat(report.costEstimate || 0);
      const actualCost = parseFloat(report.actualCost || 0);
      const costVariance = actualCost - estimatedCost;
      const costVariancePercent = estimatedCost > 0 ? ((costVariance / estimatedCost) * 100).toFixed(2) : 'N/A';

      return {
        'Report ID': report.reportId || 'N/A',
        'Title': report.title || 'N/A',
        'Description': (report.description || 'N/A').substring(0, 500),
        'Status': (report.status || 'N/A').toUpperCase(),
        'Priority': (report.priority || 'N/A').toUpperCase(),
        'Issue Type': report.issueType || 'N/A',
        'Severity': (report.severity || 'N/A').toUpperCase(),
        'Category': report.category || 'N/A',
        'Equipment Type': report.equipmentType || 'N/A',
        'Plaza Name': report.plazaId?.name || 'N/A',
        'Lane Number': report.laneNumber || 'N/A',
        'Reported By': report.reportedBy?.name || 'N/A',
        'Reporter Email': report.reportedBy?.email || 'N/A',
        'Assigned To': assignedToNames,
        'Assignee Emails': assigneeEmails,
        'Assignees Count': assigneesCount,
        'Created Date': formatDate(createdAt),
        'Created Time': createdAt ? createdAt.toLocaleTimeString('en-GB') : 'N/A',
        'Created Day': createdAt ? createdAt.toLocaleDateString('en-GB', { weekday: 'long' }) : 'N/A',
        'Assigned Date': formatDate(assignedDate),
        'Started Date': formatDate(startedDate),
        'Fixed Date': formatDate(fixedDate),
        'Closed Date': formatDate(closedAt),
        'Last Updated': report.updatedAt ? new Date(report.updatedAt).toLocaleString('en-GB') : 'N/A',
        'Resolution Time (Hours)': resolutionTime,
        'Response Time (Hours)': responseTime,
        'Estimated Hours': report.estimatedHours || 'N/A',
        'Actual Hours': report.actualHours || 'N/A',
        'Estimated Cost (₹)': estimatedCost,
        'Actual Cost (₹)': actualCost,
        'Cost Variance (₹)': costVariance,
        'Cost Variance %': costVariancePercent,
        'Resolution Summary': report.resolutionDetails?.summary || report.fixDetails?.summary || 'N/A',
        'Root Cause': report.resolutionDetails?.rootCause || report.fixDetails?.rootCause || 'N/A',
        'Preventive Measures': report.resolutionDetails?.preventiveMeasures || report.fixDetails?.preventiveMeasures || 'N/A',
        'Resolved By': report.resolutionDetails?.resolvedBy?.name || report.fixDetails?.fixedBy?.name || 'N/A',
        'Satisfaction Level': report.closureDetails?.satisfaction || 'N/A',
        'Feedback': report.closureDetails?.feedback || 'N/A',
        'Verification Notes': report.closureDetails?.verificationNotes || 'N/A',
        'Follow-up Required': report.closureDetails?.followUpRequired ? 'Yes' : 'No',
        'Closed By': report.closureDetails?.closedBy?.name || 'N/A',
        'Reopen Reason': report.reopenDetails?.reason || 'N/A',
        'Reopened By': report.reopenDetails?.reopenedBy?.name || 'N/A',
        'Issue Persists': report.reopenDetails?.issuePersists ? 'Yes' : 'No',
        'Comments Count': report.comments?.length || 0,
        'Photos Count': report.photos?.length || 0,
        'Timeline Entries': report.timeline?.length || 0,
        'Has Attachments': (report.photos?.length > 0) ? 'Yes' : 'No',
        'Is Overdue': (report.estimatedHours && report.status !== 'CLOSED' &&
          ((new Date() - createdAt) > report.estimatedHours * 60 * 60 * 1000)) ? 'Yes' : 'No',
        'Days Open': daysOpen,
        'Month': createdAt ? createdAt.toLocaleString('default', { month: 'long' }) : 'N/A',
        'Year': createdAt ? createdAt.getFullYear() : 'N/A',
        'Quarter': createdAt ? `Q${Math.floor(createdAt.getMonth() / 3) + 1}` : 'N/A',
        'Week Number': getWeekNumber(createdAt)
      };
    });

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    let periodText = '';
    if (period && period !== 'custom') {
      periodText = `-${period}`;
    } else if (startDate || endDate) {
      periodText = `-${startDate || 'start'}_to_${endDate || 'end'}`;
    }
    const filename = `maintenance-reports${periodText}-${timestamp}`;

    if (format === 'csv') {
      const csv = await convertToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    } else {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet('Summary');
      await addSummarySheet(summarySheet, exportData, { startDate, endDate, period });

      const reportsSheet = workbook.addWorksheet('All Reports');
      await addReportsSheet(reportsSheet, exportData);

      if (Object.keys(dateFilter).length > 0) {
        const dailyTrendSheet = workbook.addWorksheet('Daily Trend');
        await addDailyTrendSheet(dailyTrendSheet, reports, dateFilter);
      }

      const weeklySheet = workbook.addWorksheet('Weekly Summary');
      await addWeeklySummarySheet(weeklySheet, reports);

      const monthlySheet = workbook.addWorksheet('Monthly Summary');
      await addMonthlySummarySheet(monthlySheet, reports);

      const statusSheet = workbook.addWorksheet('Status Breakdown');
      await addStatusBreakdownSheet(statusSheet, exportData);

      const prioritySheet = workbook.addWorksheet('Priority Analysis');
      await addPriorityAnalysisSheet(prioritySheet, exportData);

      const financialSheet = workbook.addWorksheet('Financial Summary');
      await addFinancialSummarySheet(financialSheet, exportData);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();
    }

  } catch (error) {
    console.error('Error exporting reports to Excel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export reports',
      error: error.message
    });
  }
};

// @desc    Get available filter options for reports
// @route   GET /api/maintenance/reports/filter-options
// @access  Private
exports.getFilterOptions = async (req, res) => {
  try {
    const [statuses, priorities, issueTypes, severities] = await Promise.all([
      TollMaintenanceReport.distinct('status'),
      TollMaintenanceReport.distinct('priority'),
      TollMaintenanceReport.distinct('issueType'),
      TollMaintenanceReport.distinct('severity')
    ]);

    const plazas = await TollPlaza.find({}, 'name _id').lean();

    res.status(200).json({
      success: true,
      data: {
        statuses: statuses.sort(),
        priorities: priorities.sort(),
        issueTypes: issueTypes.sort(),
        severities: severities.sort(),
        plazas: plazas
      }
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch filter options',
      error: error.message
    });
  }
};