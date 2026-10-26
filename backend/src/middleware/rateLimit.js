import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const maxRequests = Number(env?.RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX || 30);

/**
 * Rate limiter for authentication routes: defaults to 30 requests per 15 minutes per IP.
 * Configurable via optional RATE_LIMIT_MAX environment variable.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: maxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
