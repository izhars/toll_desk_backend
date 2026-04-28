const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { USER_ROLES } = require('../utils/constants');

const {
  validateCreateReport, validateStatusUpdate, validateAssignment, validateComment,
  validateResolution, validateMarkFixed, validateClosure, validateReopen,
  validateBatchStatusUpdate, validateGetReports, validateUnassignment
} = require('../validators/maintenanceValidator');

const {
  createReport, adminCreateReport, getReports, getReportById, assignReport,
  updateReportStatus, resolveReport, markAsFixed, closeReport, reopenReport,
  addComment, deleteComment, deletePhoto, deleteReport,
  getPlazaMaintenanceSummary, getMyAssignedReports, getMyCreatedReports,
  getDashboard, getReportsByPlazaId, getPlazaReportStats, exportReportsToExcel, getFilterOptions,
  unassignUser  // Add this line
} = require('../controllers/maintenanceController');
// ================= DASHBOARD =================
router.get('/dashboard', protect, getDashboard);

// ================= REPORT CRUD =================
router.route('/reports')
  .post(protect, upload.array('photos', 10), validateCreateReport, createReport)
  .get(protect, validateGetReports, getReports);

// ================= USER REPORTS =================
router.get('/reports/my-reports', protect, getMyCreatedReports);
router.get('/reports/created-by-me', protect, getMyCreatedReports);
router.get('/reports/my-assignments', protect, getMyAssignedReports);
router.get('/reports/filter-options', protect, getFilterOptions);

// ================= ADMIN =================
router.post('/admin/reports', protect, authorize(USER_ROLES.ADMIN), upload.array('photos', 10), validateCreateReport, adminCreateReport);

router.delete('/reports/:id', protect, deleteReport);
router.get('/reports/:id', protect, getReportById);

// ================= PLAZA =================
router.get('/plaza/:plazaId/summary', protect, getPlazaMaintenanceSummary);
router.get('/reports/plaza/:plazaId', protect, getReportsByPlazaId);
router.get('/reports/plaza/:plazaId/stats', protect, getPlazaReportStats);

// ================= ASSIGNMENT =================
router.put('/reports/:id/assign', protect, authorize(USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN), validateAssignment, assignReport);
router.put('/reports/:id/unassign', protect, authorize(USER_ROLES.SUPERVISOR, USER_ROLES.ADMIN), validateUnassignment, unassignUser);

// ================= STATUS =================
router.put('/reports/:id/status', protect, validateStatusUpdate, updateReportStatus);
router.put('/reports/:id/resolve', protect, upload.array('resolutionPhotos', 5), validateResolution, resolveReport);
router.put('/reports/:id/mark-fixed', protect, upload.array('fixPhotos', 5), validateMarkFixed, markAsFixed);
router.put('/reports/:id/close', protect, upload.array('verificationPhotos', 5), validateClosure, closeReport);
router.put('/reports/:id/reopen', protect, upload.array('reopenPhotos', 5), validateReopen, reopenReport);

// ================= COMMENTS =================
router.post('/reports/:id/comments', protect, upload.array('photos', 10), validateComment, addComment);
router.delete('/reports/:id/comments/:commentId', protect, deleteComment);

// ================= PHOTOS =================
router.delete('/reports/:id/photos/:photoId', protect, deletePhoto);

// ================= EXPORT =================
router.get('/reports/export/excel', protect, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERVISOR), exportReportsToExcel);
router.get(
  '/reports/export/csv',
  protect,
  authorize(USER_ROLES.ADMIN, USER_ROLES.SUPERVISOR),
  (req, res, next) => {
    req.query.format = 'csv';
    next();
  },
  exportReportsToExcel
);

// ================= FALLBACK =================
router.use('*', (req, res) => res.status(404).json({ success: false, message: 'API endpoint not found' }));

module.exports = router;