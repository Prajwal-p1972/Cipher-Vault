import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { SCOPES, verifyToken } from '../utils/jwt.js';

let io = null;
const userSocketsMap = new Map();

/**
 * Initializes the Socket.io realtime server attached to the HTTP server.
 * Configured with strict CORS, access token handshake authentication,
 * per-user concurrency limits, token expiry disconnects, and ping rate limiting.
 *
 * @param {import('node:http').Server} httpServer
 * @returns {Server} Socket.io server instance
 */
export function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin && origin !== env.CLIENT_ORIGIN) {
        return callback('Origin not allowed by CORS', false);
      }
      callback(null, true);
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 10 * 1024 // 10 KB
  });

  // Handshake authentication middleware
  io.use((socket, next) => {
    // SECURITY: Reject tokens passed via query parameters to prevent leakage in URL logs
    if (socket.handshake.query && socket.handshake.query.token) {
      return next(new Error('unauthorized'));
    }

    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('unauthorized'));
    }

    try {
      const payload = verifyToken(token, SCOPES.ACCESS);
      socket.userId = payload.sub;
      socket.tokenExp = payload.exp;
      next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    const userRoom = `user:${userId}`;

    socket.join(userRoom);

    // Concurrency limit: max 5 active sockets per user
    if (!userSocketsMap.has(userId)) {
      userSocketsMap.set(userId, []);
    }
    const userSockets = userSocketsMap.get(userId);
    userSockets.push(socket);

    if (userSockets.length > 5) {
      const oldestSocket = userSockets.shift();
      if (oldestSocket && oldestSocket.connected) {
        oldestSocket.disconnect(true);
      }
    }

    // Token expiration disconnect timer
    let expiryTimer = null;
    if (socket.tokenExp) {
      const remainingMs = socket.tokenExp * 1000 - Date.now();
      if (remainingMs <= 0) {
        socket.emit('auth:expired');
        socket.disconnect(true);
      } else {
        expiryTimer = setTimeout(() => {
          socket.emit('auth:expired');
          socket.disconnect(true);
        }, remainingMs);
      }
    }

    // Rate-limited ping listener: max 10/min per socket
    let pingCount = 0;
    const pingResetInterval = setInterval(() => {
      pingCount = 0;
    }, 60000);
    pingResetInterval.unref();

    socket.on('ping', (cb) => {
      pingCount++;
      if (pingCount > 10) {
        socket.disconnect(true);
        return;
      }
      if (typeof cb === 'function') {
        cb();
      } else {
        socket.emit('pong');
      }
    });

    socket.on('disconnect', () => {
      if (expiryTimer) {
        clearTimeout(expiryTimer);
      }
      clearInterval(pingResetInterval);

      const list = userSocketsMap.get(userId);
      if (list) {
        const idx = list.indexOf(socket);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
        if (list.length === 0) {
          userSocketsMap.delete(userId);
        }
      }
    });
  });

  return io;
}

/**
 * Emits an event to all connected sockets in a user's private room.
 *
 * @param {string} userId - Target user ID
 * @param {string} event - Event name
 * @param {object} payload - Event payload
 * @returns {number} Number of active sockets reached
 */
export function emitToUser(userId, event, payload) {
  if (!io) {
    return 0;
  }
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  const count = room ? room.size : 0;
  if (count > 0) {
    io.to(`user:${userId}`).emit(event, payload);
  }
  return count;
}

/**
 * Closes the Socket.io server and cleans up active connections.
 *
 * @returns {Promise<void>}
 */
export async function closeSocketServer() {
  if (io) {
    await new Promise((resolve) => {
      io.close(() => resolve());
    });
    io = null;
  }
  userSocketsMap.clear();
}
