const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const NotificationService = require('../services/notificationService');

let io;

function initializeSocket(server) {
  io = socketIO(server, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000,
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000
  });

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.id).select('_id role name');
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔥 ${socket.user.name} connected`);

    socket.join(`user_${socket.user._id}`);
    socket.join(`role_${socket.user.role}`);

    // Send unread count
    NotificationService.getUnreadNotificationCount(socket.user._id)
      .then(count => socket.emit('unread_count', count))
      .catch(err => console.error(err));

    // Rate limit (env controlled)
    let lastActionTime = 0;
    const throttleTime = 500; // you can also move this to env if needed

    socket.on('mark_notification_read', async (notificationId, callback) => {
      try {
        const now = Date.now();
        if (now - lastActionTime < throttleTime) return;

        lastActionTime = now;

        await NotificationService.markAsRead(notificationId, socket.user._id);

        const unreadCount = await NotificationService.getUnreadNotificationCount(socket.user._id);

        io.to(`user_${socket.user._id}`).emit('unread_count', unreadCount);

        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ ${socket.user.name} disconnected`);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

module.exports = { initializeSocket, getIO };