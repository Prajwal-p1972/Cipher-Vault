import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import {
  register as authRegister,
  login as authLogin,
  startMfaEnrollment,
  enableMfa as authEnableMfa,
  verifyMfa as authVerifyMfa,
  refreshSession,
  logout as authLogout,
  getMe as authGetMe
} from '../services/authService.js';

const COOKIE_NAME = 'cv_refresh';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.COOKIE_SAMESITE || (env.NODE_ENV === 'production' ? 'none' : 'strict'),
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Validation Schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  password: z.string().min(12, 'Password must be 12-128 characters').max(128)
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(128)
});

const codeSchema = z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits');

const mfaEnableSchema = z.object({
  code: codeSchema
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1, 'MFA token is required'),
  code: codeSchema
});

function getContext(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || '',
    userAgent: (req.get('user-agent') || '').slice(0, 200)
  };
}

/**
 * Handles user registration.
 */
export async function register(req, res) {
  const parsed = registerSchema.parse(req.body);
  const ctx = getContext(req);
  const user = await authRegister(parsed, ctx);
  return res.status(201).json({ user });
}

/**
 * Handles credentials check and returns MFA challenge or setup token.
 */
export async function login(req, res) {
  const parsed = loginSchema.parse(req.body);
  const ctx = getContext(req);
  const result = await authLogin(parsed, ctx);
  return res.status(200).json(result);
}

/**
 * Initiates TOTP MFA setup.
 */
export async function mfaSetup(req, res) {
  const ctx = getContext(req);
  const result = await startMfaEnrollment(req.auth.userId, ctx);
  return res.status(200).json(result);
}

/**
 * Confirms TOTP MFA setup and establishes a session.
 */
export async function mfaEnable(req, res) {
  const parsed = mfaEnableSchema.parse(req.body);
  const ctx = getContext(req);
  try {
    const session = await authEnableMfa(req.auth.userId, parsed.code, ctx);

    res.cookie(COOKIE_NAME, session.refreshToken, COOKIE_OPTIONS);
    return res.status(200).json({
      accessToken: session.accessToken,
      user: session.user
    });
  } catch (err) {
    if (
      err instanceof AppError &&
      (err.statusCode === 401 || err.statusCode === 400) &&
      err.message.toLowerCase().includes('verification code')
    ) {
      console.log(`[MFA Debug] TOTP verification failed for user ID: ${req.user?._id || req.auth?.userId}. Token provided: ${parsed.code}`);
    }
    throw err;
  }
}

/**
 * Completes MFA challenge step-2 login.
 */
export async function mfaVerify(req, res) {
  const parsed = mfaVerifySchema.parse(req.body);
  const ctx = getContext(req);
  try {
    const session = await authVerifyMfa(parsed.mfaToken, parsed.code, ctx);

    res.cookie(COOKIE_NAME, session.refreshToken, COOKIE_OPTIONS);
    return res.status(200).json({
      accessToken: session.accessToken,
      user: session.user
    });
  } catch (err) {
    if (
      err instanceof AppError &&
      (err.statusCode === 401 || err.statusCode === 400) &&
      err.message.toLowerCase().includes('verification code')
    ) {
      console.log(`[MFA Debug] TOTP verification failed for user ID: ${req.user?._id || req.auth?.userId || 'challenge'}. Token provided: ${parsed.code}`);
    }
    throw err;
  }
}

/**
 * Rotates refresh token session using httpOnly cookie cv_refresh.
 */
export async function refresh(req, res) {
  const refreshToken = req.cookies?.[COOKIE_NAME];
  if (!refreshToken) {
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
    throw AppError.unauthorized('Refresh token is required');
  }

  const ctx = getContext(req);
  try {
    const session = await refreshSession(refreshToken, ctx);
    res.cookie(COOKIE_NAME, session.refreshToken, COOKIE_OPTIONS);
    return res.status(200).json({
      accessToken: session.accessToken,
      user: session.user
    });
  } catch (err) {
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
    throw err;
  }
}

/**
 * Terminates user session and purges refresh cookie.
 */
export async function logout(req, res) {
  const refreshToken = req.cookies?.[COOKIE_NAME];
  const ctx = getContext(req);

  res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
  await authLogout(refreshToken, ctx);
  return res.status(204).send();
}

/**
 * Returns current authenticated user profile.
 */
export async function me(req, res) {
  const user = await authGetMe(req.auth.userId);
  return res.status(200).json({ user });
}
