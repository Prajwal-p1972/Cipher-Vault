import rateLimit from 'express-rate-limit';

/**
 * Rate limiter applied across all authentication endpoints.
 * Enforces a strict maximum of 30 requests per 15-minute window per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per window
  standardHeaders: true, // Draft-6 RateLimit headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    error: 'Too many authentication requests from this IP. Please try again after 15 minutes.'
  },
  skip: () => process.env.NODE_ENV === 'test'
});
