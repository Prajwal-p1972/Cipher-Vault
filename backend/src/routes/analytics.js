/**
 * Analytics routes — mounted at /api/analytics.
 *
 * GET  /me/overview         requireAuth
 * GET  /me/events           requireAuth
 * GET  /system/overview     requireAuth + requireRole('admin')
 * GET  /system/chain        requireAuth + requireRole('admin')
 *
 * Per-user rate limit: 60 requests per minute.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import { myOverview, myEvents, systemOverview, systemChain } from '../controllers/analyticsController.js';

const router = Router();

/**
 * Per-user rate limiter: 60 requests per minute.
 * Keyed by authenticated userId when present, falling back to IP.
 */
const analyticsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.auth?.userId ? `analytics_${req.auth.userId}` : `analytics_ip_${req.ip}`;
  },
  message: { error: 'Too many analytics requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

router.use(analyticsRateLimiter);

// User-scoped endpoints
router.get('/me/overview', requireAuth(), myOverview);
router.get('/me/events', requireAuth(), myEvents);

// Admin-only endpoints
router.get('/system/overview', requireAuth(), requireRole('admin'), systemOverview);
router.get('/system/chain', requireAuth(), requireRole('admin'), systemChain);

export default router;
