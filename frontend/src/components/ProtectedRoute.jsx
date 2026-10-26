import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { status } = useAuth();

  if (status === 'booting') {
    return (
      <div className="booting-screen" role="status" aria-label="Loading secure session">
        <div className="spinner" />
        <p>Restoring secure session...</p>
      </div>
    );
  }

  if (status !== 'authed') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;
