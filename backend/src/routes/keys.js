import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { SCOPES } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import {
  updateMyKey,
  getMyKey,
  getReceiverKey
} from '../controllers/keyController.js';

const router = Router();

// Ensure Cache-Control: no-store on all key endpoints
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * Rate limiter for key registration / rotation: 5 requests per hour per user.
 */
export const updateKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.auth?.userId ? `user_${req.auth.userId}` : `ip_${req.ip}`;
  },
  message: { error: 'Too many key update attempts, please try again later' }
});

/**
 * Rate limiter for receiver key lookup: 30 requests per hour per user.
 */
export const lookupReceiverLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.auth?.userId ? `user_${req.auth.userId}` : `ip_${req.ip}`;
  },
  message: { error: 'Too many receiver lookup attempts, please try again later' }
});

router.put('/me', requireAuth(SCOPES.ACCESS), updateKeyLimiter, updateMyKey);
router.get('/me', requireAuth(SCOPES.ACCESS), getMyKey);
router.get('/receiver', requireAuth(SCOPES.ACCESS), lookupReceiverLimiter, getReceiverKey);

export default router;
