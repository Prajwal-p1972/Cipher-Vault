/**
 * Analytics controller — HTTP layer for /api/analytics.
 * All responses set Cache-Control: no-store.
 * Responses never include: ip, userAgent, meta, hash, prevHash, storage, iv, authTag, hmac, lat, lng.
 */

import { z } from 'zod';
import {
  getMyOverview,
  getMyEvents,
  getSystemOverview,
  getChainHealth
} from '../services/analyticsService.js';
import { AppError } from '../utils/errors.js';

// ─── validation schemas ────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/, 'Must be an ISO date string')
  .optional();

const rangeSchema = z.object({
  from: isoDate,
  to: isoDate
});

const myEventsSchema = z.object({
  from: isoDate,
  to: isoDate,
  limit: z
    .string()
    .optional()
    .transform((v) => (v != null ? Number(v) : 50))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z
    .string()
    .optional()
    .transform((v) => (v != null ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional())
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function handleServiceError(err, next) {
  if (err.statusCode === 400) {
    return next(AppError.badRequest(err.message));
  }
  next(err);
}

// ─── handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /api/analytics/me/overview
 * Returns authenticated user's own overview.
 */
export async function myOverview(req, res, next) {
  try {
    noStore(res);
    const { from, to } = rangeSchema.parse(req.query);
    const result = await getMyOverview(req.auth.userId, { from, to });
    res.json(result);
  } catch (err) {
    handleServiceError(err, next);
  }
}

/**
 * GET /api/analytics/me/events
 * Returns paginated list of authenticated user's own events.
 */
export async function myEvents(req, res, next) {
  try {
    noStore(res);
    const { limit, cursor } = myEventsSchema.parse(req.query);
    const result = await getMyEvents(req.auth.userId, { limit, cursor });
    res.json(result);
  } catch (err) {
    handleServiceError(err, next);
  }
}

/**
 * GET /api/analytics/system/overview
 * Admin-only: system-wide aggregates (no per-user data).
 */
export async function systemOverview(req, res, next) {
  try {
    noStore(res);
    const { from, to } = rangeSchema.parse(req.query);
    const result = await getSystemOverview({ from, to });
    res.json(result);
  } catch (err) {
    handleServiceError(err, next);
  }
}

/**
 * GET /api/analytics/system/chain
 * Admin-only: chain integrity health check (cached 60s).
 */
export async function systemChain(req, res, next) {
  try {
    noStore(res);
    const result = await getChainHealth();
    res.json(result);
  } catch (err) {
    next(err);
  }
}
