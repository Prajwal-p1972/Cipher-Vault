import { Document as DefaultDocument } from '../models/Document.js';
import { getStorage } from './storage/index.js';
import { audit as defaultAudit } from './auditService.js';
import { verifyStepUp as defaultVerifyStepUp } from './authService.js';
import { openDocumentToBuffer as defaultOpenDocumentToBuffer } from './documentService.js';
import { evaluatePolicy } from './accessPolicy.js';
import { AppError } from '../utils/errors.js';
import { wipe as defaultWipe } from './crypto/cryptoEngine.js';
import { sendBreachAlert as defaultSendBreachAlert } from './alertService.js';

/**
 * Resolves dependency bundle for unlockDocument with support for unit test injection.
 */
function resolveDependencies(customDeps = {}) {
  return {
    Document: customDeps.Document || DefaultDocument,
    storage: customDeps.storage || getStorage(),
    audit: customDeps.audit || defaultAudit,
    verifyStepUp: customDeps.verifyStepUp || defaultVerifyStepUp,
    openDocumentToBuffer: customDeps.openDocumentToBuffer || defaultOpenDocumentToBuffer,
    wipe: customDeps.wipe || defaultWipe,
    clock: customDeps.clock || (() => new Date()),
    sendBreachAlert: customDeps.sendBreachAlert || defaultSendBreachAlert,
    ...customDeps
  };
}

/**
 * Records intrusion attempts, increments failed attempts counter, and triggers
 * automated crypto-shredding self-destruction once maxFailedAttempts is reached.
 *
 * @param {object} doc - Document object
 * @param {object} params - Incident details
 * @returns {Promise<{ isDestroyed: boolean, newFailedAttempts: number, maxAttempts: number, remaining: number }>}
 */
async function recordFailedAttemptAndCheckShred(doc, { reason, userId, attemptedLat, attemptedLng, distanceMeters, ctx, deps }) {
  const maxAttempts = doc?.maxFailedAttempts || 3;
  const newFailedAttempts = (doc?.failedAttempts || 0) + 1;
  const isDestroyed = newFailedAttempts >= maxAttempts;
  const remaining = Math.max(0, maxAttempts - newFailedAttempts);

  const intrusionEntry = {
    attemptedAt: new Date(),
    attemptedByUserId: userId || null,
    attemptedByEmail: ctx?.userEmail || null,
    ipAddress: ctx?.ip || null,
    reason,
    attemptedLat: attemptedLat ?? null,
    attemptedLng: attemptedLng ?? null,
    distanceMeters: distanceMeters ?? null
  };

  const updateFields = {
    $inc: { failedAttempts: 1 },
    $push: { intrusionLog: intrusionEntry }
  };

  if (isDestroyed) {
    const destructionReason = `Exceeded maximum failed access attempts (${newFailedAttempts}/${maxAttempts}) - Triggered by: ${reason}`;
    updateFields.$set = {
      status: 'destroyed',
      destroyedAt: new Date(),
      destructionReason
    };

    // Crypto-shred the ciphertext storage blob!
    try {
      if (doc?.storage?.key && deps.storage && typeof deps.storage.delete === 'function') {
        await deps.storage.delete(doc.storage.key);
      }
    } catch (storageErr) {
      console.error('[Storage Shred Warning]:', storageErr.message);
    }
  }

  // Persist to database
  try {
    if (doc?._id && deps.Document && typeof deps.Document.findOneAndUpdate === 'function') {
      const updateQuery = deps.Document.findOneAndUpdate({ _id: doc._id }, updateFields, { new: true });
      if (updateQuery && typeof updateQuery.exec === 'function') {
        await updateQuery.exec();
      } else {
        await updateQuery;
      }
    }
  } catch (dbErr) {
    console.error('[Document Failed Attempt Update Warning]:', dbErr.message);
  }

  // Multi-Channel Alert Dispatch
  try {
    if (typeof deps.sendBreachAlert === 'function') {
      await deps.sendBreachAlert(
        {
          doc,
          reason,
          failedAttempts: newFailedAttempts,
          maxFailedAttempts: maxAttempts,
          remainingAttempts: remaining,
          isDestroyed,
          userId,
          ipAddress: ctx?.ip,
          attemptedLat,
          attemptedLng,
          distanceMeters
        },
        deps
      );
    }
  } catch (alertErr) {
    console.error('[Alert Dispatch Warning]:', alertErr.message);
  }

  return { isDestroyed, newFailedAttempts, maxAttempts, remaining };
}

