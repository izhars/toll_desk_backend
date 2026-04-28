// src/validators/authValidators.js
const { body } = require('express-validator');

exports.registerValidator = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
    .withMessage('Password must contain at least one letter, one number, and one special character'),
  
  body('phone')
    .optional()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/)
    .withMessage('Please provide a valid phone number'),
  
  body('department')
    .optional()
    .isIn(['management', 'maintenance', 'electrical', 'plumbing', 'hvac', 'general'])
    .withMessage('Invalid department'),
  
  body('employeeId')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Employee ID must be between 3 and 20 characters')
];

// UPDATED: Login validator supporting both email and employeeId
exports.loginValidator = [
  // Custom validation to check if either email or employeeId is provided
  body().custom((value, { req }) => {
    const { email, employeeId } = req.body;
    
    if (!email && !employeeId) {
      throw new Error('Please provide either email (for admin) or employee ID (for employee)');
    }
    
    return true;
  }),
  
  // Email validation - only if email is provided
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  // Employee ID validation - only if employeeId is provided
  body('employeeId')
    .optional()
    .trim()
    .notEmpty().withMessage('Employee ID cannot be empty')
    .isLength({ min: 3, max: 20 }).withMessage('Employee ID must be between 3 and 20 characters'),
  
  // Password is always required
  body('password')
    .notEmpty().withMessage('Password is required'),
  
  body('fcmToken')
    .optional()
    .isString().withMessage('Invalid FCM token format')
];

exports.changePasswordValidator = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
    .withMessage('Password must contain at least one letter, one number, and one special character')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error('New password must be different from current password');
      }
      return true;
    })
];

exports.forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail()
];

exports.resetPasswordValidator = [
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
    .withMessage('Password must contain at least one letter, one number, and one special character'),
  
  body('confirmPassword')
    .notEmpty().withMessage('Please confirm your password')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];

exports.updateProfileValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  body('phone')
    .optional()
    .trim()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
];