// src/routes/testUploadRoutes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { networkUpload, SHARED_NETWORK_PATH } = require('../middleware/upload');
const { protect } = require('../middleware/auth');

// Test upload to network share
router.post('/upload-to-network', protect, networkUpload.array('photos', 5), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    
    const files = req.files.map(file => ({
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      size: file.size
    }));
    
    res.json({
      success: true,
      message: `Uploaded ${req.files.length} file(s) to network share`,
      networkPath: SHARED_NETWORK_PATH,
      files: files
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Check network share status
router.get('/network-status', protect, (req, res) => {
  const exists = fs.existsSync(SHARED_NETWORK_PATH);
  let writable = false;
  
  if (exists) {
    try {
      fs.accessSync(SHARED_NETWORK_PATH, fs.constants.W_OK);
      writable = true;
    } catch (err) {}
  }
  
  res.json({
    success: true,
    networkPath: SHARED_NETWORK_PATH,
    accessible: exists && writable,
    exists: exists,
    writable: writable
  });
});

// List files in network share
router.get('/network-files', protect, (req, res) => {
  try {
    const files = fs.readdirSync(SHARED_NETWORK_PATH);
    const fileDetails = files.map(file => {
      const stats = fs.statSync(path.join(SHARED_NETWORK_PATH, file));
      return {
        name: file,
        size: stats.size,
        modified: stats.mtime
      };
    });
    
    res.json({
      success: true,
      path: SHARED_NETWORK_PATH,
      count: fileDetails.length,
      files: fileDetails
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;