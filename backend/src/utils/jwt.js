import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export const SCOPES = {
  ACCESS: 'access',
  MFA_CHALLENGE: 'mfa_challenge',
  MFA_SETUP: 'mfa_setup',
  REFRESH: 'refresh'
};

const LIFETIMES = {
  [SCOPES.ACCESS]: '15m',
  [SCOPES.MFA_CHALLENGE]: '5m',
  [SCOPES.MFA_SETUP]: '15m',
  [SCOPES.REFRESH]: '7d'
};

const ISSUER = 'cipher-vault';

/**
 * Signs a scoped JWT token using HS256.
 *
 * @param {string} userId - User identifier (subject)
 * @param {'access'|'mfa_challenge'|'mfa_setup'|'refresh'} scope - Target audience scope
 * @param {object} [options={}] - Extra signing options
 * @param {string} [options.jwtid] - Optional unique JWT ID
 * @returns {string} Signed JWT
 */
export function signToken(userId, scope, { jwtid } = {}) {
  if (!Object.values(SCOPES).includes(scope)) {
    throw new Error(`Invalid token scope: ${scope}`);
  }

  const secret = scope === SCOPES.REFRESH ? env.JWT_REFRESH_SECRET : env.JWT_ACCESS_SECRET;
  const expiresIn = LIFETIMES[scope];

  const options = {
    algorithm: 'HS256',
    issuer: ISSUER,
    subject: String(userId),
    audience: scope,
    expiresIn
  };

  if (jwtid) {
    options.jwtid = jwtid;
  }

  return jwt.sign({}, secret, options);
}

/**
 * Verifies a token against a required audience scope.
 * Pins HS256, verifies issuer and audience, returns decoded payload.
 * Throws a generic unauthorized AppError on any verification failure.
 *
 * @param {string} token - Raw JWT string
 * @param {'access'|'mfa_challenge'|'mfa_setup'|'refresh'} scope - Expected scope
 * @returns {object} Decoded JWT payload
 */
export function verifyToken(token, scope) {
  if (!Object.values(SCOPES).includes(scope)) {
    throw new Error(`Invalid token scope: ${scope}`);
  }

  if (!token || typeof token !== 'string') {
    throw AppError.unauthorized('Invalid or expired token');
  }

  const secret = scope === SCOPES.REFRESH ? env.JWT_REFRESH_SECRET : env.JWT_ACCESS_SECRET;

  try {
    return jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: scope
    });
  } catch {
    throw AppError.unauthorized('Invalid or expired token');
  }
}

// Convenience helper methods
export const signAccessToken = (user) => signToken(user._id || user.id, SCOPES.ACCESS);
export const signMfaChallengeToken = (user) => signToken(user._id || user.id, SCOPES.MFA_CHALLENGE);
export const signMfaSetupToken = (user) => signToken(user._id || user.id, SCOPES.MFA_SETUP);
export const signRefreshToken = (user, { jwtid } = {}) => signToken(user._id || user.id, SCOPES.REFRESH, { jwtid });
