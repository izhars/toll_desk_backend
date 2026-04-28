const User = require('../models/User');
const TollPlaza = require('../models/TollPlaza');
const TollMaintenanceReport = require('../models/MaintenanceReport');
const MaintenanceTask = require('../models/MaintenanceTask');

// @desc    Get dashboard analytics
// @route   GET /api/toll-admin/analytics
exports.getAnalytics = async (req, res) => {
  try {
    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Toll plaza statistics
    const totalPlazas = await TollPlaza.countDocuments();
    const activePlazas = await TollPlaza.countDocuments({ operationalStatus: 'active' });
    const plazasInMaintenance = await TollPlaza.countDocuments({ 
      operationalStatus: { $in: ['maintenance', 'partial'] } 
    });

    // Lane statistics
    const allPlazas = await TollPlaza.find();
    let totalLanes = 0;
    let operationalLanes = 0;
    let lanesInMaintenance = 0;
    let faultyLanes = 0;

    allPlazas.forEach(plaza => {
      if (plaza.lanes && plaza.lanes.length) {
        totalLanes += plaza.lanes.length;
        operationalLanes += plaza.lanes.filter(l => l.status === 'operational').length;
        lanesInMaintenance += plaza.lanes.filter(l => l.status === 'maintenance').length;
        faultyLanes += plaza.lanes.filter(l => l.status === 'faulty').length;
      }
    });

    // Equipment statistics
    const equipmentStats = {};
    allPlazas.forEach(plaza => {
      if (plaza.equipment && plaza.equipment.length) {
        plaza.equipment.forEach(eq => {
          if (!equipmentStats[eq.type]) {
            equipmentStats[eq.type] = { total: 0, operational: 0, faulty: 0 };
          }
          equipmentStats[eq.type].total += eq.count || 1;
          if (eq.status === 'operational') {
            equipmentStats[eq.type].operational += eq.count || 1;
          } else if (eq.status === 'faulty') {
            equipmentStats[eq.type].faulty += eq.count || 1;
          }
        });
      }
    });

    // Maintenance report statistics
    const totalReports = await TollMaintenanceReport.countDocuments();
    const pendingReports = await TollMaintenanceReport.countDocuments({ 
      status: { $in: ['open', 'assigned'] } 
    });
    const inProgressReports = await TollMaintenanceReport.countDocuments({ 
      status: 'in_progress' 
    });
    const resolvedReports = await TollMaintenanceReport.countDocuments({ 
      status: 'resolved' 
    });

    const reportsByPriority = await TollMaintenanceReport.aggregate([
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    const reportsByIssueType = await TollMaintenanceReport.aggregate([
      { $group: { _id: '$issueType', count: { $sum: 1 } } }
    ]);

    // Maintenance task statistics
    const totalTasks = await MaintenanceTask.countDocuments();
    const pendingTasks = await MaintenanceTask.countDocuments({ 
      status: { $in: ['pending', 'in_progress'] } 
    });
    const completedTasks = await MaintenanceTask.countDocuments({ 
      status: 'completed' 
    });

    const tasksByType = await MaintenanceTask.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    // Cost analytics
    const costAnalytics = await TollMaintenanceReport.aggregate([
      {
        $group: {
          _id: null,
          totalEstimatedCost: { $sum: '$costEstimate' },
          totalActualCost: { $sum: '$actualCost' },
          avgResolutionTime: { $avg: { 
            $subtract: ['$resolvedAt', '$createdAt'] 
          }}
        }
      }
    ]);

    // Recent activities
    const recentReports = await TollMaintenanceReport.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('reportedBy', 'name')
      .populate('plazaId', 'name');

    const recentTasks = await MaintenanceTask.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('assignedTo', 'name')
      .populate('plazaId', 'name');

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          byRole: usersByRole
        },
        plazas: {
          total: totalPlazas,
          active: activePlazas,
          inMaintenance: plazasInMaintenance
        },
        lanes: {
          total: totalLanes,
          operational: operationalLanes,
          inMaintenance: lanesInMaintenance,
          faulty: faultyLanes,
          operationalRate: totalLanes ? ((operationalLanes / totalLanes) * 100).toFixed(2) : 0
        },
        equipment: equipmentStats,
        reports: {
          total: totalReports,
          pending: pendingReports,
          inProgress: inProgressReports,
          resolved: resolvedReports,
          byPriority: reportsByPriority,
          byIssueType: reportsByIssueType
        },
        tasks: {
          total: totalTasks,
          pending: pendingTasks,
          completed: completedTasks,
          byType: tasksByType
        },
        costs: costAnalytics[0] || {
          totalEstimatedCost: 0,
          totalActualCost: 0,
          avgResolutionTime: 0
        },
        recentActivity: {
          reports: recentReports,
          tasks: recentTasks
        }
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching analytics',
      error: error.message 
    });
  }
};

