// src/controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../services/notificationService');
const path = require('path');
const fs = require('fs');
const { saveProfilePicture, PROFILE_PICS_PATH, LOCAL_PROFILE_BACKUP_PATH } = require('../middleware/upload');

// Generate Refresh Token
const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  });
};

// Create and send token response
const createSendToken = (user, statusCode, res) => {
  const token = user.generateAuthToken();
  const refreshToken = generateRefreshToken(user._id);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    success: true,
    token,
    refreshToken,
    data: {
      user
    }
  });
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, employeeId, password, device, fcmToken, userAgent } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    console.log('🔐 Login attempt:', { email, employeeId, device });

    // ✅ Validate input
    if (!password || (!email && !employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email (for admin) or employee ID and password'
      });
    }

    let user;

    // ✅ Step 1: Try finding admin by email
    if (email) {
      user = await User.findOne({ email })
        .select('+password +failedLoginAttempts +lockUntil +twoFactorSecret +fcmTokens')
        .populate('supervisor', 'name email');

      // If email used but user is NOT admin → reject
      if (user && user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only admin can login using email. Use Employee ID.'
        });
      }
    }

    // ✅ Step 2: If no user found yet → try employeeId
    if (!user && employeeId) {
      user = await User.findOne({ employeeId })
        .select('+password +failedLoginAttempts +lockUntil +twoFactorSecret +fcmTokens')
        .populate('supervisor', 'name email');
    }

    // ❌ No user found
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // ✅ Check if account is locked
    if (user.isLocked) {
      const lockTimeLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account is locked. Try again in ${lockTimeLeft} minutes`
      });
    }

    // ✅ Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.incrementFailedLoginAttempts();
      const attemptsLeft = 5 - user.failedLoginAttempts;

      return res.status(401).json({
        success: false,
        message: attemptsLeft > 0
          ? `Invalid credentials. ${attemptsLeft} attempts left`
          : 'Account locked for 30 minutes due to too many failed attempts'
      });
    }

    // ✅ Check active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact admin.'
      });
    }

    // ✅ Reset failed attempts
    await user.resetFailedLoginAttempts();

    // ✅ Session token
    const crypto = require('crypto');
    const sessionToken = crypto.randomBytes(32).toString('hex');

    // ✅ Login history
    await user.addLoginHistory(ip, device || 'web', userAgent, sessionToken);

    // =================== FCM TOKEN ===================
    if (fcmToken && device) {
      try {
        await user.addFCMToken(fcmToken, device);
      } catch (err) {
        console.error('FCM error:', err);
      }
    }
    // ================================================

    // ✅ Last login
    user.lastLogin = Date.now();
    await user.save();

    // ✅ Send token
    createSendToken(user, 200, res);

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Activate / Deactivate user
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false"
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.isActive = isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: isActive
        ? "User activated successfully"
        : "User deactivated successfully",
      data: user
    });

  } catch (error) {
    console.error("Update user status error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    const { fcmToken, sessionToken } = req.body;

    if (fcmToken) {
      // Remove FCM token
      await req.user.removeFCMToken(fcmToken);
    }

    if (sessionToken) {
      // Update logout time for session
      await req.user.updateLogoutTime(sessionToken);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('supervisor', 'name email role')
      .populate('createdBy', 'name email')
      .populate('subordinates', 'name email role department profileImage');

    res.json({
      success: true,
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};

// @access  Private
// @desc    Update current user profile
// @route   PUT /api/auth/me
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    // if admin passes :id → update that user
    // otherwise fallback to logged-in user
    const userId = req.params.id || req.user.id;

    // ✅ ONLY name, email, phone - nothing else
    const { name, email, phone } = req.body;

    const updateFields = {};
    if (name) updateFields.name = name;
    if (phone) updateFields.phone = phone;
    
    // Handle email update with uniqueness check
    if (email && email !== req.user?.email) {
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ 
        email: email, 
        _id: { $ne: userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another account'
        });
      }
      updateFields.email = email;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateFields,
      { new: true, runValidators: true }
    ).populate('supervisor', 'name email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Profile update error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    // Handle duplicate key error for email
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};


// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password field
    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is same as old
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Update password
    user.password = newPassword;
    user.passwordChangedAt = Date.now();
    await user.save();

    // Send email notification
    try {
      await sendEmail({
        email: user.email,
        subject: 'Your password was changed',
        template: 'passwordChanged',
        data: {
          name: user.name,
          time: new Date().toLocaleString()
        }
      });
    } catch (error) {
      console.error('Password change email failed:', error);
    }

    // Send push notification
    if (user.preferences.notifications.push && user.fcmTokens.length > 0) {
      try {
        await sendPushNotification({
          tokens: user.fcmTokens.map(t => t.token),
          title: 'Password Changed',
          body: 'Your password was successfully changed',
          data: { type: 'security_alert' }
        });
      } catch (error) {
        console.error('Push notification failed:', error);
      }
    }

    // Generate new token
    const token = user.generateAuthToken();

    res.json({
      success: true,
      message: 'Password changed successfully',
      token
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with that email'
      });
    }

    // Generate reset token
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // Send email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Request',
        template: 'passwordReset',
        data: {
          name: user.name,
          url: resetUrl,
          expiresIn: '10 minutes'
        }
      });

      res.json({
        success: true,
        message: 'Password reset email sent'
      });

    } catch (error) {
      // If email fails, clear reset token
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      console.error('Reset email failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again.'
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset request failed'
    });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Hash token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangedAt = Date.now();

    // Clear all sessions except current
    user.loginHistory = user.loginHistory.filter(
      session => session.sessionToken === req.body.sessionToken
    );

    await user.save();

    // Send confirmation email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Successful',
        template: 'passwordResetSuccess',
        data: {
          name: user.name,
          time: new Date().toLocaleString()
        }
      });
    } catch (error) {
      console.error('Reset confirmation email failed:', error);
    }

    // Generate new token and send response
    createSendToken(user, 200, res);

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed'
    });
  }
};

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    // Hash token
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    // Update user
    user.isEmailVerified = true;
    user.isVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
};

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Public
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with that email'
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Generate new verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

    await sendEmail({
      email: user.email,
      subject: 'Please verify your email',
      template: 'emailVerification',
      data: {
        name: user.name,
        url: verificationUrl
      }
    });

    res.json({
      success: true,
      message: 'Verification email sent'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification email'
    });
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find user
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new access token
    const newToken = user.generateAuthToken();

    res.json({
      success: true,
      token: newToken
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
};

// @desc    Get login history
// @route   GET /api/auth/login-history
// @access  Private
exports.getLoginHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('loginHistory');

    res.json({
      success: true,
      data: {
        loginHistory: user.loginHistory
      }
    });

  } catch (error) {
    console.error('Login history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch login history'
    });
  }
};

// @desc    Revoke device access
// @route   DELETE /api/auth/devices/:tokenId
// @access  Private
exports.revokeDevice = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const user = await User.findById(req.user.id);

    // Remove FCM token
    user.fcmTokens = user.fcmTokens.filter(t => t._id.toString() !== tokenId);

    await user.save();

    res.json({
      success: true,
      message: 'Device access revoked'
    });

  } catch (error) {
    console.error('Revoke device error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke device access'
    });
  }
};

// @desc    Enable 2FA
// @route   POST /api/auth/enable-2fa
// @access  Private
exports.enable2FA = async (req, res) => {
  try {
    const speakeasy = require('speakeasy');

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${process.env.APP_NAME}:${req.user.email}`
    });

    // Save secret to user
    const user = await User.findById(req.user.id).select('+twoFactorSecret');
    user.twoFactorSecret = secret.base32;
    user.twoFactorEnabled = true;
    await user.save();

    res.json({
      success: true,
      message: '2FA enabled successfully',
      data: {
        secret: secret.base32,
        otpauth_url: secret.otpauth_url
      }
    });

  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enable 2FA'
    });
  }
};

