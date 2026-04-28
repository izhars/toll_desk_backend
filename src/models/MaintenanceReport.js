const mongoose = require('mongoose');
const { REPORT_STATUS, PRIORITY_LEVELS, ISSUE_TYPES, SEVERITY_LEVELS } = require('../utils/constants');

const maintenanceReportSchema = new mongoose.Schema({
  reportId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  plazaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TollPlaza',
    required: [true, 'Plaza is required'],
    index: true
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  priority: {
    type: String,
    enum: Object.values(PRIORITY_LEVELS),
    default: PRIORITY_LEVELS.MEDIUM,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(REPORT_STATUS),
    default: REPORT_STATUS.OPEN,
    index: true
  },
  issueType: {
    type: String,
    enum: Object.values(ISSUE_TYPES),
    required: [true, 'Issue type is required']
  },
  severity: {
    type: String,
    enum: Object.values(SEVERITY_LEVELS),
    default: SEVERITY_LEVELS.MINOR
  },
  estimatedHours: {
    type: Number,
    min: 0,
    max: 1000
  },
  actualHours: {
    type: Number,
    min: 0,
    max: 1000,
    default: 0
  },
  costEstimate: {
    type: Number,
    min: 0,
    default: 0
  },
  actualCost: {
    type: Number,
    min: 0,
    default: 0
  },

  // Date tracking fields
  assignedAt: {
    type: Date,
    index: true
  },
  startedAt: {
    type: Date,
    index: true
  },
  fixedAt: {
    type: Date,
    index: true
  },

  photos: [{
    url: { type: String, required: true },
    publicId: String,
    caption: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    fileSize: Number,
    fileType: String
  }],
  reopenDetails: {
    reason: String,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: Date,
    notes: String
  },
  closureDetails: {
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    closedAt: { type: Date },
    notes: String
  },
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: {
      type: String,
      default: '',
      maxlength: 1000
    },
    createdAt: { type: Date, default: Date.now },
    isInternal: { type: Boolean, default: false },
    photos: [{
      url: String,
      publicId: String,
      caption: String,
      uploadedAt: { type: Date, default: Date.now }
    }]
  }],
  resolutionDetails: {
    summary: String,
    rootCause: String,
    preventiveMeasures: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolutionPhotos: [{
      url: String,
      caption: String,
      uploadedAt: { type: Date, default: Date.now }
    }]
  },
  reassignmentDetails: {
    reason: String,
    reassignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reassignedAt: Date,
    fromAssignee: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    notes: String
  },
  timeline: [{
    status: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    notes: String
  }],
  resolvedAt: Date,
  closedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes for better query performance
maintenanceReportSchema.index({ status: 1, priority: 1, createdAt: -1 });
maintenanceReportSchema.index({ reportedBy: 1, status: 1 });
maintenanceReportSchema.index({ assignedTo: 1, status: 1 });
maintenanceReportSchema.index({ assignedAt: 1 });
maintenanceReportSchema.index({ startedAt: 1 });
maintenanceReportSchema.index({ fixedAt: 1 });

// Pre-save middleware - Update the date fields when status changes
maintenanceReportSchema.pre('save', function (next) {
  // Track previous status for timeline
  if (this.isModified('status')) {
    const previousStatus = this._original?.status || this.status;
    if (previousStatus !== this.status) {
      this.timeline.push({
        status: this.status,
        changedBy: this._modifiedBy,
        changedAt: new Date(),
        notes: `Status changed from ${previousStatus} to ${this.status}`
      });

      // Update specific date fields based on status change
      const now = new Date();

      // When status changes to ASSIGNED
      if (this.status === REPORT_STATUS.ASSIGNED && !this.assignedAt) {
        this.assignedAt = now;
      }

      // When status changes to IN_PROGRESS or STARTED
      if ((this.status === REPORT_STATUS.IN_PROGRESS || this.status === 'STARTED') && !this.startedAt) {
        this.startedAt = now;
      }

      // When status changes to FIXED or RESOLVED
      if ((this.status === REPORT_STATUS.FIXED || this.status === REPORT_STATUS.RESOLVED) && !this.fixedAt) {
        this.fixedAt = now;
      }
    }
  }
  next();
});

