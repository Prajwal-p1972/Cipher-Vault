import { Router } from 'express';
import { verifyAuditChain } from '../controllers/auditController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

const router = Router();

// Stream and verify cryptographic integrity of the audit hash chain (Admin only)
router.get('/verify', requireAuth('access'), requireRole('admin'), verifyAuditChain);

export default router;