// @desc    Verify 2FA token
// @route   POST /api/auth/verify-2fa
// @access  Private
exports.verify2FA = async (req, res) => {
  try {
    const { token } = req.body;
    const speakeasy = require('speakeasy');

    const user = await User.findById(req.user.id).select('+twoFactorSecret');

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid 2FA token'
      });
    }

    res.json({
      success: true,
      message: '2FA verified successfully'
    });

  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify 2FA'
    });
  }
};

// @desc    Update user profile picture
// @route   POST /api/auth/me/profile-picture
// @access  Private
exports.updateProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Save profile picture to network share and local backup
    const { savedPaths, errors, customFilename, profileUrl } = await saveProfilePicture(req.file, userId);

    // Check if at least one storage location succeeded
    if (savedPaths.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save profile picture to any storage location',
        errors: errors
      });
    }

    // Get the user and update profile image
    const user = await User.findById(userId);
    
    // Store the old profile image URL for potential cleanup
    const oldProfileImage = user.profileImage;
    
    // Update with new profile image URL
    user.profileImage = profileUrl;
    
    // Optional: Store backup URLs in metadata
    if (!user.metadata) {
      user.metadata = {};
    }
    user.metadata.profileImageBackups = savedPaths.map(p => ({ 
      location: p.location, 
      path: p.path, 
      url: p.url,
      date: new Date() 
    }));
    
    await user.save();

    // Optional: Delete old profile image from storage if it's not the default
    if (oldProfileImage && !oldProfileImage.includes('picsum.photos')) {
      try {
        // Extract filename from URL
        const oldFilename = oldProfileImage.split('/').pop();
        
        // Delete from network share
        const oldNetworkPath = path.join(PROFILE_PICS_PATH, oldFilename);
        if (fs.existsSync(oldNetworkPath)) {
          fs.unlinkSync(oldNetworkPath);
          console.log(`Deleted old profile image from network: ${oldNetworkPath}`);
        }
        
        // Delete from local backup
        const oldLocalPath = path.join(LOCAL_PROFILE_BACKUP_PATH, oldFilename);
        if (fs.existsSync(oldLocalPath)) {
          fs.unlinkSync(oldLocalPath);
          console.log(`Deleted old profile image from local: ${oldLocalPath}`);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up old profile image:', cleanupError);
        // Don't fail the request if cleanup fails
      }
    }

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        profileImage: user.profileImage,
        storageLocations: savedPaths.map(p => ({ location: p.location, url: p.url })),
        warnings: errors.length > 0 ? errors : undefined
      }
    });

  } catch (error) {
    console.error('Profile picture update error:', error);
    
    // Clean up uploaded file if something went wrong
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update profile picture',
      error: error.message
    });
  }
};