// Instance methods
maintenanceReportSchema.methods = {
  async addComment(userId, text, isInternal = false) {
    this.comments.push({ user: userId, text, isInternal });
    return this.save();
  },

  async assignTo(userIds, assignedBy, notes) {
    if (!Array.isArray(userIds)) {
      userIds = [userIds];
    }

    const currentAssignees = this.assignedTo || [];
    const newAssignees = userIds.filter(
      id => !currentAssignees.some(existingId => existingId.toString() === id.toString())
    );

    this.assignedTo = [...new Set([...currentAssignees.map(id => id.toString()), ...userIds])];

    if (newAssignees.length > 0 && this.status !== REPORT_STATUS.ASSIGNED) {
      this.status = REPORT_STATUS.ASSIGNED;
    }

    this.timeline.push({
      status: REPORT_STATUS.ASSIGNED,
      changedBy: assignedBy,
      changedAt: new Date(),
      notes: notes || `Assigned to ${newAssignees.length} user(s)`
    });

    return this.save();
  },

  async start(notes, userId) {
    if (this.status !== REPORT_STATUS.ASSIGNED && this.status !== REPORT_STATUS.OPEN) {
      throw new Error('Report must be assigned before starting work');
    }
    this.status = REPORT_STATUS.IN_PROGRESS;
    this.startedAt = new Date();
    this.timeline.push({
      status: REPORT_STATUS.IN_PROGRESS,
      changedBy: userId,
      changedAt: new Date(),
      notes: notes || 'Work started on report'
    });
    return this.save();
  },

  async markAsFixed(fixDetails, userId) {
    this.status = REPORT_STATUS.FIXED;
    this.fixedAt = new Date();
    this.fixDetails = fixDetails;
    this.timeline.push({
      status: REPORT_STATUS.FIXED,
      changedBy: userId,
      changedAt: new Date(),
      notes: fixDetails.summary || 'Issue fixed'
    });
    return this.save();
  },

  async resolve(resolutionData, userId) {
    this.status = REPORT_STATUS.RESOLVED;
    this.resolvedAt = new Date();
    if (!this.fixedAt) {
      this.fixedAt = new Date();
    }
    this.resolutionDetails = {
      ...resolutionData,
      resolvedBy: userId,
      resolvedAt: new Date()
    };
    this.timeline.push({
      status: REPORT_STATUS.RESOLVED,
      changedBy: userId,
      changedAt: new Date(),
      notes: resolutionData.summary
    });
    return this.save();
  },

  async close(notes, userId) {
    this.status = REPORT_STATUS.CLOSED;
    this.closedAt = new Date();
    this.timeline.push({
      status: REPORT_STATUS.CLOSED,
      changedBy: userId,
      changedAt: new Date(),
      notes: notes || 'Report closed'
    });
    return this.save();
  },

  async reopen(reason, userId) {
    const oldStatus = this.status;
    this.status = REPORT_STATUS.REOPENED;
    this.reopenDetails = {
      reason: reason,
      reopenedBy: userId,
      reopenedAt: new Date(),
      notes: `Reopened from ${oldStatus} status`
    };
    this.timeline.push({
      status: REPORT_STATUS.REOPENED,
      changedBy: userId,
      changedAt: new Date(),
      notes: `Report reopened. Reason: ${reason}`
    });
    return this.save();
  }
};

