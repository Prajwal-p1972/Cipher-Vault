import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { secretBox, unsealBox, getMfaKey, sha256Hex } from '../utils/crypto.js';
import { generateTotpSecret, verifyTotp } from '../utils/totp.js';
import { SCOPES, signToken, verifyToken } from '../utils/jwt.js';
import { audit } from './auditService.js';

// Pre-computed bcrypt cost-12 hash for timing equalization against user enumeration
const DUMMY_HASH = bcrypt.hashSync('cipher-vault-dummy-password-timing-equalization', 12);

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Issues an authenticated session with an access token, refresh token, and public user profile.
 * Stores only the SHA-256 hash of the refresh token, retaining up to 5 active sessions.
 *
 * @param {object} user - Mongoose User document
 * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
 */
async function issueSession(user) {
  const jwtid = crypto.randomUUID();
  const accessToken = signToken(user._id, SCOPES.ACCESS);
  const refreshToken = signToken(user._id, SCOPES.REFRESH, { jwtid });
  const refreshHash = sha256Hex(refreshToken);

  await User.findByIdAndUpdate(user._id, {
    $push: {
      refreshTokenHashes: {
        $each: [refreshHash],
        $slice: -5
      }
    }
  });

  return {
    accessToken,
    refreshToken,
    user: typeof user.toPublic === 'function' ? user.toPublic() : user
  };
}

/**
 * Increments failed login count and triggers account lockout upon 5 failures.
 *
 * @param {object} user - User document
 * @param {string} action - Audit action trigger
 * @param {object} [ctx={}] - Request context (ip, userAgent)
 * @returns {Promise<void>}
 */
async function recordFailure(user, action, ctx = {}) {
  const currentAttempts = (user.failedLoginAttempts || 0) + 1;

  if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        lockUntil,
        failedLoginAttempts: 0
      }
    });

    await audit({
      actor: user._id,
      action: 'ACCOUNT_LOCKED',
      resourceKind: 'User',
      resourceId: user._id.toString(),
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: { trigger: action }
    });
  } else {
    await User.findByIdAndUpdate(user._id, {
      $inc: { failedLoginAttempts: 1 }
    });
  }

  await audit({
    actor: user._id,
    action,
    resourceKind: 'User',
    resourceId: user._id.toString(),
    outcome: 'failure',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    meta: { attempts: currentAttempts }
  });
}

/**
 * Registers a new user. Does not issue any session tokens.
 *
 * @param {{ email: string, displayName: string, password: string }} data
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<object>} Public user profile
 */
