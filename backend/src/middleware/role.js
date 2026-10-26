import { AppError } from '../utils/errors.js';

/**
 * Middleware factory restricting endpoint access to specific user role(s).
 *
 * @param {string | string[]} roles - Required role or array of allowed roles
 * @returns {import('express').RequestHandler}
 */
export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized('Authentication required'));
    }

    if (!allowed.includes(req.user.role)) {
      return next(
        AppError.forbidden(`Access forbidden: requires one of roles [${allowed.join(', ')}]`)
      );
    }

    next();
  };
}
