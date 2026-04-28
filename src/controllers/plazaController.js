const TollPlaza = require('../models/TollPlaza');
const MaintenanceReport  = require('../models/MaintenanceReport');
const MaintenanceTask = require('../models/MaintenanceTask');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const fs = require('fs');
const User = require('../models/User');

// @desc    Create toll plaza (Admin only)
// @route   POST /api/toll-maintenance
// In plazaController.js - Update createTollPlaza function
exports.createTollPlaza = async (req, res) => {
  console.log("========== CREATE TOLL PLAZA START ==========");
  console.log("Incoming Body:", req.body);

  try {
    // Validate that name is provided
    if (!req.body.name) {
      return res.status(400).json({
        success: false,
        message: 'Plaza name is required'
      });
    }

    const plazaId =
      'TPL-' +
      Date.now() +
      '-' +
      Math.random().toString(36).substr(2, 5).toUpperCase();

    console.log("Generated plazaId:", plazaId);

    // Generate QR code data with only name and plazaId
    const qrData = JSON.stringify({
      plazaId,
      name: req.body.name
    });

    console.log("QR Data:", qrData);

    const qrCode = await QRCode.toDataURL(qrData);
    console.log("QR Code generated successfully");

    // Create toll plaza with all fields
    const tollPlazaData = {
      name: req.body.name,
      plazaId,
      qrCode,
      lastInspection: new Date(),
      nextInspection: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      )
    };

    // Only add location if provided
    if (req.body.location) {
      tollPlazaData.location = req.body.location;
    }

    // Only add lanes if provided
    if (req.body.lanes && Array.isArray(req.body.lanes)) {
      tollPlazaData.lanes = req.body.lanes;
    }

    // Only add equipment if provided
    if (req.body.equipment && Array.isArray(req.body.equipment)) {
      tollPlazaData.equipment = req.body.equipment;
    }

    // Only add contactPerson if provided
    if (req.body.contactPerson) {
      tollPlazaData.contactPerson = req.body.contactPerson;
    }

    // Only add operationalStatus if provided
    if (req.body.operationalStatus) {
      tollPlazaData.operationalStatus = req.body.operationalStatus;
    }

    // NEW FIELDS - Add if provided
    if (req.body.bank) {
      tollPlazaData.bank = req.body.bank;
    }

    if (req.body.client) {
      tollPlazaData.client = req.body.client;
    }

    if (req.body.anydeskId) {
      tollPlazaData.anydeskId = req.body.anydeskId;
    }

    if (req.body.anydeskPass) {
      tollPlazaData.anydeskPass = req.body.anydeskPass;
    }

    if (req.body.windowPass) {
      tollPlazaData.windowPass = req.body.windowPass;
    }

    if (req.body.dbPass) {
      tollPlazaData.dbPass = req.body.dbPass;
    }

    if (req.body.dbBackupPath) {
      tollPlazaData.dbBackupPath = req.body.dbBackupPath;
    }

    const tollPlaza = await TollPlaza.create(tollPlazaData);

    console.log("Toll Plaza saved to DB:", tollPlaza._id);

    res.status(201).json({
      success: true,
      data: tollPlaza
    });

    console.log("Response sent successfully ✅");
    console.log("========== CREATE TOLL PLAZA END ==========");
  } catch (error) {
    console.error("❌ ERROR in createTollPlaza:");
    console.error(error);
    console.error("Stack:", error.stack);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all toll plazas
// @route   GET /api/toll-maintenance
exports.getAllTollPlazas = async (req, res) => {
  try {
    const tollPlazas = await TollPlaza.find();

    const plazasWithReports = await Promise.all(
      tollPlazas.map(async (plaza) => {

        const reports = await MaintenanceReport.find({
          plazaId: plaza._id
        })
        .populate('reportedBy', 'name email')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 });

        return {
          ...plaza.toObject(),
          maintenanceReports: reports
        };
      })
    );

    res.json({
      success: true,
      count: plazasWithReports.length,
      data: plazasWithReports
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update toll plaza (Admin only)
// @route   PUT /api/toll-maintenance/:id
// In plazaController.js - Update updateTollPlaza function
exports.updateTollPlaza = async (req, res) => {
  console.log("========== UPDATE TOLL PLAZA START ==========");
  console.log("Plaza ID:", req.params.id);
  console.log("Update Data:", req.body);

  try {
    const { id } = req.params;
    
    // Check if plaza exists
    const existingPlaza = await TollPlaza.findById(id);
    if (!existingPlaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    const immutableFields = ['plazaId', 'qrCode', 'createdAt'];

    const updateData = {};
    
    const allowedFields = [
      'name',
      'location',
      'lanes',
      'equipment',
      'contactPerson',
      'operationalStatus',
      'lastInspection',
      'nextInspection',
      'bank',
      'client',
      'anydeskId',
      'anydeskPass',
      'windowPass',
      'dbPass',
      'dbBackupPath'
    ];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });
    
    if (req.body.lanes && Array.isArray(req.body.lanes)) {
      updateData.lanes = req.body.lanes.map(lane => ({
        ...lane,
        lastMaintenance: lane.status === 'operational' ? new Date() : lane.lastMaintenance
      }));
    }
    
    if (req.body.equipment && Array.isArray(req.body.equipment)) {
      updateData.equipment = req.body.equipment;
    }
    
    updateData.updatedAt = new Date();
    
    const updatedPlaza = await TollPlaza.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true,           
        runValidators: true 
      }
    );
    
    console.log("Plaza updated successfully:", updatedPlaza._id);
    
    res.json({
      success: true,
      message: 'Toll plaza updated successfully',
      data: updatedPlaza
    });
    
    console.log("========== UPDATE TOLL PLAZA END ==========");
  } catch (error) {
    console.error("❌ ERROR in updateTollPlaza:");
    console.error(error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getRecentReportsPlazaWise = async (req, res) => {
   try {
    const { limit = 10 } = req.query;

    const reports = await MaintenanceReport.find()
      .populate('plazaId', 'name location')
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit));

    const groupedReports = {};

    reports.forEach((report) => {
      const plazaId = report.plazaId._id.toString();

      if (!groupedReports[plazaId]) {
        groupedReports[plazaId] = {
          plazaId: report.plazaId._id,
          plazaName: report.plazaId.name,
          location: report.plazaId.location,
          reports: []
        };
      }

      groupedReports[plazaId].reports.push(report);
    });

    res.json({
      success: true,
      count: Object.keys(groupedReports).length,
      data: Object.values(groupedReports)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get toll plaza by ID
// @route   GET /api/toll-maintenance/:id
exports.getTollPlazaById = async (req, res) => {
  try {
    const tollPlaza = await TollPlaza.findById(req.params.id);

    if (!tollPlaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    const reports = await MaintenanceReport.find({
      plazaId: tollPlaza._id
    })
      .populate('reportedBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      data: {
        ...tollPlaza.toObject(),
        maintenanceReports: reports
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get toll plaza by QR scan
// @route   GET /api/toll-maintenance/scan/:plazaId
exports.scanTollPlaza = async (req, res) => {
  try {
    const tollPlaza = await TollPlaza.findOne({ 
      plazaId: req.params.plazaId 
    });

    if (!tollPlaza) {
      return res.status(404).json({ message: 'Toll plaza not found' });
    }

    res.json({
      success: true,
      data: tollPlaza
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update lane status
// @route   PUT /api/toll-maintenance/:id/lane/:laneNumber
exports.updateLaneStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id, laneNumber } = req.params;

    const tollPlaza = await TollPlaza.findOneAndUpdate(
      { 
        _id: id,
        'lanes.laneNumber': parseInt(laneNumber)
      },
      { 
        $set: { 
          'lanes.$.status': status,
          'lanes.$.lastMaintenance': status === 'operational' ? Date.now() : undefined
        }
      },
      { new: true }
    );
    
    if (!tollPlaza) {
      return res.status(404).json({ message: 'Toll plaza or lane not found' });
    }

    res.json({
      success: true,
      data: tollPlaza
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update plaza operational status
// @route   PUT /api/toll-maintenance/:id/status
exports.updatePlazaStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const tollPlaza = await TollPlaza.findByIdAndUpdate(
      req.params.id,
      { 
        operationalStatus: status,
        lastInspection: status === 'operational' ? Date.now() : undefined
      },
      { new: true }
    );

    res.json({
      success: true,
      data: tollPlaza
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create maintenance task
// @route   POST /api/toll-maintenance/tasks
exports.createMaintenanceTask = async (req, res) => {
  try {
    const taskId = 'MT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    
    const task = await MaintenanceTask.create({
      ...req.body,
      taskId
    });

    res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get maintenance tasks for a plaza
// @route   GET /api/toll-maintenance/:plazaId/tasks
exports.getMaintenanceTasks = async (req, res) => {
  try {
    const tasks = await MaintenanceTask.find({ 
      plazaId: req.params.plazaId 
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get users assigned to a particular plaza
// @route   GET /api/toll-maintenance/:plazaId/users
exports.getUsersByPlaza = async (req, res) => {
  try {
    const { plazaId } = req.params;

    // validate
    if (!plazaId) {
      return res.status(400).json({
        success: false,
        message: "plazaId is required"
      });
    }

    // find users
    const users = await User.find({
      assignedPlazas: plazaId
    }).select("name email role assignedPlazas");

    res.json({
      success: true,
      count: users.length,
      data: users
    });

  } catch (error) {
    console.error("Get users by plaza error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get plazas assigned to logged-in user
// @route   GET /api/toll-maintenance/my-plazas
exports.getMyAssignedPlazas = async (req, res) => {
  try {

    const user = await User.findById(req.user.id)
      .populate('assignedPlazas', 'name plazaId location');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      count: user.assignedPlazas.length,
      data: user.assignedPlazas
    });

  } catch (error) {

    console.error("Assigned plaza error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// @desc    Update task status
// @route   PUT /api/toll-maintenance/tasks/:taskId
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status, notes, cost, partsUsed } = req.body;
    
    const updateData = { 
      status,
      notes
    };

    if (status === 'completed') {
      updateData.completionDate = Date.now();
      updateData.cost = cost;
      updateData.partsUsed = partsUsed;
    }

    const task = await MaintenanceTask.findOneAndUpdate(
      { taskId: req.params.taskId },
      updateData,
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get maintenance report
// @route   GET /api/toll-maintenance/reports/maintenance
exports.getMaintenanceReport = async (req, res) => {
  try {
    const { startDate, endDate, plazaId } = req.query;

    const query = {};

    if (plazaId) query.plazaId = plazaId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const reports = await MaintenanceReport.find(query)
      .populate('plazaId', 'name location')
      .sort({ createdAt: -1 });

    const stats = {
      total: reports.length,
      completed: reports.filter(r => r.status === 'CLOSED').length,
      pending: reports.filter(r => r.status === 'OPEN').length,
      inProgress: reports.filter(r => r.status === 'IN_PROGRESS').length,
      totalCost: reports.reduce((sum, r) => sum + (r.actualCost || r.costEstimate || 0), 0),
      byType: {},
      byPriority: {}
    };

    reports.forEach(report => {
      stats.byType[report.issueType] =
        (stats.byType[report.issueType] || 0) + 1;

      stats.byPriority[report.priority] =
        (stats.byPriority[report.priority] || 0) + 1;
    });

    res.json({
      success: true,
      stats,
      data: reports
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Create multiple toll plazas in bulk
// @route   POST /api/toll-maintenance/bulk
exports.uploadTollPlazaExcel = async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required"
      });
    }

    // Read Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty"
      });
    }

    const plazas = [];

    rows.forEach(row => {

      const name = row["Plaza Name"];

      if (!name) return;

      plazas.push({
        name,
        plazaId:
          "TPL-" +
          Date.now() +
          "-" +
          Math.random().toString(36).substr(2, 5).toUpperCase(),
        lastInspection: new Date(),
        nextInspection: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

    });

    const createdPlazas = await TollPlaza.insertMany(plazas);

    // delete uploaded excel
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      success: true,
      created: createdPlazas.length,
      data: createdPlazas
    });

  } catch (error) {

    console.error("Excel Import Error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};

// @desc    Assign toll plazas to user
// @route   PUT /api/toll-maintenance/assign-plazas/:userId
exports.assignPlazasToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { plazaIds } = req.body;

    if (!plazaIds || !Array.isArray(plazaIds)) {
      return res.status(400).json({
        success: false,
        message: "plazaIds must be an array"
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $addToSet: {
          assignedPlazas: { $each: plazaIds }
        }
      },
      { new: true }
    ).populate("assignedPlazas", "name plazaId location");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      message: "Plazas assigned successfully",
      data: user.assignedPlazas
    });

  } catch (error) {
    console.error("Assign plaza error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



// @desc    Remove toll plazas from a user
// @route   PUT /api/toll-maintenance/remove-plazas/:userId
exports.removePlazasFromUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { plazaIds } = req.body;
 
    if (!plazaIds || !Array.isArray(plazaIds) || plazaIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "plazaIds must be a non-empty array",
      });
    }
 
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $pull: {
          assignedPlazas: { $in: plazaIds },
        },
      },
      { new: true }
    ).populate("assignedPlazas", "name plazaId location");
 
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
 
    res.json({
      success: true,
      message: "Plazas removed successfully",
      data: user.assignedPlazas,  // remaining plazas after removal
    });
 
  } catch (error) {
    console.error("Remove plaza error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete toll plaza (Admin only)
// @route   DELETE /api/toll-maintenance/:id
exports.deleteTollPlaza = async (req, res) => {
  console.log("========== DELETE TOLL PLAZA START ==========");

  try {
    const { id } = req.params;

    const plaza = await TollPlaza.findById(id);

    if (!plaza) {
      return res.status(404).json({
        success: false,
        message: 'Toll plaza not found'
      });
    }

    // 🧠 CLEANUP (important bro, warna DB mess ho jayega)
    
    // 1. Delete related maintenance tasks
    await MaintenanceTask.deleteMany({ plazaId: id });

    // 2. Delete related reports
    await MaintenanceReport.deleteMany({ plazaId: id });

    // 3. Remove plaza from all users
    await User.updateMany(
      { assignedPlazas: id },
      { $pull: { assignedPlazas: id } }
    );

    // 4. Finally delete plaza
    await TollPlaza.findByIdAndDelete(id);

    console.log("Plaza deleted:", id);

    res.json({
      success: true,
      message: 'Toll plaza deleted successfully'
    });

    console.log("========== DELETE TOLL PLAZA END ==========");
  } catch (error) {
    console.error("❌ ERROR in deleteTollPlaza:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};