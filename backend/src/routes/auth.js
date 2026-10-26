import { Router } from 'express';
import { SCOPES } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  register,
  login,
  mfaSetup,
  mfaEnable,
  mfaVerify,
  refresh,
  logout,
  me
} from '../controllers/authController.js';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/mfa/verify', authLimiter, mfaVerify);
router.post('/refresh', authLimiter, refresh);
router.post('/mfa/setup', authLimiter, requireAuth(SCOPES.MFA_SETUP), mfaSetup);
router.post('/mfa/enable', authLimiter, requireAuth(SCOPES.MFA_SETUP), mfaEnable);
router.post('/logout', logout);
router.get('/me', requireAuth(SCOPES.ACCESS), me);

export default router;
