import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { isAllowedOrigin } from './config/cors.js';
import authRoutes from './routes/auth.js';
import auditRoutes from './routes/audit.js';
import documentRoutes from './routes/documents.js';
import analyticsRoutes from './routes/analytics.js';
import keyRoutes from './routes/keys.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();

// Security Hardening & Reverse Proxy Trust (Required for Render, Heroku, AWS ALB)
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true
  })
);

app.use(cookieParser());

// NOTE: File uploads in Phase 2 must use a streaming path, not this JSON limit.
app.use(express.json({ limit: '100kb' }));

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/keys', keyRoutes);

// Catch-all 404 & Centralized Error Handler
app.use(notFound);
app.use(errorHandler);

export default app;
