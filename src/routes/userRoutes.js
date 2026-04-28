const express = require('express'); const router = express.Router();

// Controllers
const { createUser, bulkRegisterUsers, downloadBulkRegisterTemplate, getMyAvailabilityStats, getUsers, getUser, deleteUser, getMySubordinates, getMySupervisor, getUserHierarchy, getSupervisorStats, getAllSupervisorsStats, updateAvailability, updateLastLogin, deleteLoginHistory, getAvailabilityStats, getUserAvailabilityStats, deleteUserLoginHistory } = require('../controllers/userController');

// Middleware
const { protect, authorize, canCreateUser, canManageUser } = require('../middleware/auth');
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

router.get(
  '/bulk-register-template',
  // authorize('admin'),
  downloadBulkRegisterTemplate
);
// Apply auth globally
router.use(protect);

/* ===================== USER MANAGEMENT ===================== */
router.post('/', authorize('admin', 'supervisor'), (req, res, next) => canCreateUser(req.body.role)(req, res, next), createUser);
router.post('/bulk-register',
  authorize('admin', 'supervisor'),
  upload.single('file'),
  bulkRegisterUsers
);

router.get('/', getUsers);
router.get('/:id', canManageUser, getUser);
router.delete('/:id', authorize('admin'), deleteUser);

/* ===================== SELF (ME) ROUTES ===================== */
router.get('/me/supervisor', getMySupervisor);
router.get('/me/subordinates', authorize('supervisor'), getMySubordinates);
router.get('/me/availability-stats', protect, getAvailabilityStats);
router.get('/me/supervisor-stats', protect, authorize('supervisor'), getSupervisorStats);

/* ===================== AVAILABILITY ===================== */
router.patch('/availability', protect, updateAvailability);
router.get('/me/availability-stats', protect, getMyAvailabilityStats);
router.get('/:id/availability-stats', protect, authorize('admin', 'supervisor'), getUserAvailabilityStats);

/* ===================== HIERARCHY ===================== */
router.get('/:id/hierarchy', authorize('admin'), getUserHierarchy);

/* ===================== LOGIN HISTORY ===================== */
router.patch('/last-login', updateLastLogin);
router.delete('/login-history', protect, authorize('admin', 'supervisor', 'employee'), deleteLoginHistory);
router.delete('/:id/login-history', protect, authorize('admin', 'supervisor', 'employee'), deleteUserLoginHistory);

/* ===================== SUPERVISOR STATS ===================== */
router.get('/supervisor/:id/stats', protect, authorize('admin', 'supervisor'), getSupervisorStats);
router.get('/supervisors/all-stats', protect, authorize('admin'), getAllSupervisorsStats);


module.exports = router;