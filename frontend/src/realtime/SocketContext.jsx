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

    const socketUrl = (
      import.meta.env?.VITE_SOCKET_URL ||
      import.meta.env?.VITE_API_URL ||
      (typeof window !== 'undefined' && window.location.origin ? window.location.origin : '/')
    ).replace(/\/+$/, '');

    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: getAccessToken() });
      },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    socket.auth = { token: getAccessToken() };

    socketRef.current = socket;

    if (socket.connected) {
      setConnected(true);
    }

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    const handleReauth = async () => {
      try {
        const data = await refreshSession();
        const freshToken = data?.accessToken || getAccessToken();
        socket.auth = { token: freshToken };
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
