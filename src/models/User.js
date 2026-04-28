// src/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const fcmTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true
  },
  device: {
    type: String,
    enum: ['android', 'ios', 'web'],
    required: true
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: true });

const loginHistorySchema = new mongoose.Schema({
  ip: String,
  device: String,
  userAgent: String,
  location: {
    country: String,
    city: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  loggedInAt: {
    type: Date,
    default: Date.now
  },
  loggedOutAt: Date,
  sessionToken: String
}, { _id: true });

const userSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },

  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },

  assignedPlazas: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TollPlaza'
  }],

  password: {
    type: String,
    required: [true, 'Password is required'],
    select: false,
    minlength: [8, 'Password must be at least 8 characters']
  },

  // Role & Department
  role: {
    type: String,
    enum: {
      values: ['employee', 'supervisor', 'admin'],
      message: '{VALUE} is not a valid role'
    },
    default: 'employee'
  },

  department: {
    type: String,
    enum: {
      values: ['management', 'maintenance', 'procurement'],
      message: '{VALUE} is not a valid department'
    },
    default: 'general'
  },

  // Professional Information
  employeeId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  phone: {
    type: String,
    trim: true,
    match: [
      /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/,
      'Please provide a valid phone number'
    ]
  },

  profileImage: {
    type: String,
    default: 'https://picsum.photos/200/300'
  },

  // Push Notifications
  fcmTokens: [fcmTokenSchema],

  // Security & Tracking
  loginHistory: [loginHistorySchema],

  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },

  isAvailable: {
    type: Boolean,
    default: true
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  isEmailVerified: {
    type: Boolean,
    default: false
  },

  lastLogin: {
    type: Date
  },
  // Add to your userSchema (around line 180)
  autoAvailableAfter: {
    type: Date,
    default: null
  },

  availabilityNotes: {
    type: String,
    maxlength: 500
  },

  // Add to availabilityHistory subdocument
  availabilityHistory: [{
    status: Boolean,
    changedAt: Date,
    duration: Number, // Duration in milliseconds
    notes: String,    // Optional reason for status change
    changedBy: {      // If someone else changed it (supervisor)
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  // Password Management
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,

  // Email Verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // Security Features
  failedLoginAttempts: {
    type: Number,
    default: 0
  },

  lockUntil: {
    type: Date
  },

  twoFactorEnabled: {
    type: Boolean,
    default: false
  },

  twoFactorSecret: {
    type: String,
    select: false
  },

  // Relationships
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  subordinates: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // Preferences
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de']
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  deletedAt: {
    type: Date
  }
}, {
  timestamps: true, // Automatically manage createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for account lock status
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});


// Indexes for better query performance
userSchema.index({ email: 1 });
userSchema.index({ employeeId: 1 });
userSchema.index({ role: 1, department: 1 });
userSchema.index({ supervisor: 1 });
userSchema.index({ 'fcmTokens.token': 1 });
// Add after your existing indexes (around line 110)
userSchema.index({ 'availabilityHistory.changedAt': -1 });
userSchema.index({ isAvailable: 1, 'availabilityHistory.changedAt': -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function (next) {
  // Only hash if password is modified or new
  if (!this.isModified('password')) return next();

  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);

    // Update passwordChangedAt field
    if (!this.isNew) {
      this.passwordChangedAt = Date.now() - 1000; // Subtract 1 second to ensure token is created after password change
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to update timestamps
userSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Instance Methods

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
userSchema.methods.generateAuthToken = function () {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    {
      id: this._id,
      role: this.role,
      email: this.email
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// Generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  // Generate token
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hash token and save to database
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expiration (10 minutes)
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

// Add FCM token
// Add FCM token (FIXED VERSION)
userSchema.methods.addFCMToken = async function (token, device) {
  if (!token || !device) {
    console.log('❌ Missing token or device');
    return;
  }

  // Normalize device string to match enum exactly
  device = device.toLowerCase();
  if (!['android', 'ios', 'web'].includes(device)) {
    console.warn(`❌ Invalid device type for FCM token: ${device}`);
    return;
  }

  try {
    console.log(`📱 Adding FCM token for device: ${device}`);

    // Check if token already exists
    const existingTokenIndex = this.fcmTokens.findIndex(t => t.token === token);

    if (existingTokenIndex !== -1) {
      // Update existing token
      console.log('🔄 Updating existing token');
      this.fcmTokens[existingTokenIndex].lastUsed = Date.now();
      this.fcmTokens[existingTokenIndex].isActive = true;
    } else {
      // Check if we need to remove old tokens (limit 5 per device)
      const deviceTokens = this.fcmTokens.filter(t => t.device === device);
      if (deviceTokens.length >= 5) {
        console.log(`🗑️ Removing oldest token for ${device} (limit reached)`);
        // Sort by lastUsed (oldest first) and remove the oldest
        deviceTokens.sort((a, b) => a.lastUsed - b.lastUsed);
        const oldestToken = deviceTokens[0];
        this.fcmTokens = this.fcmTokens.filter(t => t.token !== oldestToken.token);
      }

      // Add new token
      console.log('➕ Adding new token');
      this.fcmTokens.push({
        token,
        device,
        lastUsed: Date.now(),
        isActive: true
      });
    }

    // Mark the fcmTokens array as modified (important for nested arrays)
    this.markModified('fcmTokens');

    // Save the user
    const savedUser = await this.save();
    console.log('✅ User saved successfully');

    // Verify the token was saved
    const savedToken = savedUser.fcmTokens.find(t => t.token === token);
    if (savedToken) {
      console.log('✅ Token verified in database:', {
        token: savedToken.token.substring(0, 20) + '...',
        device: savedToken.device,
        lastUsed: savedToken.lastUsed
      });
    } else {
      console.log('❌ Token not found after save!');
    }

    return savedUser;
  } catch (err) {
    console.error('❌ Failed to save FCM token:', err.message);
    throw err; // Throw error so caller knows it failed
  }
};

// Remove FCM token
userSchema.methods.removeFCMToken = async function (token) {
  this.fcmTokens = this.fcmTokens.filter(t => t.token !== token);
  await this.save();
};

// Add login history
userSchema.methods.addLoginHistory = async function (ip, device, userAgent, sessionToken) {
  // Get location from IP (you can use a geolocation service)
  const location = {
    country: 'Unknown',
    city: 'Unknown'
  };

  this.loginHistory.push({
    ip,
    device,
    userAgent,
    location,
    sessionToken,
    loggedInAt: Date.now()
  });

  // Keep only last 50 login records
  if (this.loginHistory.length > 50) {
    this.loginHistory = this.loginHistory.slice(-50);
  }

  this.lastLogin = Date.now();
  await this.save();
};

// Update logout time for current session
userSchema.methods.updateLogoutTime = async function (sessionToken) {
  const session = this.loginHistory.find(h => h.sessionToken === sessionToken);
  if (session) {
    session.loggedOutAt = Date.now();
    await this.save();
  }
};

// Increment failed login attempts
userSchema.methods.incrementFailedLoginAttempts = async function () {
  this.failedLoginAttempts += 1;

  // Lock account after 5 failed attempts
  if (this.failedLoginAttempts >= 5) {
    this.lockUntil = Date.now() + 30 * 60 * 1000; // Lock for 30 minutes
  }

  await this.save();
};

// Reset failed login attempts
userSchema.methods.resetFailedLoginAttempts = async function () {
  this.failedLoginAttempts = 0;
  this.lockUntil = undefined;
  await this.save();
};

// Check if password was changed after JWT issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Get user's subordinates (recursive)
userSchema.methods.getAllSubordinates = async function () {
  const subordinates = await this.model('User').find({
    supervisor: this._id,
    isActive: true
  });

  let allSubordinates = [...subordinates];

  for (const sub of subordinates) {
    const subSubordinates = await sub.getAllSubordinates();
    allSubordinates = [...allSubordinates, ...subSubordinates];
  }

  return allSubordinates;
};

// Static Methods

// Find active users by role
userSchema.statics.findActiveByRole = function (role) {
  return this.find({ role, isActive: true }).select('-password');
};

// Add to User schema statics
userSchema.statics.getAvailabilityReport = async function (startDate, endDate, role = null) {
  const matchStage = {
    isActive: true,
    'availabilityHistory.0': { $exists: true }
  };

  if (role) {
    matchStage.role = role;
  }

  if (startDate && endDate) {
    matchStage['availabilityHistory.changedAt'] = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const report = await this.aggregate([
    { $match: matchStage },
    { $unwind: '$availabilityHistory' },
    {
      $match: startDate && endDate ? {
        'availabilityHistory.changedAt': {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      } : {}
    },
    {
      $group: {
        _id: {
          userId: '$_id',
          status: '$availabilityHistory.status'
        },
        count: { $sum: 1 },
        averageDuration: { $avg: '$availabilityHistory.duration' }
      }
    },
    {
      $group: {
        _id: '$_id.userId',
        availableCount: {
          $sum: { $cond: [{ $eq: ['$_id.status', true] }, '$count', 0] }
        },
        unavailableCount: {
          $sum: { $cond: [{ $eq: ['$_id.status', false] }, '$count', 0] }
        },
        avgAvailableDuration: {
          $max: {
            $cond: [{ $eq: ['$_id.status', true] }, '$averageDuration', 0]
          }
        }
      }
    }
  ]);

  return report;
};

// Get department statistics
userSchema.statics.getDepartmentStats = async function () {
  return this.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$department',
        count: { $sum: 1 },
        supervisors: {
          $sum: { $cond: [{ $eq: ['$role', 'supervisor'] }, 1, 0] }
        },
        employees: {
          $sum: { $cond: [{ $eq: ['$role', 'employee'] }, 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Add after other pre-save middleware (around line 200)
userSchema.pre('save', function (next) {
  // Calculate duration for previous availability status
  if (this.isModified('isAvailable') && this.availabilityHistory.length > 0) {
    const lastEntry = this.availabilityHistory[this.availabilityHistory.length - 1];
    if (lastEntry && !lastEntry.duration) {
      // Duration will be calculated when next status change occurs
      // We'll store it then
      this.markModified('availabilityHistory');
    }
  }
  next();
});

// Instance method to calculate availability duration
userSchema.methods.calculateAvailabilityDuration = function (startDate, endDate) {
  if (!startDate || !endDate) return null;

  let totalAvailableTime = 0;
  let currentTime = startDate;

  for (const entry of this.availabilityHistory) {
    const entryTime = new Date(entry.changedAt);

    if (entryTime > endDate) break;
    if (entryTime < startDate) continue;

    const nextEntry = this.availabilityHistory[this.availabilityHistory.indexOf(entry) + 1];
    const endTime = nextEntry ? new Date(nextEntry.changedAt) : endDate;

    if (entry.status === true) { // Available period
      totalAvailableTime += Math.min(endTime, endDate) - Math.max(entryTime, startDate);
    }
  }

  return totalAvailableTime;
};

const User = mongoose.model('User', userSchema);

module.exports = User;