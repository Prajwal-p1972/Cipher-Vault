import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './src/config/env.js';
import authRoutes from './src/routes/authRoutes.js';
import auditRoutes from './src/routes/auditRoutes.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import { AppError } from './src/utils/errors.js';

const app = express();

// Security Hardening
app.disable('x-powered-by');
app.use(helmet());

// CORS configuration restricted to authorized client origin
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// Body and Cookie Parsers
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);

// Catch-all 404 Handler
app.use((req, res, next) => {
  next(AppError.notFound(`Cannot ${req.method} ${req.originalUrl}`));
});

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;
