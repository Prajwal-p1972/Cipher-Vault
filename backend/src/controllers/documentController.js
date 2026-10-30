import busboy from 'busboy';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { createEncryptionStream } from '../utils/cryptoStream.js';
import { uploadEncryptedStream } from '../services/storageService.js';
import { Document } from '../models/Document.js';
import { audit } from '../services/auditService.js';
import { notifyUser } from '../config/socket.js';
import {
  sealDocument,
  listMyDocuments,
  getDocumentMeta
} from '../services/documentService.js';
import { notifyDocumentSealed } from '../realtime/notifier.js';

const uploadFieldsSchema = z
  .object({
    receiverEmail: z.string().email('Valid receiverEmail is required'),
    expiresAt: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), {
        message: 'expiresAt must be a valid ISO date string'
      })
      .optional(),
    oneTimeUse: z
      .preprocess((val) => {
        if (typeof val === 'string') return val.toLowerCase() === 'true';
        return Boolean(val);
      }, z.boolean())
      .optional()
      .default(false),
    geoLat: z
      .preprocess(
        (val) => (val === '' || val === undefined ? undefined : Number(val)),
        z.number().min(-90).max(90).optional()
      ),
    geoLng: z
      .preprocess(
        (val) => (val === '' || val === undefined ? undefined : Number(val)),
        z.number().min(-180).max(180).optional()
      ),
    geoRadiusMeters: z
      .preprocess(
        (val) => (val === '' || val === undefined ? undefined : Number(val)),
        z.number().min(1).max(100000).optional()
      ),
    delivery: z.enum(['wrapped', 'qr']).optional().default('wrapped')
  })
  .superRefine((data, ctx) => {
    const geoFields = [data.geoLat, data.geoLng, data.geoRadiusMeters];
    const presentCount = geoFields.filter((f) => f !== undefined).length;
    if (presentCount > 0 && presentCount < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All three geofence fields (geoLat, geoLng, geoRadiusMeters) must be provided together'
      });
    }
  });