// Static methods
maintenanceReportSchema.statics = {
  getPendingReports() {
    return this.find({ status: REPORT_STATUS.OPEN })
      .populate('reportedBy', 'name email')
      .sort('-priority createdAt');
  },

  async getUnassignedReports() {
    return this.find({
      status: REPORT_STATUS.OPEN,
      $or: [
        { assignedTo: { $exists: false } },
        { assignedTo: { $size: 0 } }
      ]
    })
      .populate('reportedBy', 'name email')
      .sort('-priority createdAt');
  },

  async getReportsAssignedToUser(userId) {
    return this.find({ assignedTo: userId })
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort('-createdAt');
  },

  async getOverdueReports() {
    return this.find({
      status: { $in: [REPORT_STATUS.ASSIGNED, REPORT_STATUS.IN_PROGRESS] },
      estimatedHours: { $exists: true, $ne: null },
      assignedAt: { $exists: true }
    }).then(reports => {
      return reports.filter(report => {
        const hoursSinceAssignment = (new Date() - new Date(report.assignedAt)) / (1000 * 60 * 60);
        return hoursSinceAssignment > report.estimatedHours;
      });
    });
  },

  // Get team workload data for dashboard
  async getTeamWorkload(plazaId = null, startDate = null, endDate = null) {
    const matchStage = {};

    if (plazaId) {
      matchStage.plazaId = new mongoose.Types.ObjectId(plazaId);
    }

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const pipeline = [
      { $match: matchStage },
      { $unwind: { path: '$assignedTo', preserveNullAndEmptyArrays: true } },
      { $match: { assignedTo: { $ne: null } } },
      {
        $group: {
          _id: '$assignedTo',
          totalReports: { $sum: 1 },
          // FIXED: Use lowercase status values to match constants
          openReports: {
            $sum: {
              $cond: [{
                $in: ['$status', ['open', 'assigned', 'in_progress', 'reopened']]
              }, 1, 0]
            }
          },
          inProgressReports: {
            $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
          },
          assignedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'assigned'] }, 1, 0] }
          },
          fixedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'fixed'] }, 1, 0] }
          },
          resolvedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] }
          },
          closedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          },
          reopenedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'reopened'] }, 1, 0] }
          },
          avgEstimatedHours: { $avg: '$estimatedHours' },
          totalEstimatedHours: { $sum: '$estimatedHours' },
          totalActualHours: { $sum: '$actualHours' },
          workloadScore: {
            $sum: {
              $multiply: [
                {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$priority', 'critical'] }, then: 5 },
                      { case: { $eq: ['$priority', 'high'] }, then: 4 },
                      { case: { $eq: ['$priority', 'medium'] }, then: 2 },
                      { case: { $eq: ['$priority', 'low'] }, then: 1 }
                    ],
                    default: 1
                  }
                },
                {
                  $cond: [{
                    $in: ['$status', ['open', 'assigned', 'in_progress', 'reopened']]
                  }, 1, 0]
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
          as: 'userDetails'
        }
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          userId: '$_id',
          userName: '$userDetails.name',
          userEmail: '$userDetails.email',
          userRole: '$userDetails.role',
          totalReports: 1,
          openReports: 1,
          inProgressReports: 1,
          assignedReports: 1,
          fixedReports: 1,
          resolvedReports: 1,
          closedReports: 1,
          reopenedReports: 1,
          avgEstimatedHours: { $ifNull: ['$avgEstimatedHours', 0] },
          totalEstimatedHours: { $ifNull: ['$totalEstimatedHours', 0] },
          totalActualHours: { $ifNull: ['$totalActualHours', 0] },
          workloadScore: { $ifNull: ['$workloadScore', 0] },
          completionRate: {
            $multiply: [
              {
                $divide: [
                  { $add: ['$fixedReports', '$resolvedReports', '$closedReports'] },
                  { $cond: [{ $eq: ['$totalReports', 0] }, 1, '$totalReports'] }
                ]
              },
              100
            ]
          }
        }
      },
      { $sort: { workloadScore: -1, totalReports: -1 } }
    ];

    return this.aggregate(pipeline);
  },

  // Get workload distribution across priorities
  // Get workload distribution across priorities
  async getWorkloadDistribution(plazaId = null) {
    const matchStage = {};
    if (plazaId) {
      matchStage.plazaId = new mongoose.Types.ObjectId(plazaId);
    }
    // FIXED: Use lowercase status values
    matchStage.status = { $in: ['open', 'assigned', 'in_progress', 'reopened'] };

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
          reports: { $push: { _id: '$_id', title: '$title', assignedTo: '$assignedTo' } }
        }
      },
      {
        $project: {
          priority: '$_id',
          count: 1,
          percentage: {
            $multiply: [
              { $divide: ['$count', { $sum: '$count' }] },
              100
            ]
          },
          reports: { $slice: ['$reports', 10] }
        }
      }
    ];

    return this.aggregate(pipeline);
  },


  // Get overdue tasks by assignee
  async getOverdueTasks() {
    
    const now = new Date();
    const reports = await this.find({
      status: { $in: ['assigned', 'in_progress'] },
      estimatedHours: { $exists: true, $ne: null },
      assignedAt: { $exists: true }
    }).populate('assignedTo', 'name email');

    const overdueByAssignee = {};

    for (const report of reports) {
      const hoursSinceAssignment = (now - new Date(report.assignedAt)) / (1000 * 60 * 60);
      const isOverdue = hoursSinceAssignment > report.estimatedHours;

      if (isOverdue && report.assignedTo) {
        const assignees = Array.isArray(report.assignedTo) ? report.assignedTo : [report.assignedTo];

        for (const assignee of assignees) {
          if (!assignee) continue;

          const assigneeId = assignee._id.toString();

          if (!overdueByAssignee[assigneeId]) {
            overdueByAssignee[assigneeId] = {
              assigneeId,
              userName: assignee.name,
              userEmail: assignee.email,
              overdueReports: [],
              totalOverdueHours: 0
            };
          }

          const overdueHours = hoursSinceAssignment - report.estimatedHours;
          overdueByAssignee[assigneeId].overdueReports.push({
            reportId: report.reportId,
            title: report.title,
            priority: report.priority,
            estimatedHours: report.estimatedHours,
            hoursOverdue: Math.round(overdueHours * 10) / 10,
            assignedAt: report.assignedAt
          });
          overdueByAssignee[assigneeId].totalOverdueHours += overdueHours;
        }
      }
    }

    return Object.values(overdueByAssignee);
  }
};

module.exports = mongoose.model('MaintenanceReport', maintenanceReportSchema);