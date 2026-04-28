// src/config/security.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redisClient = require('./redis');

// Custom rate limit store using Redis for distributed rate limiting
const createRedisRateLimiter = (options) => {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redisClient.client.sendCommand(args),
      prefix: 'rl:'
    }),
    ...options
  });
};

// Security configuration object
const securityConfig = {
  // Password policy
  passwordPolicy: {
    minLength: 8,
    maxLength: 100,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    commonPasswords: ['password123', 'admin123', 'qwerty123']
  },
  
  // JWT configuration
  jwt: {
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    algorithm: 'RS256', // Use RS256 for production
    issuer: 'toll-maintenance-system',
    audience: 'toll-maintenance-api'
  },
  
  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  },
  
  // CORS configuration
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [],
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400
  },
  
  // Rate limiting presets
  rateLimits: {
    strict: {
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: 'Too many requests, please try again later.'
    },
    moderate: {
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Rate limit exceeded. Please slow down.'
    },
    relaxed: {
      windowMs: 60 * 1000,
      max: 200,
      message: 'Too many requests per minute.'
    }
  },
  
  // Input validation rules
  validation: {
    email: {
      normalizeEmail: true,
      blacklistedDomains: ['tempmail.com', 'throwaway.com'],
      maxLength: 254
    },
    phone: {
      minLength: 10,
      maxLength: 15,
      allowedCountries: ['US', 'CA', 'IN']
    },
    fileUpload: {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf']
    }
  },
  
  // Security headers
  headers: {
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    csp: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://*.firebaseio.com"]
      }
    }
  }
};

// Helper function to sanitize user input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
};

// Helper function to validate file uploads
const validateFileUpload = (file, config = securityConfig.validation.fileUpload) => {
  if (!file) return { valid: false, error: 'No file provided' };
  
  if (file.size > config.maxSize) {
    return { valid: false, error: `File size exceeds ${config.maxSize / 1024 / 1024}MB limit` };
  }
  
  if (!config.allowedTypes.includes(file.mimetype)) {
    return { valid: false, error: 'File type not allowed' };
  }
  
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) {
    return { valid: false, error: 'File extension not allowed' };
  }
  
  return { valid: true };
};

module.exports = {
  securityConfig,
  createRedisRateLimiter,
  sanitizeInput,
  validateFileUpload
};