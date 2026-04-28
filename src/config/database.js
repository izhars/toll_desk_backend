const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,          // 👈 connection pool size
      serverSelectionTimeoutMS: 5000, // fail fast if DB not reachable
      socketTimeoutMS: 45000,   // close idle sockets
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB Connection Failed:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;