/**
 * Handles multipart document creation, compression, sealing, and storage.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function createDocument(req, res) {
  res.set('Cache-Control', 'no-store');

  if (!req.file || !req.file.buffer) {
    throw AppError.badRequest('File is required');
  }

  const parsed = uploadFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message
    }));
    throw AppError.badRequest('Validation failed', details);
  }

  const { receiverEmail, expiresAt, oneTimeUse, geoLat, geoLng, geoRadiusMeters, delivery } = parsed.data;

  const policy = {
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    oneTimeUse,
    geofence:
      geoLat !== undefined
        ? {
            lat: geoLat,
            lng: geoLng,
            radiusMeters: geoRadiusMeters
          }
        : null
  };

  const ctx = {
    ip: req.ip,
    userAgent: req.get('user-agent')
  };

  const result = await sealDocument(
    {
      senderId: req.auth.userId,
      receiverEmail,
      file: {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype
      },
      policy,
      delivery
    },
    ctx
  );

  // Trigger real-time notification asynchronously (best-effort, non-blocking)
  notifyDocumentSealed({
    document: result.document,
    senderName: req.user?.displayName
  }).catch((err) => {
    console.error('[Notifier Error]:', err.message);
  });

  res.status(201).json(result);
}

/**
 * Retrieves the encrypted key envelope for a wrapped document.
 * Restricts access to the intended receiver only.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getKeyEnvelope(req, res) {
  res.set('Cache-Control', 'no-store');

  const doc = await Document.findById(req.params.id).lean().exec();

  const receiverStr = doc?.receiver
    ? (doc.receiver._id ? doc.receiver._id.toString() : doc.receiver.toString())
    : null;

  if (!doc || receiverStr !== String(req.auth.userId)) {
    throw AppError.notFound('Document not found');
  }

  if (doc.delivery === 'qr' || !doc.keyEnvelope) {
    throw AppError.notFound('Document not found');
  }

  if (doc.status === 'consumed' || doc.status === 'revoked') {
    const err = new AppError('Document is no longer available', 410);
    err.code = 'consumed';
    throw err;
  }

  if (doc.status === 'expired') {
    const err = new AppError('Document has expired', 410);
    err.code = 'expired';
    throw err;
  }

  if (doc.policy?.expiresAt) {
    const expiresTime = new Date(doc.policy.expiresAt).getTime();
    if (!Number.isNaN(expiresTime) && expiresTime <= Date.now()) {
      await Document.findOneAndUpdate(
        { _id: doc._id, status: 'sealed' },
        { $set: { status: 'expired' } }
      ).exec();
      const err = new AppError('Document has expired', 410);
      err.code = 'expired';
      throw err;
    }
  }

  res.status(200).json({ envelope: doc.keyEnvelope });
}

/**
 * Lists documents sent by the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function listSent(req, res) {
  res.set('Cache-Control', 'no-store');

  const documents = await listMyDocuments(req.auth.userId, 'sender');
  res.status(200).json({ documents });
}

/**
 * Lists documents received by the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function listReceived(req, res) {
  res.set('Cache-Control', 'no-store');

  const documents = await listMyDocuments(req.auth.userId, 'receiver');
  res.status(200).json({ documents });
}

/**
 * Retrieves public metadata for a single document.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getMeta(req, res) {
  res.set('Cache-Control', 'no-store');

  const document = await getDocumentMeta(req.auth.userId, req.params.id);
  res.status(200).json({ document });
}

const openBodySchema = z
  .object({
    documentKey: z.string().min(1, 'documentKey is required'),
    code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit TOTP string'),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyMeters: z.number().positive().optional()
  })
  .superRefine((data, ctx) => {
    const geoFields = [data.lat, data.lng, data.accuracyMeters];
    const presentCount = geoFields.filter((f) => f !== undefined).length;
    if (presentCount > 0 && presentCount < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All three location parameters (lat, lng, accuracyMeters) must be provided together'
      });
    }
  });

/**
 * Handles context-gated document opening, RAM-only decryption, and streaming.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function openDocument(req, res) {
  const parsed = openBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message
    }));
    throw AppError.badRequest('Validation failed', details);
  }

  const { documentKey, code, lat, lng, accuracyMeters } = parsed.data;

  const location =
    lat !== undefined && lng !== undefined && accuracyMeters !== undefined
      ? { lat, lng, accuracyMeters }
      : null;

  const ctx = {
    ip: req.ip,
    userAgent: req.get('user-agent')
  };

  const { unlockDocument } = await import('../services/accessService.js');
  const { wipe } = await import('../services/crypto/cryptoEngine.js');
  const { getStorage } = await import('../services/storage/index.js');

  const { buffer, mimeType, originalName, oneTimeUse, storageKey } = await unlockDocument(
    {
      userId: req.auth.userId,
      documentId: req.params.id,
      documentKeyB64Url: documentKey,
      code,
      location
    },
    ctx
  );

  const allowedMimes = ['application/pdf', 'image/jpeg', 'application/zip'];
  const contentType = allowedMimes.includes(mimeType) ? mimeType : 'application/octet-stream';
  const encodedName = encodeURIComponent(originalName);

  res.set({
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    'X-Document-Name': encodedName,
    'Content-Length': buffer.length
  });

  let cleanedUp = false;
  const cleanupBuffer = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      wipe(buffer);
    }
  };

  res.on('finish', async () => {
    cleanupBuffer();
    if (oneTimeUse && storageKey) {
      try {
        await getStorage().delete(storageKey);
      } catch (_) {
        // Best effort storage deletion
      }
    }
  });

  res.on('close', () => {
    cleanupBuffer();
  });

  res.end(buffer);
}

export const uploadDocument = (req, res, next) => {
  const bb = busboy({ headers: req.headers, limits: { files: 1 } });
  
  let metadata = {};
  let fileProcessed = false;

  bb.on('field', (name, val) => {
    try {
      metadata[name] = JSON.parse(val);
    } catch {
      metadata[name] = val;
    }
  });

  bb.on('file', async (name, fileStream, info) => {
    fileProcessed = true;
    try {
      if (!metadata.receiver) {
        fileStream.resume(); // Drain stream to avoid hanging
        return next(AppError.badRequest('Receiver ID is required'));
      }

      const cryptoPipeline = createEncryptionStream();
      
      // Stream directly: HTTP Request -> Gzip -> AES-256-GCM -> AWS S3
      const { objectKey, authTag } = await uploadEncryptedStream(fileStream, cryptoPipeline);

      // Save metadata to MongoDB. The AES Key is NEVER saved.
      const doc = await Document.create({
        sender: req.user._id,
        receiver: metadata.receiver,
        originalName: info.filename,
        mimeType: info.mimeType,
        storage: { provider: 's3', key: objectKey },
        crypto: {
          algorithm: 'aes-256-gcm',
          iv: cryptoPipeline.iv.toString('base64'),
          authTag: authTag.toString('base64'),
          compressed: true
        },
        policy: metadata.policy || {},
        status: 'sealed'
      });

      await audit({
        actor: req.user._id,
        action: 'DOC_SEALED',
        resource: { kind: 'Document', id: doc._id },
        outcome: 'success',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Notify the receiver in real-time
      notifyUser(metadata.receiver, 'vault_package_received', {
        docId: doc._id,
        sender: req.user._id,
        originalName: info.filename,
        timestamp: doc.createdAt
      });

      // Return the Key and IV to the sender so they can be embedded in the QR Code
      res.status(201).json({
        docId: doc._id,
        qrPayload: {
          key: cryptoPipeline.key.toString('base64'),
          iv: cryptoPipeline.iv.toString('base64'),
          authTag: authTag.toString('base64')
        }
      });
    } catch (error) {
      next(error);
    }
  });

  bb.on('close', () => {
    if (!fileProcessed) {
      next(AppError.badRequest('No file was uploaded'));
    }
  });

  bb.on('error', (err) => {
    next(err);
  });

  req.pipe(bb);
};
