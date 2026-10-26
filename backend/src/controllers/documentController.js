import { z } from 'zod';
import { AppError } from '../utils/errors.js';
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
      )
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

  const { receiverEmail, expiresAt, oneTimeUse, geoLat, geoLng, geoRadiusMeters } = parsed.data;

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
      policy
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
