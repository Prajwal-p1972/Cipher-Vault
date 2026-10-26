import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext.jsx';
import { getAccessToken, refreshSession } from '../api/http.js';

export const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { status } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (status !== 'authed') {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const socket = io('/', {
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: getAccessToken() });
      },
      autoConnect: true,
      reconnection: true
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    const handleReauth = async () => {
      try {
        await refreshSession();
        socket.connect();
      } catch (_) {
        socket.disconnect();
      }
    };

    socket.on('auth:expired', handleReauth);
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        handleReauth();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [status]);

  const on = (event, handler) => {
    if (!socketRef.current) {
      return () => {};
    }
    socketRef.current.on(event, handler);
    return () => {
      if (socketRef.current) {
        socketRef.current.off(event, handler);
      }
    };
  };

  const value = {
    connected,
    on,
    socket: socketRef.current
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
