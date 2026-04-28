const express = require('express');
const router = express.Router();
const {
  createTollPlaza,
  getAllTollPlazas,
  getTollPlazaById,
  scanTollPlaza,
  getMyAssignedPlazas,
  updateLaneStatus,
  updatePlazaStatus,
  createMaintenanceTask,
  getMaintenanceTasks,
  updateTaskStatus,
  getMaintenanceReport,
  uploadTollPlazaExcel,
  assignPlazasToUser,
  removePlazasFromUser,
  getRecentReportsPlazaWise,
  updateTollPlaza,
  deleteTollPlaza,
  getUsersByPlaza
} = require('../controllers/plazaController');
const { protect, authorize } = require('../middleware/auth');
const excelUpload = require('../middleware/excelUpload');

// Toll Plaza routes
router.route('/')
  .post(protect, authorize('admin', 'supervisor'), createTollPlaza)
  .get(protect, getAllTollPlazas);

router.get('/scan/:plazaId', protect, scanTollPlaza);
router.get('/my-plazas', protect, getMyAssignedPlazas);
router.get('/:plazaId/users', protect, authorize('admin', 'supervisor'), getUsersByPlaza);
router.get('/:id', protect, getTollPlazaById);
router.put('/:id/lane/:laneNumber', protect, updateLaneStatus);
router.put('/:id/status', protect, authorize('admin', 'supervisor'), updatePlazaStatus);
router.get('/reports/recent', protect, getRecentReportsPlazaWise);
router.put('/:id', protect, authorize('admin', 'supervisor'), updateTollPlaza);
router.delete('/:id', protect, authorize('admin', 'supervisor'), deleteTollPlaza);

// Maintenance Task routes
router.post('/tasks', protect, createMaintenanceTask);
router.put('/assign-plazas/:userId', protect, authorize('admin', 'supervisor'), assignPlazasToUser);
router.put('/remove-plazas/:userId', protect, authorize('admin', 'supervisor'), removePlazasFromUser);
router.get('/:plazaId/tasks', protect, getMaintenanceTasks);
router.put('/tasks/:taskId', protect, updateTaskStatus);
router.get('/reports/maintenance', protect, authorize('admin'), getMaintenanceReport);
router.post('/upload-excel', protect, excelUpload.single('file'), authorize('admin', 'supervisor'), uploadTollPlazaExcel);

module.exports = router;