// @desc    Get system overview
// @route   GET /api/toll-admin/overview
exports.getSystemOverview = async (req, res) => {
  try {
    const [
      totalPlazas,
      totalUsers,
      totalReports,
      activeMaintenance,
      criticalIssues
    ] = await Promise.all([
      TollPlaza.countDocuments(),
      User.countDocuments({ isActive: true }),
      TollMaintenanceReport.countDocuments(),
      TollMaintenanceReport.countDocuments({ 
        status: 'in_progress',
        priority: 'critical'
      }),
      TollMaintenanceReport.countDocuments({ 
        priority: 'critical',
        status: { $ne: 'resolved' }
      })
    ]);

    const plazasWithIssues = await TollPlaza.countDocuments({
      'lanes.status': { $in: ['faulty', 'maintenance'] }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalPlazas,
          activeUsers: totalUsers,
          openReports: totalReports,
          activeMaintenance,
          criticalIssues,
          plazasWithIssues
        },
        systemHealth: {
          status: criticalIssues > 0 ? 'warning' : 'healthy',
          message: criticalIssues > 0 
            ? `${criticalIssues} critical issues require attention`
            : 'All systems operational'
        }
      }
    });
  } catch (error) {
    console.error('Error fetching overview:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching system overview',
      error: error.message 
    });
  }
};

// @desc    Get all plazas with details
// @route   GET /api/toll-admin/plazas
exports.getAllPlazas = async (req, res) => {
  try {
    const plazas = await TollPlaza.find()
      .select('-qrCode')
      .sort({ name: 1 });

    // Enhance with report counts
    const plazasWithStats = await Promise.all(plazas.map(async (plaza) => {
      const openReports = await TollMaintenanceReport.countDocuments({
        plazaId: plaza._id,
        status: { $in: ['open', 'assigned', 'in_progress'] }
      });

      const totalReports = await TollMaintenanceReport.countDocuments({
        plazaId: plaza._id
      });

      const laneIssues = plaza.lanes?.filter(l => 
        l.status === 'faulty' || l.status === 'maintenance'
      ).length || 0;

      return {
        ...plaza.toObject(),
        stats: {
          openReports,
          totalReports,
          laneIssues,
          healthScore: calculatePlazaHealthScore(plaza, laneIssues, openReports)
        }
      };
    }));

    res.json({
      success: true,
      count: plazas.length,
      data: plazasWithStats
    });
  } catch (error) {
    console.error('Error fetching plazas:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching plazas',
      error: error.message 
    });
  }
};

