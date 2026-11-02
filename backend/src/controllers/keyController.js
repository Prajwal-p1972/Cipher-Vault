import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import {
  registerVaultKey,
  getMyVaultKey,
  getReceiverVaultKey
} from '../services/keyService.js';

const putMeSchema = z.object({
  publicKey: z.string().min(1, 'publicKey is required'),
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit TOTP string')
});

const getReceiverQuerySchema = z.object({
  email: z.string().email('Valid email is required')
});

/**
 * Handles vault public key registration / rotation for authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function updateMyKey(req, res) {
  res.set('Cache-Control', 'no-store');

  const parsed = putMeSchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message
    }));
    throw AppError.badRequest('Validation failed', details);
  }

  const { publicKey, code } = parsed.data;
  const ctx = {
    ip: req.ip,
    userAgent: req.get('user-agent')
  };

  try {
    const result = await registerVaultKey(
      {
        userId: req.auth.userId,
        publicKey,
        code
      },
      ctx
    );

    res.status(200).json(result);
  } catch (err) {
    if (
      err instanceof AppError &&
      (err.statusCode === 401 || err.statusCode === 400) &&
      err.message.toLowerCase().includes('verification code')
    ) {
      console.log(`[MFA Debug] TOTP verification failed for user ID: ${req.user?._id || req.auth?.userId}. Token provided: ${code}`);
    }
    throw err;
  }
}

/**
 * Retrieves the current user's vault key status.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getMyKey(req, res) {
  res.set('Cache-Control', 'no-store');

  const result = await getMyVaultKey(req.auth.userId);
  res.status(200).json(result);
}

/**
 * Retrieves a receiver's vault key registration status and fingerprint.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getReceiverKey(req, res) {
  res.set('Cache-Control', 'no-store');

  const parsed = getReceiverQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message
    }));
    throw AppError.badRequest('Validation failed', details);
  }

  const result = await getReceiverVaultKey(parsed.data.email);
  res.status(200).json(result);
}
