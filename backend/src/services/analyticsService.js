/**
 * Analytics service — read-only aggregate queries over AuditLog and Document collections.
 *
 * PRIVACY MODEL:
 *   - Normal users: own activity only (actor = userId).
 *   - Admins: system-wide AGGREGATES only — never individual events, emails, IPs, or user agents.
 *   - Responses NEVER include: ip, userAgent, meta, hash, prevHash, storage, iv, authTag,
 *     hmac, lat, lng, passwordHash, refreshTokenHashes, secretEnc.
 */

import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';
import { Document } from '../models/Document.js';
import { User } from '../models/User.js';
import { verifyChain } from './auditService.js';

// ─── constants ────────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_EVENTS_LIMIT = 100;
const CHAIN_CACHE_TTL_MS = 60_000;

/**
 * Known DOC_ACCESS_DENIED reason codes that are safe to expose in analytics.
 * Any meta.code not in this set is collapsed to 'OTHER'.
 */
const ALLOWED_DENIAL_CODES = new Set([
  'EXPIRED',
  'REVOKED',
  'MFA_REQUIRED',
  'GEO_DENIED',
  'GEO_ACCURACY',
  'ONE_TIME_USED',
  'WRONG_KEY',
  'WRONG_CODE',
  'NOT_RECEIVER',
  'OTHER'
]);

// ─── chain-health cache ────────────────────────────────────────────────────────

let _chainCache = null; // { result, expiresAt }

// ─── date range helpers ────────────────────────────────────────────────────────

/**
 * Validate and normalise `from`/`to` query params.
 * Default: last DEFAULT_DAYS days.  Max span: MAX_DAYS days.
 *
 * @param {{ from?: string, to?: string }} opts
 * @returns {{ fromDate: Date, toDate: Date }}
 */
function resolveDateRange({ from, to } = {}) {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - DEFAULT_DAYS * 86_400_000);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw Object.assign(new Error('Invalid date format'), { statusCode: 400 });
  }
  if (fromDate > toDate) {
    throw Object.assign(new Error('from must not be after to'), { statusCode: 400 });
  }
  const spanDays = (toDate - fromDate) / 86_400_000;
  if (spanDays > MAX_DAYS) {
    throw Object.assign(new Error(`Date range cannot exceed ${MAX_DAYS} days`), {
      statusCode: 400
    });
  }
  return { fromDate, toDate };
}

/**
 * Generate all UTC day strings (YYYY-MM-DD) between two dates inclusive.
 *
 * @param {Date} from
 * @param {Date} to
 * @returns {string[]}
 */
