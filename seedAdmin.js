// seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./src/models/User');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {});
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  }
};

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

const seedAdmin = async () => {
  try {
    const email = 'admin@example.com';
    const password = 'admin123';

    let admin = await User.findOne({ email });

    if (admin) {
      console.log('⚠️ Admin already exists:', admin.email);
    } else {
      admin = await User.create({
        name: 'Admin',
        email,
        password, // will be hashed by your User model
        role: 'admin',
        department: 'management',
        isEmailVerified: true, // ✅ auto-verified
        phone: '0000000000',
        isActive: true
      });
      console.log('✅ Admin created:', admin.email);
    }

    // Generate JWT for testing
    const token = generateToken(admin._id);
    console.log('🔑 JWT Token for admin:', token);

    process.exit();
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
  }
};

connectDB().then(seedAdmin);
