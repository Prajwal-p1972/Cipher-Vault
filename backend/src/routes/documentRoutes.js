import { Router } from 'express';
import { uploadDocument } from '../controllers/documentController.js';
import { requireAuth } from '../middleware/auth.js';
import existingDocumentsRouter from './documents.js';

const router = Router();

// Only users with a valid access token can upload documents
router.post('/upload', requireAuth('access'), uploadDocument);

// Mount existing document endpoints
router.use(existingDocumentsRouter);

export default router;
