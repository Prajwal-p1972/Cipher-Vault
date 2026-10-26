import { SCOPES, verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/errors.js';
import { User } from '../models/User.js';

/**
 * Middleware factory requiring a valid JWT with an exact audience scope.
 * Attaches req.auth = { userId }.
 *
 * @param {'access'|'mfa_challenge'|'mfa_setup'|'refresh'} [scope=SCOPES.ACCESS]
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(scope = SCOPES.ACCESS) {
  return (req, res, next) => {
    const authHeader = req.get('authorization') || req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or malformed authorization header');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw AppError.unauthorized('Missing token');
    }

    const payload = verifyToken(token, scope);
    req.auth = { userId: payload.sub };
    next();
  };
}

/**
 * Middleware factory restricting endpoint access to a specific user role.
 * Queries the database for the user role and throws 403 if mismatched.
 *
 * @param {'user'|'admin'} role
 * @returns {import('express').RequestHandler}
 */
export function requireRole(role) {
  return async (req, res, next) => {
    if (!req.auth?.userId) {
      throw AppError.unauthorized('Authentication required');
    }

    const user = await User.findById(req.auth.userId).select('role').lean().exec();
    if (!user || user.role !== role) {
      throw AppError.forbidden('Forbidden: insufficient permissions');
    }

    req.user = user;
    next();
  };
}