function allDays(from, to) {
  const days = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * UTC day-bucket $group stage for aggregation pipelines.
 */
const DAY_GROUP_ID = {
  $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' }
};

// ─── per-day zero-fill utility ────────────────────────────────────────────────

/**
 * Zero-fill an aggregation result indexed by date so charts have continuous axes.
 *
 * @param {Date} fromDate
 * @param {Date} toDate
 * @param {Array<{ date: string, success: number, failure: number }>} rows
 * @returns {Array<{ date: string, success: number, failure: number }>}
 */
function fillDays(fromDate, toDate, rows) {
  const map = Object.fromEntries(rows.map((r) => [r.date, r]));
  return allDays(fromDate, toDate).map((d) => map[d] ?? { date: d, success: 0, failure: 0 });
}

// ─── getMyOverview ────────────────────────────────────────────────────────────

/**
 * Returns an overview of a single user's own audit activity.
 *
 * @param {string} userId - MongoDB ObjectId string of the authenticated user.
 * @param {{ from?: string, to?: string }} opts
 * @param {{ auditAggregate?: Function, docAggregate?: Function }} [deps] - Injectable for tests.
 * @returns {Promise<object>}
 */
export async function getMyOverview(userId, { from, to } = {}, deps = {}) {
  const { fromDate, toDate } = resolveDateRange({ from, to });
  const auditAggregate = deps.auditAggregate ?? ((p) => AuditLog.aggregate(p).exec());
  const docAggregate = deps.docAggregate ?? ((p) => Document.aggregate(p).exec());

  const userOid = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : null;
  const userMatch = userOid ? { $in: [userOid, String(userId)] } : userId;

  const matchMyRange = {
    $match: {
      actor: userMatch,
      createdAt: { $gte: fromDate, $lte: toDate }
    }
  };

  // ── totals ──
  const [totalsRaw] = await auditAggregate([
    matchMyRange,
    {
      $group: {
        _id: null,
        events: { $sum: 1 },
        failures: { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
        documentsSent: {
          $sum: { $cond: [{ $eq: ['$action', 'DOC_SEALED'] }, 1, 0] }
        },
        documentsReceived: {
          $sum: { $cond: [{ $eq: ['$action', 'DOC_ACCESS_GRANTED'] }, 1, 0] }
        }
      }
    }
  ]);

  const totals = totalsRaw
    ? {
        events: totalsRaw.events,
        failures: totalsRaw.failures,
        documentsSent: totalsRaw.documentsSent,
        documentsReceived: totalsRaw.documentsReceived
      }
    : { events: 0, failures: 0, documentsSent: 0, documentsReceived: 0 };

  // ── activityByDay ──
  const dayRows = await auditAggregate([
    matchMyRange,
    {
      $group: {
        _id: { date: DAY_GROUP_ID, outcome: '$outcome' },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);

  const dayMap = {};
  for (const row of dayRows) {
    const d = row._id.date;
    if (!dayMap[d]) dayMap[d] = { date: d, success: 0, failure: 0 };
    if (row._id.outcome === 'success') dayMap[d].success = row.count;
    else dayMap[d].failure = row.count;
  }
  const activityByDay = fillDays(fromDate, toDate, Object.values(dayMap));

  // ── actionBreakdown ──
  const actionRows = await auditAggregate([
    matchMyRange,
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, action: '$_id', count: 1 } }
  ]);

  // ── documentStatus (docs sent by this user) ──
  const docStatusRaw = await docAggregate([
    { $match: { sender: userMatch } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const docStatus = { sealed: 0, consumed: 0, expired: 0, revoked: 0 };
  for (const r of docStatusRaw) {
    if (r._id in docStatus) docStatus[r._id] = r.count;
  }

  // ── deniedByReason (DOC_ACCESS_DENIED, meta.code only, whitelisted) ──
  const deniedRaw = await auditAggregate([
    {
      $match: {
        actor: userMatch,
        action: 'DOC_ACCESS_DENIED',
        createdAt: { $gte: fromDate, $lte: toDate }
      }
    },
    {
      $group: {
        _id: '$meta.code',
        count: { $sum: 1 }
      }
    }
  ]);

  const deniedMap = {};
  for (const r of deniedRaw) {
    const raw = typeof r._id === 'string' ? r._id.toUpperCase() : 'OTHER';
    const code = ALLOWED_DENIAL_CODES.has(raw) ? raw : 'OTHER';
    deniedMap[code] = (deniedMap[code] ?? 0) + r.count;
  }
  const deniedByReason = Object.entries(deniedMap)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totals,
    activityByDay,
    actionBreakdown: actionRows,
    documentStatus: docStatus,
    deniedByReason
  };
}

// ─── getMyEvents ─────────────────────────────────────────────────────────────

/**
 * Returns paginated audit events for a single user's own activity (newest first).
 * Never includes meta, ip, userAgent, hashes or storage keys.
 *
 * @param {string} userId
 * @param {{ limit?: number, cursor?: number }} opts  cursor = seq of last seen item
 * @param {{ auditFind?: Function }} [deps]
 * @returns {Promise<{ events: Array, nextCursor: number|null }>}
 */
export async function getMyEvents(userId, { limit = 50, cursor } = {}, deps = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), MAX_EVENTS_LIMIT);
  const auditFind = deps.auditFind ?? ((q, proj, opts) =>
    AuditLog.find(q, proj, opts).lean().exec()
  );

  const userOid = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : null;
  const userMatch = userOid ? { $in: [userOid, String(userId)] } : userId;

  const query = { actor: userMatch };
  if (cursor != null) {
    query.seq = { $lt: Number(cursor) };
  }

  const projection = {
    _id: 0,
    seq: 1,
    action: 1,
    outcome: 1,
    createdAt: 1,
    'resource.kind': 1,
    'resource.id': 1
  };

  const docs = await auditFind(query, projection, {
    sort: { seq: -1 },
    limit: safeLimit + 1
  });

  const hasMore = docs.length > safeLimit;
  const page = hasMore ? docs.slice(0, safeLimit) : docs;

  const events = page.map((d) => ({
    seq: d.seq,
    action: d.action,
    outcome: d.outcome,
    createdAt: d.createdAt,
    resourceKind: d.resource?.kind ?? null,
    resourceId: d.resource?.id ?? null
  }));

  return {
    events,
    nextCursor: hasMore ? page[page.length - 1].seq : null
  };
}

// ─── getSystemOverview ────────────────────────────────────────────────────────

/**
 * System-wide aggregate overview for admins.
 * Returns ONLY counts and distributions — never individual user data.
 *
 * @param {{ from?: string, to?: string }} opts
 * @param {{ auditAggregate?: Function, docAggregate?: Function, userCount?: Function }} [deps]
 * @returns {Promise<object>}
 */
export async function getSystemOverview({ from, to } = {}, deps = {}) {
  const { fromDate, toDate } = resolveDateRange({ from, to });
  const auditAggregate = deps.auditAggregate ?? ((p) => AuditLog.aggregate(p).exec());
  const docAggregate = deps.docAggregate ?? ((p) => Document.aggregate(p).exec());
  const userCount = deps.userCount ?? (() => User.countDocuments().exec());

  const matchRange = {
    $match: { createdAt: { $gte: fromDate, $lte: toDate } }
  };

  // ── system totals ──
  const [totalsRaw] = await auditAggregate([
    matchRange,
    {
      $group: {
        _id: null,
        events: { $sum: 1 },
        failures: { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } }
      }
    }
  ]);

  const [docTotalsRaw] = await docAggregate([
    { $group: { _id: null, documents: { $sum: 1 } } }
  ]);

  const users = await userCount();

  const totals = {
    users,
    documents: docTotalsRaw?.documents ?? 0,
    events: totalsRaw?.events ?? 0,
    failures: totalsRaw?.failures ?? 0
  };

  // ── activityByDay ──
  const dayRows = await auditAggregate([
    matchRange,
    {
      $group: {
        _id: { date: DAY_GROUP_ID, outcome: '$outcome' },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);

  const dayMap = {};
  for (const row of dayRows) {
    const d = row._id.date;
    if (!dayMap[d]) dayMap[d] = { date: d, success: 0, failure: 0 };
    if (row._id.outcome === 'success') dayMap[d].success = row.count;
    else dayMap[d].failure = row.count;
  }
  const activityByDay = fillDays(fromDate, toDate, Object.values(dayMap));

  // ── actionBreakdown ──
  const actionRows = await auditAggregate([
    matchRange,
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, action: '$_id', count: 1 } }
  ]);

  // ── failuresByAction ──
  const failureRows = await auditAggregate([
    { $match: { outcome: 'failure', createdAt: { $gte: fromDate, $lte: toDate } } },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, action: '$_id', count: 1 } }
  ]);

  // ── lockouts (count only) ──
  const [lockoutsRaw] = await auditAggregate([
    { $match: { action: 'ACCOUNT_LOCKED', createdAt: { $gte: fromDate, $lte: toDate } } },
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);

  // ── token reuse (count only) ──
  const [tokenReuseRaw] = await auditAggregate([
    {
      $match: { action: 'TOKEN_REUSE_DETECTED', createdAt: { $gte: fromDate, $lte: toDate } }
    },
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);

  // ── documentStatus (system-wide) ──
  const docStatusRaw = await docAggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const documentStatus = { sealed: 0, consumed: 0, expired: 0, revoked: 0 };
  for (const r of docStatusRaw) {
    if (r._id in documentStatus) documentStatus[r._id] = r.count;
  }

  return {
    totals,
    activityByDay,
    actionBreakdown: actionRows,
    failuresByAction: failureRows,
    lockouts: { count: lockoutsRaw?.count ?? 0 },
    tokenReuse: { count: tokenReuseRaw?.count ?? 0 },
    documentStatus
  };
}

// ─── getChainHealth ───────────────────────────────────────────────────────────

/**
 * Wraps verifyChain() with a 60-second in-memory cache.
 * Prevents using this endpoint to hammer the database.
 *
 * @param {{ verifyFn?: Function }} [deps]
 * @returns {Promise<{ valid: boolean, checked: number, brokenAtSeq?: number, checkedAt: string, cached: boolean }>}
 */
export async function getChainHealth(deps = {}) {
  const now = Date.now();
  if (_chainCache && now < _chainCache.expiresAt) {
    return { ..._chainCache.result, cached: true };
  }

  const verifyFn = deps.verifyFn ?? verifyChain;
  const raw = await verifyFn();

  const result = {
    valid: raw.valid,
    checked: raw.checked,
    checkedAt: new Date().toISOString(),
    cached: false
  };
  if (!raw.valid && raw.brokenAtSeq != null) {
    result.brokenAtSeq = raw.brokenAtSeq;
  }

  _chainCache = { result, expiresAt: now + CHAIN_CACHE_TTL_MS };
  return result;
}

/**
 * Invalidates the chain-health cache. Exposed for tests only.
 */
export function _invalidateChainCache() {
  _chainCache = null;
}
