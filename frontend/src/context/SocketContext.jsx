import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import api, { getAccessToken } from '../api/axios';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!user) {
      if (socket) socket.disconnect();
      return;
    }

    // Get the current token to authenticate the socket
    const token =
      getAccessToken() ||
      api.interceptors.request.handlers?.[0]?.fulfilled?.({ headers: {} })?.headers?.Authorization?.split(' ')[1];
    
    if (!token) return;

    const newSocket = io(import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000', {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Socket connected securely');
    });

    newSocket.on('vault_package_received', (data) => {
      setNotifications((prev) => [data, ...prev]);
    });

    setSocket(newSocket);

    return () => newSocket.disconnect();
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, notifications, setNotifications }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
export { SocketContext };