export async function register({ email, displayName, password }, ctx = {}) {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail }).lean().exec();
  if (existing) {
    throw AppError.conflict('Email already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let newUser;
  try {
    newUser = new User({
      email: normalizedEmail,
      displayName: displayName.trim(),
      passwordHash,
      role: 'user',
      mfa: {
        enabled: false,
        secretEnc: null,
        pendingSecretEnc: null,
        lastUsedStep: 0
      }
    });
    await newUser.save();
  } catch (err) {
    if (err.code === 11000) {
      throw AppError.conflict('Email already registered');
    }
    throw err;
  }

  await audit({
    actor: newUser._id,
    action: 'USER_REGISTER',
    resourceKind: 'User',
    resourceId: newUser._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  return newUser.toPublic();
}

/**
 * Authenticates user credentials. Issues NO full session.
 * Returns either an MFA setup token or an MFA challenge token.
 *
 * @param {{ email: string, password: string }} credentials
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ status: string, setupToken?: string, mfaToken?: string }>}
 */
export async function login({ email, password }, ctx = {}) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail })
    .select('+passwordHash')
    .exec();

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit({
      actor: null,
      action: 'LOGIN_FAILED',
      resourceKind: 'User',
      resourceId: null,
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: { reason: 'unknown_email' }
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  const now = new Date();
  if (user.lockUntil && user.lockUntil > now) {
    throw AppError.locked('Account is locked. Try again later.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    await recordFailure(user, 'LOGIN_FAILED', ctx);
    throw AppError.unauthorized('Invalid credentials');
  }

  await User.findByIdAndUpdate(user._id, {
    $set: {
      failedLoginAttempts: 0,
      lockUntil: null
    }
  });

  await audit({
    actor: user._id,
    action: 'LOGIN_PASSWORD_OK',
    resourceKind: 'User',
    resourceId: user._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  if (!user.mfa?.enabled) {
    const setupToken = signToken(user._id, SCOPES.MFA_SETUP);
    return {
      status: 'MFA_SETUP_REQUIRED',
      setupToken
    };
  }

  const mfaToken = signToken(user._id, SCOPES.MFA_CHALLENGE);
  return {
    status: 'MFA_REQUIRED',
    mfaToken
  };
}

/**
 * Initiates TOTP MFA enrollment by generating and sealing a secret.
 *
 * @param {string} userId - User identifier
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ otpauthUrl: string, qrDataUrl: string, manualEntryKey: string }>}
 */
export async function startMfaEnrollment(userId, ctx = {}) {
  const user = await User.findById(userId).exec();
  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  if (user.mfa?.enabled) {
    throw AppError.conflict('MFA is already enabled');
  }

  const secret = generateTotpSecret(user.email);
  const pendingSecretEnc = secretBox(secret.base32, getMfaKey());

  await User.findByIdAndUpdate(userId, {
    $set: { 'mfa.pendingSecretEnc': pendingSecretEnc }
  });

  const qrDataUrl = await QRCode.toDataURL(secret.otpauthUrl);

  await audit({
    actor: user._id,
    action: 'MFA_ENROLL_STARTED',
    resourceKind: 'User',
    resourceId: user._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  return {
    otpauthUrl: secret.otpauthUrl,
    qrDataUrl,
    manualEntryKey: secret.base32
  };
}

/**
 * Confirms and activates TOTP MFA enrollment. Issues session upon success.
 *
 * @param {string} userId - User identifier
 * @param {string} code - 6-digit TOTP code
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
 */
export async function enableMfa(userId, code, ctx = {}) {
  const user = await User.findById(userId)
    .select('+mfa.pendingSecretEnc +mfa.lastUsedStep')
    .exec();

  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  if (user.mfa?.enabled) {
    throw AppError.conflict('MFA is already enabled');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    throw AppError.locked('Account is locked. Try again later.');
  }

  if (!user.mfa?.pendingSecretEnc) {
    throw AppError.badRequest('No pending MFA enrollment found');
  }

  const base32Secret = user.mfaSecret || unsealBox(user.mfa.pendingSecretEnc, getMfaKey());
  const step = verifyTotp(base32Secret, code);

  if (step === null) {
    console.log(`[MFA Debug] TOTP verification failed for user ID: ${user._id}. Token provided: ${code}`);
    await recordFailure(user, 'MFA_VERIFY_FAILED', ctx);
    throw AppError.unauthorized('Invalid verification code');
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        'mfa.enabled': true,
        'mfa.secretEnc': user.mfa.pendingSecretEnc,
        'mfa.lastUsedStep': step,
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date()
      },
      $unset: { 'mfa.pendingSecretEnc': 1 }
    },
    { new: true }
  ).exec();

  await audit({
    actor: updatedUser._id,
    action: 'MFA_ENABLED',
    resourceKind: 'User',
    resourceId: updatedUser._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  return await issueSession(updatedUser);
}

/**
 * Verifies TOTP code during step-2 authentication with replay protection.
 *
 * @param {string} mfaToken - MFA challenge JWT
 * @param {string} code - 6-digit TOTP code
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
 */
export async function verifyMfa(mfaToken, code, ctx = {}) {
  const payload = verifyToken(mfaToken, SCOPES.MFA_CHALLENGE);
  const userId = payload.sub;

  const user = await User.findById(userId)
    .select('+mfa.secretEnc +mfa.lastUsedStep')
    .exec();

  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    throw AppError.locked('Account is locked. Try again later.');
  }

  if (!user.mfa?.enabled || !user.mfa?.secretEnc) {
    throw AppError.badRequest('MFA is not enabled on this account');
  }

  const base32Secret = user.mfaSecret || unsealBox(user.mfa.secretEnc, getMfaKey());
  const step = verifyTotp(base32Secret, code);

  if (step === null) {
    console.log(`[MFA Debug] TOTP verification failed for user ID: ${user._id}. Token provided: ${code}`);
    await recordFailure(user, 'MFA_VERIFY_FAILED', ctx);
    throw AppError.unauthorized('Invalid verification code');
  }

  // Atomically claim the time-step to guard against replay attacks
  const claimedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      'mfa.lastUsedStep': { $lt: step }
    },
    {
      $set: {
        'mfa.lastUsedStep': step,
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date()
      }
    },
    { new: true }
  ).exec();

  if (!claimedUser) {
    console.log(`[MFA Debug] TOTP verification failed for user ID: ${user._id}. Token provided: ${code}`);
    await audit({
      actor: userId,
      action: 'MFA_VERIFY_FAILED',
      resourceKind: 'User',
      resourceId: userId.toString(),
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: { reason: 'replay' }
    });
    throw AppError.unauthorized('Invalid or already used verification code');
  }

  await audit({
    actor: claimedUser._id,
    action: 'MFA_VERIFY_OK',
    resourceKind: 'User',
    resourceId: claimedUser._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  return await issueSession(claimedUser);
}

/**
 * Validates TOTP code for high-privilege step-up authentication.
 * Performs account lock checks, time-step validation, replay protection, and audit logging.
 * Issues NO tokens and does NOT alter refresh hashes.
 *
 * @param {string} userId - User identifier
 * @param {string} code - 6-digit TOTP code
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ verified: boolean }>}
 */
export async function verifyStepUp(userId, code, ctx = {}) {
  const user = await User.findById(userId)
    .select('+mfa.secretEnc +mfa.lastUsedStep')
    .exec();

  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    throw AppError.locked('Account is locked. Try again later.');
  }

  if (!user.mfa?.enabled || !user.mfa?.secretEnc) {
    throw AppError.badRequest('MFA is not enabled on this account');
  }

  const base32Secret = user.mfaSecret || unsealBox(user.mfa.secretEnc, getMfaKey());
  const step = verifyTotp(base32Secret, code);

  if (step === null) {
    console.log(`[MFA Debug] TOTP verification failed for user ID: ${user._id}. Token provided: ${code}`);
    await recordFailure(user, 'MFA_VERIFY_FAILED', ctx);
    throw AppError.unauthorized('Invalid verification code');
  }

  // Atomically claim the time-step to guard against replay attacks
  const claimedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      'mfa.lastUsedStep': { $lt: step }
    },
    {
      $set: {
        'mfa.lastUsedStep': step,
        failedLoginAttempts: 0,
        lockUntil: null
      }
    },
    { new: true }
  ).exec();

  if (!claimedUser) {
    console.log(`[MFA Debug] TOTP verification failed for user ID: ${user._id}. Token provided: ${code}`);
    await audit({
      actor: userId,
      action: 'MFA_VERIFY_FAILED',
      resourceKind: 'User',
      resourceId: userId.toString(),
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: { reason: 'replay' }
    });
    throw AppError.unauthorized(
      'Invalid or already used verification code. Please wait for the next code.'
    );
  }

  await audit({
    actor: claimedUser._id,
    action: 'MFA_VERIFY_OK',
    resourceKind: 'User',
    resourceId: claimedUser._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    meta: { purpose: 'step_up' }
  });

  return { verified: true };
}

/**
 * Rotates a refresh token with atomic consumption and reuse protection.
 *
 * @param {string} refreshToken - Raw refresh JWT
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
 */
export async function refreshSession(refreshToken, ctx = {}) {
  const payload = verifyToken(refreshToken, SCOPES.REFRESH);
  const userId = payload.sub;
  const tokenHash = sha256Hex(refreshToken);

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      refreshTokenHashes: tokenHash
    },
    {
      $pull: { refreshTokenHashes: tokenHash }
    },
    { new: true }
  ).exec();

  if (!user) {
    // Validly signed refresh token that is not registered -> token reuse attack!
    await User.findByIdAndUpdate(userId, {
      $set: { refreshTokenHashes: [] }
    }).exec();

    await audit({
      actor: userId,
      action: 'TOKEN_REUSE_DETECTED',
      resourceKind: 'User',
      resourceId: userId.toString(),
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null
    });

    throw AppError.unauthorized('Token reuse detected');
  }

  await audit({
    actor: user._id,
    action: 'TOKEN_REFRESH',
    resourceKind: 'User',
    resourceId: user._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });

  return await issueSession(user);
}

/**
 * Revokes a refresh token session (best effort).
 *
 * @param {string} refreshToken - Raw refresh JWT
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @returns {Promise<void>}
 */
export async function logout(refreshToken, ctx = {}) {
  if (typeof refreshToken === 'string' && refreshToken.length > 0) {
    try {
      const payload = verifyToken(refreshToken, SCOPES.REFRESH);
      const userId = payload.sub;
      const tokenHash = sha256Hex(refreshToken);

      await User.findByIdAndUpdate(userId, {
        $pull: { refreshTokenHashes: tokenHash }
      }).exec();

      await audit({
        actor: userId,
        action: 'LOGOUT',
        resourceKind: 'User',
        resourceId: userId.toString(),
        outcome: 'success',
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null
      });
      return;
    } catch {
      // Best effort: ignore verification errors on logout
    }
  }

  await audit({
    actor: null,
    action: 'LOGOUT',
    resourceKind: 'User',
    resourceId: null,
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null
  });
}

/**
 * Retrieves the public profile of the authenticated user.
 *
 * @param {string} userId - User identifier
 * @returns {Promise<object>} Public user profile
 */
export async function getMe(userId) {
  const user = await User.findById(userId).exec();
  if (!user) {
    throw AppError.unauthorized('User not found');
  }
  return user.toPublic();
}

// Aliases for compatibility
export const registerUser = register;
export const loginUser = login;
export const startMfa = startMfaEnrollment;
export const setupMfa = startMfaEnrollment;
export const logoutUser = logout;