// @desc    Get plaza details with full stats
// @route   GET /api/toll-admin/plazas/:id
exports.getPlazaDetails = async (req, res) => {
  try {
    const plaza = await TollPlaza.findById(req.params.id);
    
    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    const [
      reports,
      tasks,
      monthlyReports
    ] = await Promise.all([
      TollMaintenanceReport.find({ plazaId: plaza._id })
        .sort({ createdAt: -1 })
        .populate('reportedBy', 'name')
        .limit(10),
      MaintenanceTask.find({ plazaId: plaza._id })
        .sort({ createdAt: -1 })
        .limit(10),
      TollMaintenanceReport.aggregate([
        {
          $match: {
            plazaId: plaza._id,
            createdAt: { $gte: new Date(new Date().setDate(1)) }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const laneStats = {
      total: plaza.lanes?.length || 0,
      operational: plaza.lanes?.filter(l => l.status === 'operational').length || 0,
      maintenance: plaza.lanes?.filter(l => l.status === 'maintenance').length || 0,
      faulty: plaza.lanes?.filter(l => l.status === 'faulty').length || 0
    };

    res.json({
      success: true,
      data: {
        plaza,
        stats: {
          laneStats,
          healthScore: calculatePlazaHealthScore(plaza, laneStats.faulty, reports.length),
          totalReports: reports.length,
          recentReports: reports,
          recentTasks: tasks,
          dailyReportTrend: monthlyReports
        }
      }
    });
  } catch (error) {
    console.error('Error fetching plaza details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching plaza details',
      error: error.message 
    });
  }
};

// @desc    Get user management data
// @route   GET /api/toll-admin/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });

    // Get user activity stats
    const userStats = await Promise.all(users.map(async (user) => {
      const reportsCreated = await TollMaintenanceReport.countDocuments({
        reportedBy: user._id
      });

      const tasksAssigned = await MaintenanceTask.countDocuments({
        assignedTo: user._id,
        status: { $ne: 'completed' }
      });

      const reportsResolved = await TollMaintenanceReport.countDocuments({
        assignedTo: user._id,
        status: 'resolved'
      });

      return {
        ...user.toObject(),
        stats: {
          reportsCreated,
          tasksAssigned,
          reportsResolved,
          productivity: calculateUserProductivity(reportsResolved, tasksAssigned)
        }
      };
    }));

    res.json({
      success: true,
      count: users.length,
      data: userStats
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching users',
      error: error.message 
    });
  }
};

// @desc    Manage users (CRUD operations)
// @route   POST /api/toll-admin/users
exports.createUser = async (req, res) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const user = await User.create(req.body);
    user.password = undefined; // Remove password from response

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating user',
      error: error.message 
    });
  }
};
// @desc    Update user
// @route   PUT /api/toll-admin/users/:id
exports.updateUser = async (req, res) => {
  try {
    // Only allow updating specific fields
    const allowedFields = ['name', 'email', 'phone'];
    const updateData = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Check if any valid fields were provided
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update: name, email, or phone'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Error updating user:', error);
    
    // Handle duplicate email error
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'Error updating user',
      error: error.message 
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/toll-admin/users/:id
exports.deleteUser = async (req, res) => {
  try {
    // Check if user has associated reports
    const hasReports = await TollMaintenanceReport.exists({
      $or: [
        { reportedBy: req.params.id },
        { assignedTo: req.params.id }
      ]
    });

    if (hasReports) {
      // Soft delete - deactivate instead of removing
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      );

      return res.json({
        success: true,
        message: 'User deactivated successfully (has associated reports)',
        data: user
      });
    }

    // Hard delete if no associations
    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting user',
      error: error.message 
    });
  }
};

// @desc    Toggle user active status
// @route   PUT /api/toll-admin/users/:id/toggle-status
exports.toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { _id: user._id, isActive: user.isActive }
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error toggling user status',
      error: error.message 
    });
  }
};

// Helper functions
function calculatePlazaHealthScore(plaza, faultyLanes, openReports) {
  let score = 100;
  
  // Deduct for faulty lanes
  if (plaza.lanes && plaza.lanes.length > 0) {
    const faultyPercentage = (faultyLanes / plaza.lanes.length) * 100;
    score -= faultyPercentage * 0.5; // Deduct up to 50 points for faulty lanes
  }

  // Deduct for open reports
  score -= openReports * 2; // Deduct 2 points per open report

  // Deduct for overdue maintenance
  if (plaza.nextInspection && new Date(plaza.nextInspection) < new Date()) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateUserProductivity(resolvedReports, assignedTasks) {
  if (assignedTasks === 0) return 0;
  return Math.round((resolvedReports / (assignedTasks + resolvedReports)) * 100);
}