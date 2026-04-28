const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');
const {
  getAnalytics,
  getSystemOverview,
  getAllPlazas,
  getPlazaDetails,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus
} = require('../controllers/adminController');

// All routes require admin authentication
router.use(protect);
router.use(authorize(USER_ROLES.ADMIN));

// Dashboard analytics
router.get('/analytics', getAnalytics);
router.get('/overview', getSystemOverview);

// Plaza management
router.get('/plazas', getAllPlazas);
router.get('/plazas/:id', getPlazaDetails);

// User management
router.route('/users')
  .get(getUsers)
  .post(createUser);

router.route('/users/:id')
  .put(updateUser)
  .delete(deleteUser);

router.put('/users/:id/toggle-status', toggleUserStatus);

module.exports = router;