/**
 * Maps policy evaluation denial codes to safe, generic user-facing messages.
 * Never reveals geofence centers, target coordinates, radii, or exact distances.
 *
 * @param {string} code
 * @returns {string}
 */
function getPolicyErrorMessage(code) {
  switch (code) {
    case 'destroyed':
      return 'This document was permanently destroyed and crypto-shredded following repeated unauthorized access attempts.';
    case 'consumed':
      return 'Document is no longer available';
    case 'expired':
      return 'Document has expired';
    case 'location_required':
      return 'Geographic location is required to open this document';
    case 'location_imprecise':
      return 'Location accuracy is insufficient';
    case 'outside_area':
      return 'Access denied: outside allowed geographic area';
    default:
      return 'Access denied by security policy';
  }
}

/**
 * Context-gated document unlocking service.
 * Enforces MFA step-up authentication, policy validation, RAM-only decryption,
 * and atomic claim state transition in a strict, tamper-evident sequence.
 *
 * @param {{
 *   userId: string,
 *   documentId: string,
 *   documentKeyB64Url: string,
 *   code: string,
 *   location?: { lat: number, lng: number, accuracyMeters: number }|null
 * }} params
 * @param {{ ip?: string, userAgent?: string, userEmail?: string }} [ctx={}]
 * @param {object} [customDeps={}]
 * @returns {Promise<{
 *   buffer: Buffer,
 *   mimeType: string,
 *   originalName: string,
 *   oneTimeUse: boolean,
 *   storageKey: string
 * }>}
 */
