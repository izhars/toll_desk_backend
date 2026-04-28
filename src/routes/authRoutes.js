// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { 
  login, 
  getMe, 
  logout, 
  changePassword, 
  forgotPassword, 
  resetPassword, 
  verifyEmail, 
  refreshToken, 
  updateProfile, 
  updateProfilePicture, 
  getLoginHistory, 
  revokeDevice, 
  updateUserStatus 
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { 
  loginValidator, 
  changePasswordValidator, 
  forgotPasswordValidator, 
  resetPasswordValidator, 
  updateProfileValidator 
} = require('../validators/authValidators');
const { uploadProfilePic } = require('../middleware/upload');

// ============== Public Routes ==============
router.post('/login', validate(loginValidator), login);
router.post('/forgot-password', validate(forgotPasswordValidator), forgotPassword);
router.post('/reset-password/:token', validate(resetPasswordValidator), resetPassword);
router.get('/verify-email/:token', verifyEmail);
router.post('/refresh-token', refreshToken);

// ============== Protected Routes (All authenticated users) ==============
router.use(protect); // All routes below this require authentication

// Profile picture upload (now protected)
router.post('/me/profile-picture', uploadProfilePic.single('profileImage'), updateProfilePicture);

// User routes (accessible by any authenticated user)
router.get('/me', getMe);
router.post('/change-password', validate(changePasswordValidator), changePassword);
router.post('/logout', logout);
router.get('/login-history', getLoginHistory);
router.delete('/devices/:tokenId', revokeDevice);
router.put('/me', validate(updateProfileValidator), updateProfile);

// ============== Admin Only Routes ==============
router.use(authorize('admin')); // All routes below require admin role
router.patch('/users/:id/status', authorize('admin', 'supervisor'), updateUserStatus);
// Additional admin user management routes (commented)
// router.post('/users/:id/activate', activateUser);
// router.post('/users/:id/deactivate', deactivateUser);
// router.post('/users/:id/change-role', changeUserRole);

module.exports = router;