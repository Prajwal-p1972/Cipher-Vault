import { Router } from 'express';
import { SCOPES } from '../utils/jwt.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { verifyChain } from '../services/auditService.js';

const router = Router();

router.get('/verify', requireAuth(SCOPES.ACCESS), requireRole('admin'), async (req, res) => {
  const result = await verifyChain();
  res.status(200).json(result);
});

export default router;