export async function unlockDocument(params, ctx = {}, customDeps = {}) {
  const deps = resolveDependencies(customDeps);
  const { userId, documentId, documentKeyB64Url, code, location } = params;

  // 1) Load document and verify recipient identity
  let doc = null;
  if (documentId) {
    try {
      doc = await deps.Document.findById(documentId).lean().exec();
    } catch (_) {
      // Invalid ObjectId syntax -> treat as document not found
      doc = null;
    }
  }

  const receiverStr = doc?.receiver
    ? (doc.receiver._id ? doc.receiver._id.toString() : doc.receiver.toString())
    : null;

  if (!doc || receiverStr !== String(userId)) {
    await deps.audit({
      actor: userId,
      action: 'DOC_ACCESS_DENIED',
      resourceKind: 'Document',
      resourceId: documentId ? String(documentId) : null,
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: { reason: 'not_receiver' }
    });
    throw AppError.notFound('Document not found');
  }

  // Upfront check: If document was already destroyed, reject immediately with 410
  if (doc.status === 'destroyed') {
    const err = new AppError(
      'This document was permanently destroyed and crypto-shredded following repeated unauthorized access attempts.',
      410
    );
    err.code = 'destroyed';
    throw err;
  }

  // 2) Validate document encryption key format: base64url decoding to exactly 32 bytes
  if (
    typeof documentKeyB64Url !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(documentKeyB64Url)
  ) {
    throw AppError.badRequest('Invalid document key format');
  }

  let rawKey;
  try {
    rawKey = Buffer.from(documentKeyB64Url, 'base64url');
  } catch (_) {
    throw AppError.badRequest('Invalid document key format');
  }

  if (rawKey.length !== 32) {
    throw AppError.badRequest('Invalid document key format');
  }

  // 3) MFA step-up verification (MFA runs BEFORE policy check to prevent unauthorized geofence probing)
  try {
    await deps.verifyStepUp(userId, code, ctx);
  } catch (mfaErr) {
    const breach = await recordFailedAttemptAndCheckShred(doc, {
      reason: 'mfa_failure',
      userId,
      attemptedLat: location?.lat,
      attemptedLng: location?.lng,
      ctx,
      deps
    });

    if (breach.isDestroyed) {
      const destroyedErr = new AppError(
        'This document has been permanently destroyed and crypto-shredded after exceeding maximum failed access attempts.',
        403
      );
      destroyedErr.code = 'document_destroyed';
      throw destroyedErr;
    }

    throw mfaErr;
  }

  // 4) Evaluate access policy (consumed, expired, geofence required/imprecise/outside)
  const now = deps.clock();
  const policyResult = evaluatePolicy({ doc, now, location });

  if (!policyResult.allowed) {
    const denialMeta = { code: policyResult.code };
    if (policyResult.distanceMeters !== undefined) {
      denialMeta.distanceMeters = policyResult.distanceMeters;
    }

    await deps.audit({
      actor: userId,
      action: 'DOC_ACCESS_DENIED',
      resourceKind: 'Document',
      resourceId: doc._id.toString(),
      outcome: 'failure',
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      meta: denialMeta
    });

    if (policyResult.code === 'expired') {
      // Lazily mark expired with atomic filter on sealed
      const expQuery = deps.Document.findOneAndUpdate(
        { _id: doc._id, status: 'sealed' },
        { $set: { status: 'expired' } }
      );
      if (expQuery && typeof expQuery.exec === 'function') {
        await expQuery.exec();
      } else {
        await expQuery;
      }
    } else if (policyResult.code !== 'consumed' && policyResult.code !== 'destroyed') {
      // Geofence violations trigger intrusion defense tracking
      const breach = await recordFailedAttemptAndCheckShred(doc, {
        reason: policyResult.code,
        userId,
        attemptedLat: location?.lat,
        attemptedLng: location?.lng,
        distanceMeters: policyResult.distanceMeters,
        ctx,
        deps
      });

      if (breach.isDestroyed) {
        const destroyedErr = new AppError(
          'This document has been permanently destroyed and crypto-shredded after exceeding maximum failed access attempts.',
          403
        );
        destroyedErr.code = 'document_destroyed';
        throw destroyedErr;
      }
    }

    const err = new AppError(getPolicyErrorMessage(policyResult.code), policyResult.status || 403);
    err.code = policyResult.code;
    throw err;
  }

  // 5) Decrypt document into memory buffer (HMAC verified before decryption in cryptoEngine)
  let openResult;
  try {
    openResult = await deps.openDocumentToBuffer(
      { documentId: doc._id.toString(), documentKeyB64Url },
      ctx,
      deps
    );
  } catch (_) {
    const breach = await recordFailedAttemptAndCheckShred(doc, {
      reason: 'integrity_failure',
      userId,
      attemptedLat: location?.lat,
      attemptedLng: location?.lng,
      ctx,
      deps
    });

    if (breach.isDestroyed) {
      const destroyedErr = new AppError(
        'This document has been permanently destroyed and crypto-shredded after exceeding maximum failed access attempts.',
        403
      );
      destroyedErr.code = 'document_destroyed';
      throw destroyedErr;
    }

    const integrityErr = new AppError('Integrity check failed', 403);
    integrityErr.code = 'integrity';
    throw integrityErr;
  }

  // 6) Atomic claim AFTER successful decryption
  const claimFilter = {
    _id: doc._id,
    receiver: userId,
    status: 'sealed'
  };

  if (doc.policy?.expiresAt) {
    claimFilter['policy.expiresAt'] = { $gt: now };
  } else {
    claimFilter.$or = [
      { 'policy.expiresAt': null },
      { 'policy.expiresAt': { $exists: false } },
      { 'policy.expiresAt': { $gt: now } }
    ];
  }

  const update = {
    $inc: { accessCount: 1 }
  };

  if (doc.policy?.oneTimeUse) {
    update.$set = {
      status: 'consumed',
      consumedAt: now
    };
  }

  const claimQuery = deps.Document.findOneAndUpdate(claimFilter, update, { new: true });
  const claimed = claimQuery && typeof claimQuery.exec === 'function'
    ? await claimQuery.exec()
    : await claimQuery;
  if (!claimed) {
    deps.wipe(openResult.buffer);
    const err = new AppError('Document has already been consumed or is no longer available', 410);
    err.code = 'consumed';
    throw err;
  }

  // 7) Audit DOC_ACCESS_GRANTED and DOC_DECRYPTED (Never log keys or coordinates)
  const isGeofenced = Boolean(
    doc.policy?.geofence &&
    doc.policy.geofence.lat !== null &&
    doc.policy.geofence.lat !== undefined
  );

  const grantedMeta = {
    oneTimeUse: Boolean(doc.policy?.oneTimeUse),
    geofenced: isGeofenced
  };
  if (policyResult.distanceMeters !== undefined) {
    grantedMeta.distanceMeters = policyResult.distanceMeters;
  }

  await deps.audit({
    actor: userId,
    action: 'DOC_ACCESS_GRANTED',
    resourceKind: 'Document',
    resourceId: doc._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    meta: grantedMeta
  });

  await deps.audit({
    actor: userId,
    action: 'DOC_DECRYPTED',
    resourceKind: 'Document',
    resourceId: doc._id.toString(),
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    meta: { bytes: openResult.buffer.length }
  });

  // 8) Return plaintext buffer and metadata
  return {
    buffer: openResult.buffer,
    mimeType: openResult.mimeType,
    originalName: openResult.originalName,
    oneTimeUse: Boolean(doc.policy?.oneTimeUse),
    storageKey: doc.storage.key
  };
}
