// src/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');
const { SHARED_NETWORK_PATH } = require('../middleware/upload');

// Serve network share images
router.get('/network/:filename', protect, (req, res) => {
  const safeName = path.basename(req.params.filename);
  const safePath = path.resolve(SHARED_NETWORK_PATH, safeName);

  if (!fs.existsSync(safePath)) {
    return res.status(404).json({ success: false, message: 'Image not found' });
  }

  res.sendFile(safePath); // absolute path required for sendFile
});

// Alternative: Serve local uploads
router.get('/local/:filename', protect, (req, res) => {
  try {
    const uploadDir = process.env.UPLOAD_PATH || './uploads';
    const filename = req.params.filename;
    const safePath = path.join(uploadDir, path.basename(filename));
    
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    
    res.sendFile(safePath);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ success: false, message: 'Error serving image' });
  }
});

module.exports = router;