import { Server } from 'socket.io';
import { verifyToken } from '../utils/jwt.js';
import { env } from './env.js';

let io;
// Map to track active connections: userId (string) -> socketId
const connectedUsers = new Map();

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true }
  });

  // Zero-trust socket authentication
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: No token provided'));
      
      const payload = verifyToken(token, 'access');
      if (!payload) return next(new Error('Authentication error: Invalid token'));
      
      socket.userId = payload.sub;
      next();
    } catch (err) {
      next(new Error('Authentication error: Token verification failed'));
    }
  });

  io.on('connection', (socket) => {
    connectedUsers.set(socket.userId.toString(), socket.id);
    
    socket.on('disconnect', () => {
      // Only delete if the disconnected socket is the currently mapped one
      if (connectedUsers.get(socket.userId.toString()) === socket.id) {
        connectedUsers.delete(socket.userId.toString());
      }
    });
  });

  return io;
};

export const getIo = () => {
  if (!io) throw new Error('Socket.io not initialized!');
  return io;
};

export const notifyUser = (userId, event, data) => {
  if (!io) return;
  const socketId = connectedUsers.get(userId.toString());
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
};

export const closeSocket = async () => {
  if (io) {
    await new Promise((resolve) => io.close(resolve));
    io = null;
  }
  connectedUsers.clear();
};
