import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { Document as DefaultDocument } from '../models/Document.js';
import { User as DefaultUser } from '../models/User.js';
import { audit as defaultAudit } from './auditService.js';
import { getStorage, generateStorageKey as defaultGenerateStorageKey } from './storage/index.js';
import {
  generateDocumentKey as defaultGenerateDocumentKey,
  buildAad as defaultBuildAad,
  sealBuffer as defaultSealBuffer,
  openBuffer as defaultOpenBuffer,
  wipe as defaultWipe,
  policyHash as defaultPolicyHash
} from './crypto/cryptoEngine.js';
import {
  compress as defaultCompress,
  decompress as defaultDecompress
} from './crypto/compression.js';
import { validateUpload as defaultValidateUpload } from './fileValidation.js';
import { wrapDocumentKey as defaultWrapDocumentKey } from './crypto/keyWrap.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Validates and normalizes access control policy.
 *
 * @param {object} policy
 * @returns {object} Normalized policy
 */
export function validatePolicy(policy = {}) {
  const normalized = {
    geofence: {
      lat: null,
      lng: null,
      radiusMeters: null
    },
    expiresAt: null,
    oneTimeUse: false
  };

  if (!policy || typeof policy !== 'object') {
    return normalized;
  }

  // Validate expiresAt: must be future date and <= 30 days ahead
  if (policy.expiresAt !== undefined && policy.expiresAt !== null) {
    const expDate = new Date(policy.expiresAt);
    if (Number.isNaN(expDate.getTime())) {
      throw AppError.badRequest('Invalid policy: expiresAt must be a valid ISO date');
    }
    const now = Date.now();
    if (expDate.getTime() <= now) {
      throw AppError.badRequest('Invalid policy: expiresAt must be in the future');
    }
    if (expDate.getTime() > now + THIRTY_DAYS_MS) {
      throw AppError.badRequest(
        'Invalid policy: expiresAt cannot exceed 30 days from the current time'
      );
    }
    normalized.expiresAt = expDate;
  }

  // Validate geofence: all three (lat, lng, radiusMeters) or none
  const { geofence } = policy;
  if (geofence && typeof geofence === 'object') {
    const { lat, lng, radiusMeters } = geofence;
    const hasAny = lat !== undefined || lng !== undefined || radiusMeters !== undefined;
    if (hasAny) {
      const numLat = Number(lat);
      const numLng = Number(lng);
      const numRadius = Number(radiusMeters);

      if (
        typeof lat !== 'number' && typeof lat !== 'string' ||
        Number.isNaN(numLat) ||
        numLat < -90 ||
        numLat > 90
      ) {
        throw AppError.badRequest('Invalid policy: geofence lat must be between -90 and 90');
      }

      if (
        typeof lng !== 'number' && typeof lng !== 'string' ||
        Number.isNaN(numLng) ||
        numLng < -180 ||
        numLng > 180
      ) {
        throw AppError.badRequest('Invalid policy: geofence lng must be between -180 and 180');
      }

      if (
        typeof radiusMeters !== 'number' && typeof radiusMeters !== 'string' ||
        Number.isNaN(numRadius) ||
        numRadius < 1 ||
        numRadius > 100000
      ) {
        throw AppError.badRequest(
          'Invalid policy: geofence radiusMeters must be between 1 and 100,000'
        );
      }

      normalized.geofence = {
        lat: numLat,
        lng: numLng,
        radiusMeters: numRadius
      };
    }
  }

  // Validate oneTimeUse
  normalized.oneTimeUse = Boolean(policy.oneTimeUse);

  return normalized;
}

/**
 * Strips confidential envelope keys, storage keys, and crypto internals from document records.
 *
 * @param {object} doc - Document object or Mongoose model instance
 * @returns {object} Public document metadata
 */
