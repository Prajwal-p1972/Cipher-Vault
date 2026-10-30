import { createContext, useContext, useState, useEffect } from 'react';
import api, { setAccessToken } from '../api/axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize session on load
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        await fetchUser();
      } catch (err) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    initSession();
  }, []);

  const fetchUser = async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
  };

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    return data; // Returns { status: 'MFA_REQUIRED', mfaToken: '...' } etc.
  };

  const verifyMfa = async (mfaToken, code) => {
    const { data } = await api.post('/auth/mfa/verify', { mfaToken, code });
    setAccessToken(data.accessToken);
    await fetchUser();
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export { AuthContext };
