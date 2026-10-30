import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { SCOPES } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import {
  createDocument,
  listSent,
  listReceived,
  getMeta,
  openDocument,
  getKeyEnvelope
} from '../controllers/documentController.js';

const router = Router();

/**
 * Rate limiter for document uploads: 20 requests per hour per user/IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userPart = req.auth?.userId || 'anon';
    return `${req.ip}_${userPart}`;
  },
  message: { error: 'Too many upload requests, please try again later' }
});

/**
 * Validates that :id route parameter is a valid 24-character hex MongoDB ObjectId.
 */
function validateObjectId(req, res, next) {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id) || String(new mongoose.Types.ObjectId(id)) !== id) {
    throw AppError.badRequest('Invalid document ID format');
  }
  next();
}

// Enforce Cache-Control: no-store across all document endpoints
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * Rate limiter for document unlocking: UNLOCK_MAX_PER_15MIN per 15 min per authenticated user.
 */
export const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.UNLOCK_MAX_PER_15MIN || 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.auth?.userId ? `user_${req.auth.userId}` : `ip_${req.ip}`;
  },
  message: { error: 'Too many unlock attempts, please try again later' }
});

/**
 * Rate limiter for key envelope retrieval: 30 requests per 15 min per user.
 */
export const keyEnvelopeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.auth?.userId ? `user_${req.auth.userId}` : `ip_${req.ip}`;
  },
  message: { error: 'Too many envelope requests, please try again later' }
});

// Document endpoints
router.post(
  '/',
  requireAuth(SCOPES.ACCESS),
  uploadLimiter,
  uploadMiddleware,
  createDocument
);

router.post(
  '/:id/open',
  requireAuth(SCOPES.ACCESS),
  validateObjectId,
  unlockLimiter,
  openDocument
);

router.get(
  '/:id/key-envelope',
  requireAuth(SCOPES.ACCESS),
  validateObjectId,
  keyEnvelopeLimiter,
  getKeyEnvelope
);

router.get('/sent', requireAuth(SCOPES.ACCESS), listSent);
router.get('/received', requireAuth(SCOPES.ACCESS), listReceived);
router.get('/:id', requireAuth(SCOPES.ACCESS), validateObjectId, getMeta);

export default router;
