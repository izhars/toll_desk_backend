// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Print only token
    console.log('🔑 Token:', token);

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Print only ID from decoded token
    console.log('🧾 User ID from token:', decoded.id);

    req.user = await User.findById(decoded.id).select('-password');
    
    // Print only name and ID from database
    if (req.user) {
      console.log('👤 User:', {
        id: req.user._id,
        name: req.user.name
      });
    }

    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }

    next();
  } catch (error) {
    console.error('❌ Auth error:', error.message);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Rest of your middleware functions remain the same...
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `User role ${req.user.role} is not authorized to access this route` 
      });
    }
    next();
  };
};

exports.canCreateUser = (targetRole) => {
  return (req, res, next) => {
    const creatorRole = req.user.role;
    
    if (creatorRole === 'admin') {
      return next();
    }
    
    if (creatorRole === 'supervisor' && targetRole === 'employee') {
      return next();
    }
    
    return res.status(403).json({ 
      message: 'You do not have permission to create users with this role' 
    });
  };
};

exports.canManageUser = async (req, res, next) => {
  try {
    const targetUser = await User.findById(req.params.id);
    
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (req.user.role === 'admin') {
      req.targetUser = targetUser;
      return next();
    }
    
    if (req.user.role === 'supervisor') {
      if (targetUser.supervisor?.toString() === req.user.id) {
        req.targetUser = targetUser;
        return next();
      }
    }
    
    if (targetUser.id === req.user.id) {
      req.targetUser = targetUser;
      return next();
    }
    
    return res.status(403).json({ message: 'Not authorized to manage this user' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};