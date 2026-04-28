// src/middleware/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Network share path (main storage for images)
const SHARED_NETWORK_PATH = '\\\\192.168.1.2\\appmedia\\20260423';
const PROFILE_PICS_PATH = path.join(SHARED_NETWORK_PATH, 'profile');
const LOCAL_BACKUP_PATH = process.env.UPLOAD_PATH || './uploads';
const LOCAL_PROFILE_BACKUP_PATH = path.join(LOCAL_BACKUP_PATH, 'profile');

// Ensure directories exist
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
};

// Ensure network path is accessible
ensureDirectoryExists(SHARED_NETWORK_PATH);
ensureDirectoryExists(PROFILE_PICS_PATH);
ensureDirectoryExists(LOCAL_BACKUP_PATH);
ensureDirectoryExists(LOCAL_PROFILE_BACKUP_PATH);

// Custom storage for network share (PRIMARY STORAGE)
const networkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine destination based on file type/field
    let destPath = SHARED_NETWORK_PATH;
    if (file.fieldname === 'profileImage') {
      destPath = PROFILE_PICS_PATH;
    }
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

// Backup local storage (in case network fails)
const localBackupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let destPath = LOCAL_BACKUP_PATH;
    if (file.fieldname === 'profileImage') {
      destPath = LOCAL_PROFILE_BACKUP_PATH;
    }
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|heic|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, heic, webp)'));
  }
};

// Profile picture specific file filter (allow common profile pic formats)
const profilePicFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for profile picture (jpeg, jpg, png, gif, webp)'));
  }
};

// Custom upload middleware that saves to network share with fallback
const createNetworkUpload = () => {
  return multer({ 
    storage: networkStorage, 
    limits: { fileSize: 10 * 1024 * 1024 }, 
    fileFilter 
  });
};

// Create upload middleware with custom storage handler
const upload = multer({ 
  storage: networkStorage,  // Changed to network storage as default
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter 
});

// Profile picture upload middleware (with smaller file size limit)
const uploadProfilePic = multer({ 
  storage: networkStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile pictures
  fileFilter: profilePicFileFilter
});

// Network upload middleware (same as upload now)
const networkUpload = createNetworkUpload();

// Helper function to get file URL for response
const getFileUrl = (filename) => {
  return `/api/uploads/network/${filename}`;
};

// Helper function to get profile pic URL
const getProfilePicUrl = (filename) => {
  return `/api/uploads/profile/${filename}`;
};

// Function to save file to multiple locations (network + local backup)
const saveToMultipleLocations = async (file, reportId, index) => {
  const savedPaths = [];
  const errors = [];
  
  // Extract file extension
  const fileExtension = file.originalname.split('.').pop();
  const customFilename = `${reportId}_photo_${index + 1}.${fileExtension}`;
  
  // Save to network share (primary)
  try {
    const networkPath = path.join(SHARED_NETWORK_PATH, customFilename);
    fs.copyFileSync(file.path, networkPath);
    savedPaths.push({ location: 'network', path: networkPath, url: `/api/uploads/network/${customFilename}` });
    console.log(`File saved to network: ${networkPath}`);
  } catch (error) {
    errors.push({ location: 'network', error: error.message });
    console.error('Failed to save to network:', error);
  }
  
  // Save to local backup (secondary)
  try {
    const localPath = path.join(LOCAL_BACKUP_PATH, customFilename);
    fs.copyFileSync(file.path, localPath);
    savedPaths.push({ location: 'local', path: localPath, url: `/uploads/${customFilename}` });
    console.log(`File saved to local backup: ${localPath}`);
  } catch (error) {
    errors.push({ location: 'local', error: error.message });
    console.error('Failed to save to local backup:', error);
  }
  
  // Clean up temp file
  try {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
  
  return { savedPaths, errors, customFilename };
};

// Function to save profile picture
const saveProfilePicture = async (file, userId) => {
  const savedPaths = [];
  const errors = [];
  
  // Get file extension
  const fileExtension = file.originalname.split('.').pop();
  const customFilename = `profile_${userId}_${Date.now()}.${fileExtension}`;
  
  // Save to network profile folder (primary)
  try {
    const networkPath = path.join(PROFILE_PICS_PATH, customFilename);
    fs.copyFileSync(file.path, networkPath);
    const profileUrl = `/api/uploads/profile/${customFilename}`;
    savedPaths.push({ location: 'network', path: networkPath, url: profileUrl });
    console.log(`Profile picture saved to network: ${networkPath}`);
  } catch (error) {
    errors.push({ location: 'network', error: error.message });
    console.error('Failed to save profile picture to network:', error);
  }
  
  // Save to local backup (secondary)
  try {
    const localPath = path.join(LOCAL_PROFILE_BACKUP_PATH, customFilename);
    fs.copyFileSync(file.path, localPath);
    const profileUrl = `/uploads/profile/${customFilename}`;
    savedPaths.push({ location: 'local', path: localPath, url: profileUrl });
    console.log(`Profile picture saved to local backup: ${localPath}`);
  } catch (error) {
    errors.push({ location: 'local', error: error.message });
    console.error('Failed to save profile picture to local backup:', error);
  }
  
  // Clean up temp file
  try {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
  
  return { savedPaths, errors, customFilename, profileUrl: `/api/uploads/profile/${customFilename}` };
};

module.exports = { 
  upload,                    // Saves to network share by default
  networkUpload,
  LOCAL_BACKUP_PATH,
  saveToMultipleLocations,
  getFileUrl,
  uploadProfilePic,          // For profile picture uploads
  getProfilePicUrl,          // Helper for profile pic URLs
  saveProfilePicture,        // Save profile picture function
  PROFILE_PICS_PATH,         // Export profile pics path
  SHARED_NETWORK_PATH,       // Export main network path
  LOCAL_PROFILE_BACKUP_PATH  // Export local profile backup path
};