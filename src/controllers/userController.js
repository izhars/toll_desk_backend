// src/controllers/userController.js
const User = require('../models/User');
const mongoose = require('mongoose');
const Plaza = require('../models/TollPlaza'); // Add this import
const generateEmployeeId = require('../utils/generateEmployeeId');
// Add this to your routes file
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  }
});


// Controller function
exports.bulkRegisterUsers = async (req, res) => {
  try {
    // Check if file is uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an Excel file'
      });
    }

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Validate if data exists
    if (!data || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel file is empty'
      });
    }

    // Expected headers: name, email, employeeId
    const requiredHeaders = ['name', 'email', 'employeeId'];
    const firstRow = data[0];
    const missingHeaders = requiredHeaders.filter(header => !(header in firstRow));

    if (missingHeaders.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required columns: ${missingHeaders.join(', ')}`
      });
    }

    // Constants for bulk creation
    const DEFAULT_PASSWORD = 'Scaipl@123';
    const DEFAULT_ROLE = 'employee';
    const DEFAULT_DEPARTMENT = 'maintenance';
    const DEFAULT_PHONE = '';
    const DEFAULT_ASSIGNED_PLAZAS = [];

    const results = {
      created: [],
      updated: [],
      failed: [],
      total: data.length
    };

    // Process each row
    for (let index = 0; index < data.length; index++) {
      const row = data[index];

      try {
        // Validate required fields
        if (!row.name || !row.email || !row.employeeId) {
          results.failed.push({
            row: index + 1,
            data: row,
            reason: 'Missing required fields (name, email, or employeeId)'
          });
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(row.email)) {
          results.failed.push({
            row: index + 1,
            data: row,
            reason: 'Invalid email format'
          });
          continue;
        }

        // Check if user exists by employeeId
        let existingUser = await User.findOne({ employeeId: row.employeeId });

        // Also check by email to avoid duplicates
        const existingByEmail = await User.findOne({ email: row.email });

        if (existingUser || existingByEmail) {
          // Update existing user
          const userToUpdate = existingUser || existingByEmail;

          const updateData = {
            name: row.name,
            email: row.email,
            role: DEFAULT_ROLE,
            department: DEFAULT_DEPARTMENT,
            phone: DEFAULT_PHONE,
            assignedPlazas: DEFAULT_ASSIGNED_PLAZAS,
            updatedBy: req.user.id,
            updatedAt: Date.now()
          };

          // Only update password if explicitly needed (optional)
          // updateData.password = DEFAULT_PASSWORD;

          const updatedUser = await User.findByIdAndUpdate(
            userToUpdate._id,
            updateData,
            { new: true, runValidators: true }
          );

          results.updated.push({
            employeeId: row.employeeId,
            email: row.email,
            name: row.name,
            userId: updatedUser._id
          });
        } else {
          // Create new user
          const userData = {
            name: row.name,
            email: row.email,
            password: DEFAULT_PASSWORD,
            role: DEFAULT_ROLE,
            department: DEFAULT_DEPARTMENT,
            phone: DEFAULT_PHONE,
            employeeId: row.employeeId,
            assignedPlazas: DEFAULT_ASSIGNED_PLAZAS,
            createdBy: req.user.id
          };

          // Set supervisor if current user is supervisor
          if (req.user.role === 'supervisor') {
            userData.supervisor = req.user.id;
          }

          // Create user
          const newUser = await User.create(userData);

          // Update supervisor's subordinates
          if (userData.supervisor) {
            await User.findByIdAndUpdate(userData.supervisor, {
              $push: { subordinates: newUser._id }
            });
          }

          results.created.push({
            employeeId: row.employeeId,
            email: row.email,
            name: row.name,
            userId: newUser._id
          });
        }
      } catch (error) {
        results.failed.push({
          row: index + 1,
          data: row,
          reason: error.message
        });
      }
    }

    // Send response
    res.status(200).json({
      success: true,
      message: `Processed ${data.length} records. Created: ${results.created.length}, Updated: ${results.updated.length}, Failed: ${results.failed.length}`,
      data: {
        created: results.created,
        updated: results.updated,
        failed: results.failed,
        summary: {
          total: results.total,
          successful: results.created.length + results.updated.length,
          failed: results.failed.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Bulk Register Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.downloadBulkRegisterTemplate = async (req, res) => {
  try {
    const sampleData = [
      {
        name: 'John Doe',
        email: 'john.doe@example.com',
        employeeId: 'EMP001'
      },
      {
        name: 'Jane Smith',
        email: 'jane.smith@example.com',
        employeeId: 'EMP002'
      },
      {
        name: 'Bob Wilson',
        email: 'bob.wilson@example.com',
        employeeId: 'EMP003'
      }
    ];

    // Create sheet
    const ws = xlsx.utils.json_to_sheet(sampleData);

    // Create workbook
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Employees');

    // Convert to buffer
    const buffer = xlsx.write(wb, {
      type: 'buffer',
      bookType: 'xlsx'
    });

    // Headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=bulk_register_template.xlsx'
    );

    return res.send(buffer);

  } catch (error) {
    console.error('❌ Template Generation Error:', error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Create user (admin creates supervisor, supervisor creates employee)
// @route   POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, department, phone, assignedPlazas, employeeId } = req.body;

    // ✅ Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // ✅ If employeeId provided → use it, else auto-generate
    let finalEmployeeId = employeeId;
    if (!finalEmployeeId) {
      finalEmployeeId = await generateEmployeeId();
    }

    // ✅ Check duplicate employeeId
    const existingEmp = await User.findOne({ employeeId: finalEmployeeId });
    if (existingEmp) {
      return res.status(400).json({ message: 'Employee ID already exists' });
    }

    // ✅ Validate assigned plazas
    if (assignedPlazas && assignedPlazas.length > 0) {
      const validPlazas = await Plaza.find({ _id: { $in: assignedPlazas } });
      if (validPlazas.length !== assignedPlazas.length) {
        return res.status(400).json({ message: 'One or more plaza IDs are invalid' });
      }
    }

    // ✅ Prepare user data
    const userData = {
      name,
      email,
      password,
      role,
      department,
      employeeId: finalEmployeeId, // 👈 final value
      phone,
      createdBy: req.user.id,
      assignedPlazas: assignedPlazas || []
    };

    // ✅ Set supervisor
    if (req.user.role === 'supervisor') {
      userData.supervisor = req.user.id;
    }

    // ✅ Create user
    const user = await User.create(userData);

    // ✅ Update supervisor's subordinates
    if (userData.supervisor) {
      await User.findByIdAndUpdate(userData.supervisor, {
        $push: { subordinates: user._id }
      });
    }

    // ✅ Populate plaza details
    await user.populate('assignedPlazas', 'name location code');

    // ✅ Response
    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        employeeId: user.employeeId,
        profileImage: user.profileImage,
        supervisor: user.supervisor,
        assignedPlazas: user.assignedPlazas
      }
    });

  } catch (error) {
    console.error('❌ Create User Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Update user availability (true/false)
// @route   PATCH /api/users/availability
// @access  Private

exports.updateAvailability = async (req, res) => {
  try {
    const userId = req.user.id;
    const { isAvailable, notes } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isAvailable must be true or false'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add rate limiting (30 seconds between changes)
    const lastChange = user.availabilityHistory[user.availabilityHistory.length - 1];
    const timeSinceLastChange = lastChange ?
      new Date() - new Date(lastChange.changedAt) : Infinity;

    const MIN_CHANGE_INTERVAL = 30000; // 30 seconds

    if (timeSinceLastChange < MIN_CHANGE_INTERVAL && user.isAvailable !== isAvailable) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${Math.ceil((MIN_CHANGE_INTERVAL - timeSinceLastChange) / 1000)} seconds before changing status again`
      });
    }

    let currentSessionDuration = null;

    // Calculate duration for previous status if this is a change
    if (user.isAvailable !== isAvailable && user.availabilityHistory.length > 0) {
      const lastEntry = user.availabilityHistory[user.availabilityHistory.length - 1];
      if (lastEntry && !lastEntry.duration) {
        lastEntry.duration = new Date() - new Date(lastEntry.changedAt);
        lastEntry.notes = notes || lastEntry.notes;
      }
    } else if (user.isAvailable === isAvailable) {
      // If status hasn't changed, calculate current session duration
      const lastChangeEntry = user.availabilityHistory[user.availabilityHistory.length - 1];
      if (lastChangeEntry) {
        currentSessionDuration = new Date() - new Date(lastChangeEntry.changedAt);
      }
    }

    // Only store if changed
    if (user.isAvailable !== isAvailable) {
      user.availabilityHistory.push({
        status: isAvailable,
        changedAt: new Date(),
        notes: notes || null
      });

      // For new change, current session duration starts at 0
      currentSessionDuration = 0;
    }

    user.isAvailable = isAvailable;

    // Add automatic status expiry (optional)
    if (!isAvailable && req.body.autoAvailableAfter) {
      user.autoAvailableAfter = new Date(Date.now() + req.body.autoAvailableAfter);
    }

    await user.save();

    // Emit real-time update if using WebSockets
    if (req.io) {
      req.io.to(`user:${userId}`).emit('availability-changed', {
        userId: user._id,
        isAvailable: user.isAvailable,
        changedAt: new Date(),
        totalChanges: user.availabilityHistory.length
      });
    }

    // Get the last change duration (previous status duration)
    const lastChangeDuration = user.availabilityHistory.length > 1 ?
      user.availabilityHistory[user.availabilityHistory.length - 2]?.duration : null;

    res.status(200).json({
      success: true,
      message: `Availability updated to ${isAvailable}`,
      data: {
        isAvailable: user.isAvailable,
        totalChanges: user.availabilityHistory.length,
        lastChangeDuration: lastChangeDuration, // Duration of the previous status
        currentSessionDuration: currentSessionDuration // Duration of current status
      }
    });

  } catch (error) {
    console.error('❌ Update availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.getAvailabilityStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30, startDate, endDate } = req.query;

    const user = await User.findById(userId)
      .select('availabilityHistory isAvailable name');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const history = user.availabilityHistory || [];

    // Date filtering
    let filteredHistory = [...history];
    let startFilterDate, endFilterDate;

    if (startDate && endDate) {
      startFilterDate = new Date(startDate);
      endFilterDate = new Date(endDate);
      filteredHistory = history.filter(entry =>
        entry.changedAt >= startFilterDate && entry.changedAt <= endFilterDate
      );
    } else if (days) {
      endFilterDate = new Date();
      startFilterDate = new Date();
      startFilterDate.setDate(startFilterDate.getDate() - parseInt(days));
      filteredHistory = history.filter(entry => entry.changedAt >= startFilterDate);
    }

    let availableCount = 0;
    let unavailableCount = 0;
    let totalAvailableTime = 0;
    let totalUnavailableTime = 0;

    // Calculate durations
    for (let i = 0; i < filteredHistory.length; i++) {
      const entry = filteredHistory[i];
      if (entry.status) availableCount++;
      else unavailableCount++;

      // Calculate duration if not already stored
      let duration = entry.duration;
      if (!duration && i < filteredHistory.length - 1) {
        duration = new Date(filteredHistory[i + 1].changedAt) - new Date(entry.changedAt);
      } else if (!duration && i === filteredHistory.length - 1) {
        duration = new Date() - new Date(entry.changedAt);
      }

      if (entry.status) {
        totalAvailableTime += duration || 0;
      } else {
        totalUnavailableTime += duration || 0;
      }
    }

    // Get last change
    const lastChange = history.length > 0 ? history[history.length - 1] : null;

    // Calculate current session duration
    let currentSessionDuration = null;
    if (lastChange) {
      currentSessionDuration = new Date() - new Date(lastChange.changedAt);
    }

    // Calculate availability percentage
    const totalTime = totalAvailableTime + totalUnavailableTime;
    const availabilityPercentage = totalTime > 0 ?
      ((totalAvailableTime / totalTime) * 100).toFixed(2) : 100;

    res.status(200).json({
      success: true,
      stats: {
        currentStatus: user.isAvailable ? 'Available' : 'Unavailable',
        currentSessionDuration: currentSessionDuration,
        totalChanges: history.length,
        changesInPeriod: filteredHistory.length,
        becameAvailable: availableCount,
        becameUnavailable: unavailableCount,
        totalAvailableTime: totalAvailableTime,
        totalUnavailableTime: totalUnavailableTime,
        availabilityPercentage: parseFloat(availabilityPercentage),
        lastChangedAt: lastChange?.changedAt || null,
        periodStart: startFilterDate || null,
        periodEnd: endFilterDate || null
      },
      timeline: filteredHistory.map(entry => ({
        status: entry.status ? 'Available' : 'Unavailable',
        time: entry.changedAt,
        duration: entry.duration,
        notes: entry.notes || null
      }))
    });

  } catch (error) {
    console.error('❌ Availability stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


exports.getUserAvailabilityStats = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId)
      .select('name email role availabilityHistory isAvailable');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const history = user.availabilityHistory || [];

    let availableCount = 0;
    let unavailableCount = 0;

    history.forEach(entry => {
      if (entry.status) availableCount++;
      else unavailableCount++;
    });

    const lastChange = history.length > 0
      ? history[history.length - 1]
      : null;

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      stats: {
        currentStatus: user.isAvailable ? 'Available' : 'Unavailable',
        totalChanges: history.length,
        becameAvailable: availableCount,
        becameUnavailable: unavailableCount,
        lastChangedAt: lastChange?.changedAt || null
      },
      timeline: history.map(entry => ({
        status: entry.status ? 'Available' : 'Unavailable',
        time: entry.changedAt
      }))
    });

  } catch (error) {
    console.error('❌ Admin availability stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.getMyAvailabilityStats = async (req, res) => {
  try {
    const userId = req.user.id; // 👈 from auth middleware

    const user = await User.findById(userId)
      .select('name email role availabilityHistory isAvailable');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const history = user.availabilityHistory || [];

    let availableCount = 0;
    let unavailableCount = 0;

    history.forEach(entry => {
      if (entry.status) availableCount++;
      else unavailableCount++;
    });

    const lastChange = history.length > 0
      ? history[history.length - 1]
      : null;

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      stats: {
        currentStatus: user.isAvailable ? 'Available' : 'Unavailable',
        totalChanges: history.length,
        becameAvailable: availableCount,
        becameUnavailable: unavailableCount,
        lastChangedAt: lastChange?.changedAt || null
      },
      timeline: history.map(entry => ({
        status: entry.status ? 'Available' : 'Unavailable',
        time: entry.changedAt
      }))
    });

  } catch (error) {
    console.error('❌ Self availability stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get all users (filtered by role)
// @route   GET /api/users
// ---------------- GET ALL USERS (hide admins) ----------------
// @desc    Get all users (filtered by role) with their assigned reports
// @route   GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const MaintenanceReport = mongoose.model('MaintenanceReport');

    // Get ALL users (including admin)
    const users = await User.find({})
      .select('-password')
      .populate('supervisor', 'name email role')
      .populate('createdBy', 'name email')
      .populate('assignedPlazas', 'name location code')
      .lean();

    const usersWithReports = await Promise.all(
      users.map(async (user) => {

        // ───── SUPERVISOR ─────
        if (user.role === 'supervisor') {
          const assignedReports = await MaintenanceReport.find({
            assignedTo: user._id
          })
            .select('title reportId status priority issueType createdAt plazaId')
            .populate('plazaId', 'name location')
            .sort('-createdAt')
            .limit(10);

          const totalReports = await MaintenanceReport.countDocuments({
            assignedTo: user._id
          });

          const reportCounts = await MaintenanceReport.aggregate([
            { $match: { assignedTo: user._id } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ]);

          const countsByStatus = {};
          reportCounts.forEach(item => {
            countsByStatus[item._id] = item.count;
          });

          return {
            ...user,
            assignedReports: {
              recent: assignedReports,
              counts: countsByStatus,
              total: totalReports
            }
          };
        }

        // ───── EMPLOYEE ─────
        if (user.role === 'employee') {
          const createdReports = await MaintenanceReport.find({
            reportedBy: user._id
          })
            .select('title reportId status priority issueType createdAt plazaId')
            .populate('plazaId', 'name location')
            .sort('-createdAt')
            .limit(5);

          const totalReports = await MaintenanceReport.countDocuments({
            reportedBy: user._id
          });

          return {
            ...user,
            createdReports: {
              recent: createdReports,
              total: totalReports
            }
          };
        }

        // ───── ADMIN ─────
        if (user.role === 'admin') {
          const adminReports = await MaintenanceReport.find({
            reportedBy: user._id
          })
            .select('title reportId status priority issueType createdAt plazaId assignedTo')
            .populate('plazaId', 'name location')
            .populate('assignedTo', 'name email role')
            .sort('-createdAt')
            .limit(10);

          const totalReports = await MaintenanceReport.countDocuments({
            reportedBy: user._id
          });

          const reportCounts = await MaintenanceReport.aggregate([
            { $match: { reportedBy: user._id } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ]);

          const countsByStatus = {};
          reportCounts.forEach(item => {
            countsByStatus[item._id] = item.count;
          });

          return {
            ...user,
            adminReports: {
              recent: adminReports,
              counts: countsByStatus,
              total: totalReports
            }
          };
        }

        // fallback (just in case)
        return user;
      })
    );

    res.json({
      success: true,
      count: usersWithReports.length,
      users: usersWithReports
    });

  } catch (error) {
    console.error('Error in getUsers:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @desc    Get user by ID with their reports
// @route   GET /api/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('supervisor', 'name email')
      .populate('subordinates', 'name email role')
      .populate('createdBy', 'name email')
      .populate('assignedPlazas', 'name location code') // Populate assigned plazas
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const MaintenanceReport = mongoose.model('MaintenanceReport');

    // Add report information based on user role
    if (user.role === 'supervisor') {
      const assignedReports = await MaintenanceReport.find({ assignedTo: user._id })
        .select('title reportId status priority issueType createdAt plazaId')
        .populate('plazaId', 'name')
        .sort('-createdAt');

      user.assignedReports = assignedReports;
    }

    // Always get reports created by this user
    const createdReports = await MaintenanceReport.find({ reportedBy: user._id })
      .select('title reportId status priority issueType createdAt plazaId')
      .populate('plazaId', 'name')
      .sort('-createdAt');

    user.createdReports = createdReports;

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove user from supervisor's subordinates list
    if (user.supervisor) {
      await User.findByIdAndUpdate(user.supervisor, {
        $pull: { subordinates: user._id }
      });
    }

    // Handle subordinates reassignment
    if (user.subordinates && user.subordinates.length > 0) {
      if (user.role === 'supervisor') {
        // Reassign subordinates to the admin or their supervisor
        await User.updateMany(
          { supervisor: user._id },
          { supervisor: user.createdBy }
        );
      }
    }

    // Remove user from any reports they're assigned to
    const MaintenanceReport = mongoose.model('MaintenanceReport');
    await MaintenanceReport.updateMany(
      { assignedTo: user._id },
      { $unset: { assignedTo: 1 } }
    );

    await user.deleteOne();

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get supervisor's subordinates
// @route   GET /api/users/supervisor/subordinates
exports.getMySubordinates = async (req, res) => {
  try {
    const users = await User.find({ supervisor: req.user.id })
      .select('-password')
      .populate('assignedPlazas', 'name location code');

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's supervisor
// @route   GET /api/users/me/supervisor
exports.getMySupervisor = async (req, res) => {
  try {
    if (!req.user.supervisor) {
      return res.json({
        success: true,
        supervisor: null,
        message: 'No supervisor assigned'
      });
    }

    const supervisor = await User.findById(req.user.supervisor)
      .select('name email role department phone')
      .populate('assignedPlazas', 'name location code');

    res.json({
      success: true,
      supervisor
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user hierarchy
// @route   GET /api/users/:id/hierarchy
exports.getUserHierarchy = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('supervisor')
      .populate({
        path: 'subordinates',
        populate: {
          path: 'subordinates'
        }
      })
      .populate('assignedPlazas', 'name location code');

    res.json({
      success: true,
      hierarchy: user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get available plazas for assignment
// @route   GET /api/users/available-plazas
exports.getAvailablePlazas = async (req, res) => {
  try {
    const plazas = await Plaza.find({ isActive: true })
      .select('name location code')
      .sort('name');

    res.json({
      success: true,
      plazas
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add plaza to user's assigned plazas
// @route   POST /api/users/:id/plazas
exports.addUserPlaza = async (req, res) => {
  try {
    const { plazaId } = req.body;

    // Validate plaza exists
    const plaza = await Plaza.findById(plazaId);
    if (!plaza) {
      return res.status(404).json({ message: 'Plaza not found' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { assignedPlazas: plazaId } }, // $addToSet prevents duplicates
      { new: true }
    )
      .select('-password')
      .populate('assignedPlazas', 'name location code');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Remove plaza from user's assigned plazas
// @route   DELETE /api/users/:id/plazas/:plazaId
exports.removeUserPlaza = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $pull: { assignedPlazas: req.params.plazaId } },
      { new: true }
    )
      .select('-password')
      .populate('assignedPlazas', 'name location code');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get supervisor performance statistics
// @route   GET /api/users/supervisor/:id/stats
// @route   GET /api/users/me/supervisor-stats (for current supervisor)
exports.getSupervisorStats = async (req, res) => {
  try {
    // Get supervisor ID from params or use current user
    const supervisorId = req.params.id || req.user.id;

    // Verify the user is a supervisor
    const supervisor = await User.findById(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (supervisor.role !== 'supervisor' && supervisor.role !== 'admin') {
      return res.status(403).json({ message: 'User is not a supervisor' });
    }

    const MaintenanceReport = mongoose.model('MaintenanceReport');

    // Get current date for time calculations
    const now = new Date();

    // 1. Reports assigned TO this supervisor (by others)
    const assignedToSupervisor = await MaintenanceReport.find({
      assignedTo: supervisorId
    });

    // 2. Reports assigned BY this supervisor (where supervisor is the one who assigned)
    const assignedBySupervisor = await MaintenanceReport.find({
      'timeline': {
        $elemMatch: {
          status: 'assigned',
          changedBy: supervisorId
        }
      }
    });

    // 3. Reports created BY this supervisor
    const createdBySupervisor = await MaintenanceReport.find({
      reportedBy: supervisorId
    });

    // 4. Reports where supervisor is currently assigned (regardless of who assigned)
    const currentlyAssignedToSupervisor = await MaintenanceReport.find({
      assignedTo: supervisorId,
      status: { $in: ['open', 'assigned', 'in_progress', 'fixed', 'reopened'] }
    });

    // 5. Reports CLOSED that were assigned to this supervisor (FIX THIS)
    const closedReportsAssignedToSupervisor = await MaintenanceReport.find({
      assignedTo: supervisorId,
      status: 'closed'
    });

    // 6. Reports FIXED that were assigned to this supervisor
    const fixedReportsAssignedToSupervisor = await MaintenanceReport.find({
      assignedTo: supervisorId,
      status: 'fixed'
    });

    // 7. Reports where supervisor marked as fixed (in timeline)
    const fixedBySupervisor = await MaintenanceReport.find({
      'timeline': {
        $elemMatch: {
          status: 'fixed',
          changedBy: supervisorId
        }
      }
    });

    // 8. Reports where supervisor marked as closed (in timeline)
    const closedBySupervisor = await MaintenanceReport.find({
      'timeline': {
        $elemMatch: {
          status: 'closed',
          changedBy: supervisorId
        }
      }
    });

    // 9. Reports reopened by this supervisor
    const reopenedBySupervisor = await MaintenanceReport.find({
      'timeline': {
        $elemMatch: {
          status: 'reopened',
          changedBy: supervisorId
        }
      }
    });

    // 10. Calculate total handled (reports where supervisor took any action)
    const handledBySupervisor = await MaintenanceReport.find({
      $or: [
        { assignedTo: supervisorId },
        { 'timeline.changedBy': supervisorId }
      ]
    });

    // 11. Time analysis
    const timeAnalysis = await calculateTimeAnalysis(supervisorId, MaintenanceReport);

    // 12. Performance metrics by priority
    const priorityMetrics = await getPriorityMetrics(supervisorId, MaintenanceReport);

    // 13. Monthly statistics
    const monthlyStats = await getMonthlyStats(supervisorId, MaintenanceReport);

    // 14. Resolution success rate
    const resolutionMetrics = await getResolutionMetrics(supervisorId, MaintenanceReport);

    // 15. Active reports
    const activeReports = await MaintenanceReport.find({
      assignedTo: supervisorId,
      status: { $in: ['open', 'assigned', 'in_progress', 'fixed', 'reopened'] }
    });

    // Calculate corrected totals
    const totalAssignedTo = assignedToSupervisor.length;
    const totalResolved = fixedReportsAssignedToSupervisor.length + closedReportsAssignedToSupervisor.length;
    const resolutionRate = totalAssignedTo > 0 ? ((totalResolved / totalAssignedTo) * 100).toFixed(2) : '0';

    // Compile the response
    const stats = {
      supervisor: {
        id: supervisor._id,
        name: supervisor.name,
        email: supervisor.email,
        department: supervisor.department
      },
      summary: {
        totalAssignedTo: totalAssignedTo,
        totalAssignedBy: assignedBySupervisor.length,
        totalCreated: createdBySupervisor.length,
        totalHandled: handledBySupervisor.length,
        totalClosed: closedReportsAssignedToSupervisor.length, // FIXED: Count closed reports
        totalFixed: fixedReportsAssignedToSupervisor.length,   // FIXED: Count fixed reports
        totalReopened: reopenedBySupervisor.length,
        currentlyActive: activeReports.length,
        resolutionRate: `${resolutionRate}%`  // Add resolution rate to summary
      },
      detailed: {
        assignedTo: {
          total: totalAssignedTo,
          byStatus: await groupByStatus(assignedToSupervisor),
          byPriority: await groupByPriority(assignedToSupervisor),
          recent: assignedToSupervisor.slice(0, 5).map(r => ({
            id: r._id,
            reportId: r.reportId,
            title: r.title,
            status: r.status,
            priority: r.priority,
            createdAt: r.createdAt
          }))
        },
        assignedBy: {
          total: assignedBySupervisor.length,
          byStatus: await groupByStatus(assignedBySupervisor),
          byPriority: await groupByPriority(assignedBySupervisor)
        },
        created: {
          total: createdBySupervisor.length,
          byStatus: await groupByStatus(createdBySupervisor),
          byPriority: await groupByPriority(createdBySupervisor)
        },
        handled: {
          total: handledBySupervisor.length,
          byAction: {
            assigned: assignedBySupervisor.length,
            closed: closedBySupervisor.length,
            fixed: fixedBySupervisor.length,
            reopened: reopenedBySupervisor.length,
            other: handledBySupervisor.length - (
              assignedBySupervisor.length + closedBySupervisor.length +
              fixedBySupervisor.length + reopenedBySupervisor.length
            )
          }
        }
      },
      timeMetrics: timeAnalysis,
      priorityMetrics: priorityMetrics,
      resolutionMetrics: {
        ...resolutionMetrics,
        resolutionRate: `${resolutionRate}%`, // Use corrected rate
        totalResolved: totalResolved,
        totalClosed: closedReportsAssignedToSupervisor.length,
        totalFixed: fixedReportsAssignedToSupervisor.length
      },
      monthlyStats: monthlyStats,
      activeReports: {
        count: activeReports.length,
        list: activeReports.slice(0, 10).map(r => ({
          id: r._id,
          reportId: r.reportId,
          title: r.title,
          status: r.status,
          priority: r.priority,
          daysOpen: Math.floor((now - new Date(r.createdAt)) / (1000 * 60 * 60 * 24))
        }))
      }
    };

    // Add performance ratings
    stats.performance = calculatePerformanceRatings(stats);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Error in getSupervisorStats:', error);
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get all supervisors with their stats (for admin dashboard)
// @route   GET /api/users/supervisors/stats
exports.getAllSupervisorsStats = async (req, res) => {
  try {
    // Find all supervisors
    const supervisors = await User.find({
      role: 'supervisor'
    }).select('name email department assignedPlazas');

    const supervisorsStats = await Promise.all(
      supervisors.map(async (supervisor) => {
        const MaintenanceReport = mongoose.model('MaintenanceReport');

        // Get basic stats for each supervisor
        const [
          assignedToCount,
          assignedByCount,
          createdCount,
          closedCount,
          fixedCount,
          reopenedCount,
          avgResolutionTime,
          activeAssignments
        ] = await Promise.all([
          MaintenanceReport.countDocuments({ assignedTo: supervisor._id }),
          MaintenanceReport.countDocuments({
            'timeline': {
              $elemMatch: {
                status: 'assigned',
                changedBy: supervisor._id
              }
            }
          }),
          MaintenanceReport.countDocuments({ reportedBy: supervisor._id }),
          MaintenanceReport.countDocuments({
            'timeline': {
              $elemMatch: {
                status: 'closed',
                changedBy: supervisor._id
              }
            }
          }),
          MaintenanceReport.countDocuments({
            'timeline': {
              $elemMatch: {
                status: 'fixed',
                changedBy: supervisor._id
              }
            }
          }),
          MaintenanceReport.countDocuments({
            'timeline': {
              $elemMatch: {
                status: 'reopened',
                changedBy: supervisor._id
              }
            }
          }),
          calculateAverageResolutionTime(supervisor._id, MaintenanceReport),
          MaintenanceReport.countDocuments({
            assignedTo: supervisor._id,
            status: { $in: ['open', 'assigned', 'in_progress', 'fixed', 'reopened'] }
          })
        ]);

        // Calculate resolution rate
        const totalHandled = closedCount + fixedCount;
        const totalAssigned = assignedToCount;
        const resolutionRate = totalAssigned > 0
          ? ((totalHandled / totalAssigned) * 100).toFixed(2) + '%'
          : '0%';

        return {
          id: supervisor._id,
          name: supervisor.name,
          email: supervisor.email,
          department: supervisor.department,
          assignedPlazas: supervisor.assignedPlazas,
          stats: {
            assignedTo: assignedToCount,
            assignedBy: assignedByCount,
            created: createdCount,
            closed: closedCount,
            fixed: fixedCount,
            reopened: reopenedCount,
            activeAssignments: activeAssignments,
            avgResolutionTime: avgResolutionTime,
            resolutionRate: resolutionRate
          }
        };
      })
    );

    // Sort by resolution rate (highest first)
    supervisorsStats.sort((a, b) => {
      const rateA = parseFloat(a.stats.resolutionRate) || 0;
      const rateB = parseFloat(b.stats.resolutionRate) || 0;
      return rateB - rateA;
    });

    res.json({
      success: true,
      count: supervisorsStats.length,
      supervisors: supervisorsStats
    });

  } catch (error) {
    console.error('Error in getAllSupervisorsStats:', error);
    res.status(500).json({ message: error.message });
  }
};

// Helper Functions

async function calculateTimeAnalysis(supervisorId, MaintenanceReport) {
  const reports = await MaintenanceReport.find({
    $or: [
      { assignedTo: supervisorId },
      { 'timeline.changedBy': supervisorId }
    ]
  });

  let totalTimeFromAssignedToFixed = 0;
  let fixedCount = 0;
  let totalTimeFromAssignedToClosed = 0;
  let closedCount = 0;
  let totalTimeFromCreatedToFixed = 0;
  let createdFixedCount = 0;
  let totalTimeFromReopenedToFixed = 0;
  let reopenedFixedCount = 0;

  reports.forEach(report => {
    // Find assignment event
    const assignedEvent = report.timeline.find(t => t.status === 'assigned');
    // Find fixed event
    const fixedEvent = report.timeline.find(t => t.status === 'fixed');
    // Find closed event
    const closedEvent = report.timeline.find(t => t.status === 'closed');
    // Find reopened event
    const reopenedEvent = report.timeline.find(t => t.status === 'reopened');

    if (assignedEvent && fixedEvent) {
      const timeDiff = (new Date(fixedEvent.changedAt) - new Date(assignedEvent.changedAt)) / (1000 * 60 * 60); // hours
      totalTimeFromAssignedToFixed += timeDiff;
      fixedCount++;
    }

    if (assignedEvent && closedEvent) {
      const timeDiff = (new Date(closedEvent.changedAt) - new Date(assignedEvent.changedAt)) / (1000 * 60 * 60);
      totalTimeFromAssignedToClosed += timeDiff;
      closedCount++;
    }

    if (report.reportedBy.toString() === supervisorId.toString() && fixedEvent) {
      const timeDiff = (new Date(fixedEvent.changedAt) - new Date(report.createdAt)) / (1000 * 60 * 60);
      totalTimeFromCreatedToFixed += timeDiff;
      createdFixedCount++;
    }

    if (reopenedEvent && fixedEvent && reopenedEvent.changedAt < fixedEvent.changedAt) {
      const timeDiff = (new Date(fixedEvent.changedAt) - new Date(reopenedEvent.changedAt)) / (1000 * 60 * 60);
      totalTimeFromReopenedToFixed += timeDiff;
      reopenedFixedCount++;
    }
  });

  return {
    averageTimeFromAssignedToFixed: fixedCount > 0 ?
      formatTimeDuration(totalTimeFromAssignedToFixed / fixedCount) : 'N/A',
    averageTimeFromAssignedToClosed: closedCount > 0 ?
      formatTimeDuration(totalTimeFromAssignedToClosed / closedCount) : 'N/A',
    averageTimeFromCreatedToFixed: createdFixedCount > 0 ?
      formatTimeDuration(totalTimeFromCreatedToFixed / createdFixedCount) : 'N/A',
    averageTimeFromReopenedToFixed: reopenedFixedCount > 0 ?
      formatTimeDuration(totalTimeFromReopenedToFixed / reopenedFixedCount) : 'N/A',
    totalReportsTracked: {
      fixed: fixedCount,
      closed: closedCount,
      createdAndFixed: createdFixedCount,
      reopenedAndFixed: reopenedFixedCount
    }
  };
}

function formatTimeDuration(hours) {
  if (hours < 24) {
    return `${hours.toFixed(1)} hours`;
  } else if (hours < 168) { // 7 days
    const days = Math.floor(hours / 24);
    const remainingHours = (hours % 24).toFixed(0);
    return `${days} days ${remainingHours} hours`;
  } else {
    const days = Math.floor(hours / 24);
    return `${days} days`;
  }
}

async function getPriorityMetrics(supervisorId, MaintenanceReport) {
  const priorities = ['critical', 'high', 'medium', 'low'];
  const metrics = {};

  for (const priority of priorities) {
    // Get all reports assigned to this supervisor with this priority
    const reports = await MaintenanceReport.find({
      assignedTo: supervisorId,
      priority: priority
    });

    // Count reports that are fixed (by anyone)
    const fixedByAnyone = reports.filter(r => r.status === 'fixed');
    
    // Count reports fixed specifically by this supervisor
    const fixedBySupervisor = reports.filter(r => 
      r.timeline && r.timeline.some(t => 
        t.status === 'fixed' && t.changedBy?.toString() === supervisorId.toString()
      )
    );
    
    // Count reports that are closed (by anyone)
    const closedByAnyone = reports.filter(r => r.status === 'closed');
    
    // Count reports closed specifically by this supervisor
    const closedBySupervisor = reports.filter(r => 
      r.timeline && r.timeline.some(t => 
        t.status === 'closed' && t.changedBy?.toString() === supervisorId.toString()
      )
    );
    
    // Count reports that were reopened (by anyone)
    const reopenedByAnyone = reports.filter(r => 
      r.status === 'reopened' || 
      (r.timeline && r.timeline.some(t => t.status === 'reopened'))
    );
    
    // Count reports reopened specifically by this supervisor
    const reopenedBySupervisor = reports.filter(r => 
      r.timeline && r.timeline.some(t => 
        t.status === 'reopened' && t.changedBy?.toString() === supervisorId.toString()
      )
    );

    // Calculate completion rate (fixed + closed by anyone) / total * 100
    const completed = fixedByAnyone.length + closedByAnyone.length;
    const completionRate = reports.length > 0 
      ? ((completed / reports.length) * 100).toFixed(2) + '%' 
      : '0%';

    metrics[priority] = {
      total: reports.length,
      fixed: fixedByAnyone.length,
      fixedBySupervisor: fixedBySupervisor.length,
      closed: closedByAnyone.length,
      closedBySupervisor: closedBySupervisor.length,
      reopened: reopenedByAnyone.length,
      reopenedBySupervisor: reopenedBySupervisor.length,
      completionRate: completionRate
    };
  }

  return metrics;
}

async function getResolutionMetrics(supervisorId, MaintenanceReport) {
  // Get all reports assigned to this supervisor
  const assignedReports = await MaintenanceReport.find({
    assignedTo: supervisorId
  });

  const totalReports = assignedReports.length;

  // Reports that are closed or fixed (resolved)
  const resolvedReports = assignedReports.filter(r =>
    r.status === 'closed' || r.status === 'fixed'
  );

  const totalResolved = resolvedReports.length;

  // Reports that were reopened at any point
  const reopenedReports = assignedReports.filter(r =>
    r.timeline.some(t => t.status === 'reopened')
  );

  // Reports that were fixed first time without reopening
  const firstTimeFix = assignedReports.filter(r =>
    r.status === 'closed' &&
    r.timeline.some(t => t.status === 'fixed') &&
    !r.timeline.some(t => t.status === 'reopened')
  );

  const resolutionRate = totalReports > 0 ? ((totalResolved / totalReports) * 100).toFixed(2) : '0';
  const reopenedRate = totalResolved > 0 ? ((reopenedReports.length / totalResolved) * 100).toFixed(2) : '0';
  const firstTimeFixRate = totalResolved > 0 ? ((firstTimeFix.length / totalResolved) * 100).toFixed(2) : '0';

  return {
    resolutionRate: resolutionRate + '%',
    reopenedRate: reopenedRate + '%',
    firstTimeFixRate: firstTimeFixRate + '%',
    totalResolved: totalResolved,
    totalReopened: reopenedReports.length,
    firstTimeFixes: firstTimeFix.length,
    totalClosed: assignedReports.filter(r => r.status === 'closed').length,
    totalFixed: assignedReports.filter(r => r.status === 'fixed').length
  };
}

async function getMonthlyStats(supervisorId, MaintenanceReport) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const reports = await MaintenanceReport.find({
    $or: [
      { assignedTo: supervisorId },
      { reportedBy: supervisorId }
    ],
    createdAt: { $gte: sixMonthsAgo }
  }).sort('createdAt');

  const monthlyStats = {};
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  reports.forEach(report => {
    const date = new Date(report.createdAt);
    const monthKey = `${monthNames[date.getMonth()]} ${date.getFullYear().toString().slice(-2)}`;

    if (!monthlyStats[monthKey]) {
      monthlyStats[monthKey] = {
        assigned: 0,
        created: 0,
        fixed: 0,
        closed: 0,
        reopened: 0
      };
    }

    // Check if assigned to supervisor (reports assigned TO this supervisor)
    if (report.assignedTo && report.assignedTo.toString() === supervisorId.toString()) {
      monthlyStats[monthKey].assigned++;
    }

    // Check if created by supervisor (reports created BY this supervisor)
    if (report.reportedBy && report.reportedBy.toString() === supervisorId.toString()) {
      monthlyStats[monthKey].created++;
    }

    // Count when the report was fixed (regardless of who fixed it)
    if (report.status === 'fixed') {
      const fixedDate = new Date(report.updatedAt || report.createdAt);
      const fixedMonthKey = `${monthNames[fixedDate.getMonth()]} ${fixedDate.getFullYear().toString().slice(-2)}`;

      if (fixedMonthKey === monthKey) {
        monthlyStats[monthKey].fixed++;
      } else if (!monthlyStats[fixedMonthKey]) {
        // Initialize if this is a different month
        monthlyStats[fixedMonthKey] = {
          assigned: 0,
          created: 0,
          fixed: 0,
          closed: 0,
          reopened: 0
        };
        monthlyStats[fixedMonthKey].fixed++;
      } else {
        monthlyStats[fixedMonthKey].fixed++;
      }
    }

    // Count when the report was closed (regardless of who closed it)
    if (report.status === 'closed') {
      const closedDate = new Date(report.closedAt || report.updatedAt || report.createdAt);
      const closedMonthKey = `${monthNames[closedDate.getMonth()]} ${closedDate.getFullYear().toString().slice(-2)}`;

      if (closedMonthKey === monthKey) {
        monthlyStats[monthKey].closed++;
      } else if (!monthlyStats[closedMonthKey]) {
        monthlyStats[closedMonthKey] = {
          assigned: 0,
          created: 0,
          fixed: 0,
          closed: 0,
          reopened: 0
        };
        monthlyStats[closedMonthKey].closed++;
      } else {
        monthlyStats[closedMonthKey].closed++;
      }
    }

    // Count when the report was reopened (regardless of who reopened it)
    if (report.status === 'reopened') {
      const reopenedDate = new Date(report.updatedAt || report.createdAt);
      const reopenedMonthKey = `${monthNames[reopenedDate.getMonth()]} ${reopenedDate.getFullYear().toString().slice(-2)}`;

      if (reopenedMonthKey === monthKey) {
        monthlyStats[monthKey].reopened++;
      } else if (!monthlyStats[reopenedMonthKey]) {
        monthlyStats[reopenedMonthKey] = {
          assigned: 0,
          created: 0,
          fixed: 0,
          closed: 0,
          reopened: 0
        };
        monthlyStats[reopenedMonthKey].reopened++;
      } else {
        monthlyStats[reopenedMonthKey].reopened++;
      }
    }
  });

  // Sort months chronologically
  const sortedStats = {};
  Object.keys(monthlyStats)
    .sort((a, b) => {
      const [aMonth, aYear] = a.split(' ');
      const [bMonth, bYear] = b.split(' ');
      const yearCompare = parseInt(aYear) - parseInt(bYear);
      if (yearCompare !== 0) return yearCompare;

      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return monthOrder.indexOf(aMonth) - monthOrder.indexOf(bMonth);
    })
    .forEach(key => {
      sortedStats[key] = monthlyStats[key];
    });

  return sortedStats;
}

async function groupByStatus(reports) {
  const grouped = {};
  reports.forEach(report => {
    grouped[report.status] = (grouped[report.status] || 0) + 1;
  });
  return grouped;
}

async function groupByPriority(reports) {
  const grouped = {};
  reports.forEach(report => {
    grouped[report.priority] = (grouped[report.priority] || 0) + 1;
  });
  return grouped;
}

function calculatePerformanceRatings(stats) {
  const ratings = {
    efficiency: 'Average',
    reliability: 'Average',
    workload: 'Average',
    quality: 'Average'
  };

  // Calculate efficiency based on resolution time
  if (stats.timeMetrics.averageTimeFromAssignedToFixed !== 'N/A') {
    const timeStr = stats.timeMetrics.averageTimeFromAssignedToFixed;
    if (timeStr.includes('hours')) {
      const hours = parseFloat(timeStr);
      if (hours < 24) ratings.efficiency = 'Excellent';
      else if (hours < 48) ratings.efficiency = 'Good';
      else if (hours < 72) ratings.efficiency = 'Average';
      else ratings.efficiency = 'Needs Improvement';
    } else if (timeStr.includes('days')) {
      const days = parseFloat(timeStr);
      if (days < 2) ratings.efficiency = 'Excellent';
      else if (days < 3) ratings.efficiency = 'Good';
      else if (days < 5) ratings.efficiency = 'Average';
      else ratings.efficiency = 'Needs Improvement';
    }
  }

  // Calculate reliability based on completion rate
  const totalAssigned = stats.summary.totalAssignedTo;
  const totalHandled = stats.summary.totalHandled;
  if (totalAssigned > 0) {
    const completionRate = (totalHandled / totalAssigned) * 100;
    if (completionRate > 80) ratings.reliability = 'Excellent';
    else if (completionRate > 60) ratings.reliability = 'Good';
    else if (completionRate > 40) ratings.reliability = 'Average';
    else ratings.reliability = 'Needs Improvement';
  }

  // Calculate quality based on reopen rate
  if (stats.resolutionMetrics) {
    const reopenRate = parseFloat(stats.resolutionMetrics.reopenedRate) || 0;
    if (reopenRate < 5) ratings.quality = 'Excellent';
    else if (reopenRate < 10) ratings.quality = 'Good';
    else if (reopenRate < 20) ratings.quality = 'Average';
    else ratings.quality = 'Needs Improvement';
  }

  // Calculate workload
  const activeCount = stats.activeReports?.count || 0;
  if (activeCount < 5) ratings.workload = 'Light';
  else if (activeCount < 10) ratings.workload = 'Moderate';
  else if (activeCount < 15) ratings.workload = 'Heavy';
  else ratings.workload = 'Critical';

  return ratings;
}

async function calculateAverageResolutionTime(supervisorId, MaintenanceReport) {
  const reports = await MaintenanceReport.find({
    $and: [
      { assignedTo: supervisorId },
      { 'timeline.status': 'fixed' }
    ]
  });

  let totalTime = 0;
  let count = 0;

  reports.forEach(report => {
    const assignedEvent = report.timeline.find(t => t.status === 'assigned');
    const fixedEvent = report.timeline.find(t => t.status === 'fixed');

    if (assignedEvent && fixedEvent) {
      const timeDiff = (new Date(fixedEvent.changedAt) - new Date(assignedEvent.changedAt)) / (1000 * 60 * 60);
      totalTime += timeDiff;
      count++;
    }
  });

  return count > 0 ? formatTimeDuration(totalTime / count) : 'N/A';
}


// @desc    Update last login time
// @route   PATCH /api/users/last-login
// @access  Private
exports.updateLastLogin = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByIdAndUpdate(
      userId,
      { lastLogin: new Date() },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Last login updated',
      lastLogin: user.lastLogin
    });

  } catch (error) {
    console.error('❌ Last login update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


// @desc    Delete selected login history entries
// @route   DELETE /api/users/login-history
// @access  Private (Self / Admin / Supervisor)
exports.deleteLoginHistory = async (req, res) => {
  try {
    const { historyIds, userId } = req.body;

    // If admin/supervisor sends userId → delete for that user
    // else → delete own history
    const targetUserId = userId || req.user.id;

    if (!historyIds || !Array.isArray(historyIds) || historyIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'historyIds array is required'
      });
    }

    const user = await User.findByIdAndUpdate(
      targetUserId,
      {
        $pull: {
          loginHistory: {
            _id: { $in: historyIds }
          }
        }
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Selected login history deleted successfully',
      remainingHistory: user.loginHistory
    });
  } catch (error) {
    console.error('❌ Delete login history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


// @desc    Delete selected login history of a specific user
// @route   DELETE /api/users/:id/login-history
// @access  Private (Admin / Supervisor / Self)
exports.deleteUserLoginHistory = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { historyIds } = req.body;

    if (!historyIds || !Array.isArray(historyIds) || historyIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'historyIds array is required'
      });
    }

    // 🔐 Security check
    if (
      req.user.role !== 'admin' &&
      req.user.role !== 'supervisor' &&
      req.user.id !== targetUserId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const user = await User.findByIdAndUpdate(
      targetUserId,
      {
        $pull: {
          loginHistory: {
            _id: { $in: historyIds }
          }
        }
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Selected login history deleted',
      remainingHistory: user.loginHistory
    });

  } catch (error) {
    console.error('❌ Error deleting login history:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};