export function toPublicDoc(doc, forUserId = null) {
  if (!doc) return null;
  const d = typeof doc.toObject === 'function' ? doc.toObject() : doc;

  const senderId =
    d.sender && typeof d.sender === 'object' && d.sender._id
      ? d.sender._id.toString()
      : d.sender?.toString() || null;

  const receiverId =
    d.receiver && typeof d.receiver === 'object' && d.receiver._id
      ? d.receiver._id.toString()
      : d.receiver?.toString() || null;

  const hasGeofence = Boolean(
    d.policy?.geofence &&
    d.policy.geofence.lat !== null &&
    d.policy.geofence.lat !== undefined
  );

  let policyOut;
  const isSender = forUserId && senderId && String(forUserId) === String(senderId);
  const isReceiver = forUserId && receiverId && String(forUserId) === String(receiverId);

  if (isSender) {
    policyOut = d.policy;
  } else if (isReceiver) {
    // Redact geofence coordinates for the receiver
    policyOut = {
      expiresAt: d.policy?.expiresAt ?? null,
      oneTimeUse: Boolean(d.policy?.oneTimeUse),
      hasGeofence
    };
  } else {
    // Default safe policy serialization
    policyOut = d.policy;
  }

  return {
    id: d._id ? d._id.toString() : d.id,
    sender: senderId,
    receiver: receiverId,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    delivery: d.delivery || 'qr',
    status: d.status,
    policy: policyOut,
    accessCount: d.accessCount ?? 0,
    consumedAt: d.consumedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

/**
 * Builds standard dependency bundle.
 */
function resolveDependencies(customDeps = {}) {
  return {
    Document: customDeps.Document || DefaultDocument,
    User: customDeps.User || DefaultUser,
    audit: customDeps.audit || defaultAudit,
    storage: customDeps.storage || getStorage(),
    generateStorageKey: customDeps.generateStorageKey || defaultGenerateStorageKey,
    generateDocumentKey: customDeps.generateDocumentKey || defaultGenerateDocumentKey,
    buildAad: customDeps.buildAad || defaultBuildAad,
    sealBuffer: customDeps.sealBuffer || defaultSealBuffer,
    openBuffer: customDeps.openBuffer || defaultOpenBuffer,
    wipe: customDeps.wipe || defaultWipe,
    policyHash: customDeps.policyHash || defaultPolicyHash,
    compress: customDeps.compress || defaultCompress,
    decompress: customDeps.decompress || defaultDecompress,
    validateUpload: customDeps.validateUpload || defaultValidateUpload,
    wrapDocumentKey: customDeps.wrapDocumentKey || defaultWrapDocumentKey,
    ...customDeps
  };
}

/**
 * Validates, compresses, seals, stores, and registers a new document.
 * Returns the documentKey ONCE encoded as base64url when delivery is 'qr',
 * or returns { document } without documentKey when delivery is 'wrapped'.
 *
 * @param {{
 *   senderId: string,
 *   receiverEmail: string,
 *   file: { buffer: Buffer, originalName: string, declaredMime: string },
 *   policy?: object,
 *   delivery?: 'wrapped'|'qr'
 * }} params
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @param {object} [customDeps={}]
 * @returns {Promise<{ document: object, documentKey?: string }>}
 */
export async function sealDocument(params, ctx = {}, customDeps = {}) {
  const deps = resolveDependencies(customDeps);
  const { senderId, receiverEmail, file, policy, delivery } = params;
  const deliveryMode = delivery === 'wrapped' ? 'wrapped' : 'qr';

  if (!senderId) {
    throw AppError.unauthorized('Sender ID is required');
  }
  if (!receiverEmail || typeof receiverEmail !== 'string') {
    throw AppError.badRequest('Receiver email is required');
  }
  if (!file || !file.buffer) {
    throw AppError.badRequest('File upload is required');
  }

  // 1. Validate file upload allowlist, magic bytes, size limits, safeName
  let uploadValidation;
  try {
    uploadValidation = deps.validateUpload({
      buffer: file.buffer,
      originalName: file.originalName,
      declaredMime: file.declaredMime
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw AppError.badRequest(err.message);
  }
  const { mimeType, safeName } = uploadValidation;

  // 2. Resolve receiver by email
  const normalizedEmail = receiverEmail.toLowerCase().trim();
  const receiverUser = await deps.User.findOne({ email: normalizedEmail }).lean().exec();
  if (!receiverUser) {
    throw AppError.notFound('Receiver user not found');
  }

  const receiverIdStr = receiverUser._id.toString();
  const senderIdStr = senderId.toString();

  if (receiverIdStr === senderIdStr) {
    throw AppError.badRequest('Receiver cannot be the sender');
  }

  if (deliveryMode === 'wrapped') {
    if (!receiverUser.vaultKey || !receiverUser.vaultKey.publicKey || !receiverUser.vaultKey.keyId) {
      throw AppError.conflict('Receiver has not set up a vault key yet');
    }
  }

  // 3. Validate policy
  const normalizedPolicy = validatePolicy(policy);

  // 4. Create Document ID first with status 'pending'
  const pendingDocId = new mongoose.Types.ObjectId();
  const pendingDoc = new deps.Document({
    _id: pendingDocId,
    sender: senderIdStr,
    receiver: receiverIdStr,
    originalName: safeName,
    mimeType,
    sizeBytes: file.buffer.length,
    delivery: deliveryMode,
    storage: {
      provider: env.STORAGE_DRIVER || 'memory',
      key: 'pending'
    },
    crypto: {
      algorithm: 'aes-256-gcm',
      iv: 'pending',
      authTag: 'pending',
      hmac: 'pending',
      ciphertextSha256: 'pending',
      compressed: false
    },
    policy: normalizedPolicy,
    status: 'pending'
  });

  await pendingDoc.save();

  let docKey = null;
  let storedKey = null;

  try {
    // 5. Compress
    const { data: compressedData, compressed } = await deps.compress(file.buffer);

    // 6. Seal buffer with AAD binding
    docKey = deps.generateDocumentKey();
    const pHash = deps.policyHash(normalizedPolicy);

    const aadBuffer = deps.buildAad({
      docId: pendingDocId.toString(),
      senderId: senderIdStr,
      receiverId: receiverIdStr,
      mimeType,
      sizeBytes: file.buffer.length,
      policyHash: pHash
    });

    const sealed = deps.sealBuffer(compressedData, docKey, aadBuffer);

    let envelope = null;
    if (deliveryMode === 'wrapped') {
      envelope = deps.wrapDocumentKey({
        docKey,
        recipientPublicB64Url: receiverUser.vaultKey.publicKey,
        recipientKeyId: receiverUser.vaultKey.keyId,
        docId: pendingDocId.toString(),
        receiverId: receiverIdStr
      });
    }

    // 7. Store encrypted ciphertext in storage adapter
    storedKey = deps.generateStorageKey();
    await deps.storage.put(storedKey, sealed.ciphertext);

    // 8. Update Document to sealed status (including keyEnvelope in the same update)
    pendingDoc.status = 'sealed';
    pendingDoc.delivery = deliveryMode;
    if (envelope) {
      pendingDoc.keyEnvelope = envelope;
    }
    pendingDoc.storage = {
      provider: env.STORAGE_DRIVER || 'memory',
      key: storedKey
    };
    pendingDoc.crypto = {
      algorithm: sealed.algorithm,
      iv: sealed.iv.toString('base64'),
      authTag: sealed.authTag.toString('base64'),
      hmac: sealed.hmac,
      ciphertextSha256: sealed.ciphertextSha256,
      compressed
    };

    await pendingDoc.save();

    // 9. Append audit log
    await deps.audit({
      actor: senderIdStr,
      action: 'DOC_SEALED',
      resource: { kind: 'document', id: pendingDocId.toString() },
      outcome: 'success',
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: {
        receiverId: receiverIdStr,
        sizeBytes: file.buffer.length,
        mimeType,
        delivery: deliveryMode
      }
    });

    if (deliveryMode === 'wrapped') {
      deps.wipe(docKey);
      docKey = null;
      return {
        document: toPublicDoc(pendingDoc, senderId)
      };
    }

    const documentKeyB64Url = docKey.toString('base64url');

    return {
      document: toPublicDoc(pendingDoc, senderId),
      documentKey: documentKeyB64Url
    };
  } catch (err) {
    // Orphan cleanup on storage or DB failure
    if (storedKey) {
      try {
        await deps.storage.delete(storedKey);
      } catch (_) {
        // Best effort
      }
    }
    if (pendingDocId) {
      try {
        await deps.Document.findByIdAndDelete(pendingDocId).exec();
      } catch (_) {
        // Best effort
      }
    }
    throw err;
  } finally {
    if (docKey) {
      deps.wipe(docKey);
    }
  }
}

/**
 * Decrypts a document to memory buffer.
 * INTERNAL service for future access workflows; not exposed via direct HTTP routes in Phase 2.
 *
 * @param {{ documentId: string, documentKeyB64Url: string }} params
 * @param {{ userId?: string, ip?: string, userAgent?: string }} [ctx={}]
 * @param {object} [customDeps={}]
 * @returns {Promise<{ buffer: Buffer, mimeType: string, originalName: string }>}
 */
export async function openDocumentToBuffer(params, ctx = {}, customDeps = {}) {
  const deps = resolveDependencies(customDeps);
  const { documentId, documentKeyB64Url } = params;

  const doc = await deps.Document.findById(documentId).lean().exec();
  if (!doc) {
    throw AppError.notFound('Document not found');
  }

  let docKey = null;

  try {
    if (typeof documentKeyB64Url !== 'string') {
      throw new Error('Integrity check failed');
    }

    docKey = Buffer.from(documentKeyB64Url, 'base64url');
    if (docKey.length !== 32) {
      throw new Error('Integrity check failed');
    }

    const ciphertext = await deps.storage.get(doc.storage.key);
    if (!ciphertext) {
      throw new Error('Integrity check failed');
    }

    // Parse IV and authTag (supporting both hex and base64 encodings)
    const iv =
      doc.crypto.iv.length === 24
        ? Buffer.from(doc.crypto.iv, 'hex')
        : Buffer.from(doc.crypto.iv, 'base64');

    const authTag =
      doc.crypto.authTag.length === 32
        ? Buffer.from(doc.crypto.authTag, 'hex')
        : Buffer.from(doc.crypto.authTag, 'base64');

    const pHash = deps.policyHash(doc.policy);
    const aadBuffer = deps.buildAad({
      docId: doc._id.toString(),
      senderId: doc.sender.toString(),
      receiverId: doc.receiver.toString(),
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      policyHash: pHash
    });

    const sealedData = {
      ciphertext,
      iv,
      authTag,
      hmac: doc.crypto.hmac
    };

    // Constant-time HMAC verified before decryption in openBuffer
    const decryptedData = deps.openBuffer(sealedData, docKey, aadBuffer);

    let finalBuffer = decryptedData;
    if (doc.crypto.compressed) {
      finalBuffer = await deps.decompress(decryptedData);
    }

    return {
      buffer: finalBuffer,
      mimeType: doc.mimeType,
      originalName: doc.originalName
    };
  } catch (err) {
    await deps.audit({
      actor: ctx.userId ?? null,
      action: 'DOC_ACCESS_DENIED',
      resource: { kind: 'document', id: doc._id.toString() },
      outcome: 'failure',
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { reason: 'integrity' }
    });

    throw AppError.badRequest('Integrity check failed');
  } finally {
    if (docKey) {
      deps.wipe(docKey);
    }
  }
}

/**
 * Lists documents for an authenticated user by role (sender or receiver).
 *
 * @param {string} userId
 * @param {'sender'|'receiver'} role
 * @param {object} [customDeps={}]
 * @returns {Promise<Array<object>>} Public documents
 */
export async function listMyDocuments(userId, role, customDeps = {}) {
  const deps = resolveDependencies(customDeps);

  if (role !== 'sender' && role !== 'receiver') {
    throw AppError.badRequest("Role must be 'sender' or 'receiver'");
  }

  const query = role === 'sender' ? { sender: userId } : { receiver: userId };

  const docs = await deps.Document.find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
    .exec();

  return docs.map((doc) => toPublicDoc(doc, userId));
}

/**
 * Retrieves public metadata for a single document.
 * Returns 404 unless the requesting user is the sender or receiver.
 *
 * @param {string} userId
 * @param {string} documentId
 * @param {object} [customDeps={}]
 * @returns {Promise<object>} Public document metadata
 */
export async function getDocumentMeta(userId, documentId, customDeps = {}) {
  const deps = resolveDependencies(customDeps);

  const doc = await deps.Document.findById(documentId).lean().exec();
  if (!doc) {
    throw AppError.notFound('Document not found');
  }

  const senderId = doc.sender.toString();
  const receiverId = doc.receiver.toString();
  const requesterId = userId.toString();

  if (requesterId !== senderId && requesterId !== receiverId) {
    // Zero-knowledge: do not reveal document existence to unauthorized third parties
    throw AppError.notFound('Document not found');
  }

  return toPublicDoc(doc, userId);
}
