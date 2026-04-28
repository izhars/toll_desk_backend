// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./src/config/database');
const NotificationService = require('./src/services/notificationService');
const logger = require('./src/utils/logger');

// Route imports
const authRoutes = require('./src/routes/authRoutes');
const maintenanceRoutes = require('./src/routes/maintenanceRoutes');
const taskRoutes = require('./src/routes/taskRoutes');
const plazaRoutes = require('./src/routes/plazaRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const userRoutes = require('./src/routes/userRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');

// Import test routes
const testUploadRoutes = require('./src/routes/testUploadRoutes');

const app = express();

// Connect to DB
connectDB();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin for uploads
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Network shared path static access (for testing/development)
if (process.env.ENABLE_NETWORK_STATIC === 'true') {
  const networkSharePath = '\\\\192.168.1.2\\appmedia\\20260423';
  app.use('/network-uploads', express.static(networkSharePath));
  logger.info(`Network share static serving enabled: ${networkSharePath}`);
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/toll-maintenance', plazaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/get-notifications', notificationRoutes);
app.use('/api/uploads', uploadRoutes);

// ================= TEST ROUTES =================
// Enable test routes based on environment
const enableTestRoutes = 
  process.env.NODE_ENV !== 'production' || 
  process.env.ENABLE_TEST_ROUTES === 'true';

if (enableTestRoutes) {
  app.use('/api/test', testUploadRoutes);
  logger.info('✅ Test routes enabled for upload functionality');
  
  // Additional test endpoint for checking upload configuration
  app.get('/api/test/config', (req, res) => {
    const fs = require('fs');
    const networkPath = '\\\\192.168.1.2\\appmedia\\20260423';
    const networkExists = fs.existsSync(networkPath);
    
    res.json({
      success: true,
      environment: process.env.NODE_ENV,
      upload: {
        primaryStorage: process.env.NODE_ENV === 'production' ? 'Cloudinary' : 'Local',
        networkShare: {
          path: networkPath,
          exists: networkExists,
          writable: networkExists ? (() => {
            try {
              fs.accessSync(networkPath, fs.constants.W_OK);
              return true;
            } catch { return false; }
          })() : false,
          readable: networkExists ? (() => {
            try {
              fs.accessSync(networkPath, fs.constants.R_OK);
              return true;
            } catch { return false; }
          })() : false
        }
      },
      features: {
        cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
        networkShare: true,
        testRoutes: true
      }
    });
  });
} else {
  logger.info('❌ Test routes disabled');
}

// Health check
app.get('/health', (req, res) => {
  const fs = require('fs');
  const networkPath = '\\\\192.168.1.2\\appmedia\\20260423';
  
  res.json({
    status: 'OK',
    timestamp: new Date(),
    services: {
      firebase: NotificationService.isFirebaseInitialized ? NotificationService.isFirebaseInitialized() : false,
      mongodb: require('mongoose').connection.readyState === 1,
      redis: require('./config/redis').status === 'ready',
    },
    storage: {
      networkShare: {
        configured: true,
        accessible: fs.existsSync(networkPath)
      }
    }
  });
});

// Generic error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📁 Upload directory: ${process.env.UPLOAD_PATH || './uploads'}`);
  logger.info(`🌐 Network share path: \\\\192.168.1.2\\appmedia\\20260423`);
  if (enableTestRoutes) {
    logger.info(`🧪 Test routes available at: http://localhost:${PORT}/api/test`);
  }
});

// Initialize Socket.IO for real-time notifications
const { initializeSocket } = require('./src/services/socket');
initializeSocket(server);

module.exports = app;