import { Router } from 'express';
import { getUserAuditLogs, verifyAuditChain } from '../controllers/auditController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

const router = Router();

// Endpoint for users to see logs of their own documents
router.get('/me', requireAuth('access'), getUserAuditLogs);

// Admin route
router.get('/verify', requireAuth('access'), requireRole('admin'), verifyAuditChain);

export default router;
