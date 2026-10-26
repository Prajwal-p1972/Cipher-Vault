import { Router } from 'express';
import { z } from 'zod';
import {
  register,
  login,
  mfaSetup,
  mfaEnable,
  mfaVerify,
  refresh,
  logout,
  getMe
} from '../controllers/authController.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Apply rate-limiting to all authentication routes
router.use(authRateLimiter);

// Zod Validation Schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  displayName: z.string().min(1, 'Display name is required').max(64),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password cannot exceed 128 characters')
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

const mfaEnableSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits')
});

const mfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
  mfaToken: z.string().optional()
});

// Authentication endpoints
router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);
router.post('/mfa/setup', requireAuth('mfa_setup'), mfaSetup);
router.post('/mfa/enable', requireAuth('mfa_setup'), validateBody(mfaEnableSchema), mfaEnable);
router.post('/mfa/verify', validateBody(mfaVerifySchema), mfaVerify);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', requireAuth('access'), getMe);

export default router;
