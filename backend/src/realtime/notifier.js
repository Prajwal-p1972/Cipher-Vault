import { emitToUser as defaultEmitToUser } from './socketServer.js';
import { audit as defaultAudit } from '../services/auditService.js';
import { User as DefaultUser } from '../models/User.js';

/**
 * Emits a real-time notification to the document receiver and appends a DOC_NOTIFIED audit record.
 * Never leaks keys, storage paths, or cryptographic metadata.
 * Executes as best-effort: catches all errors so the upload process is never delayed or failed.
 *
 * @param {{
 *   document: object,
 *   senderName?: string
 * }} params
 * @param {object} [deps={}] - Injectable dependencies for unit testing
 * @returns {Promise<void>}
 */
export async function notifyDocumentSealed(
  { document, senderName },
  deps = {}
) {
  const emit = deps.emitToUser || defaultEmitToUser;
  const auditLog = deps.audit || defaultAudit;
  const UserModel = deps.User || DefaultUser;

  try {
    if (!document) {
      return;
    }

    const docId = document.id || document._id?.toString();
    const receiverId =
      document.receiver && typeof document.receiver === 'object' && document.receiver._id
        ? document.receiver._id.toString()
        : document.receiver?.toString();

    const senderId =
      document.sender && typeof document.sender === 'object' && document.sender._id
        ? document.sender._id.toString()
        : document.sender?.toString() || null;

    if (!receiverId || !docId) {
      return;
    }

    const hasGeofence = Boolean(
      document.policy?.geofence &&
      document.policy.geofence.lat !== null &&
      document.policy.geofence.lat !== undefined
    );

    let resolvedSenderName = senderName;
    if (!resolvedSenderName && senderId && UserModel && typeof UserModel.findById === 'function') {
      try {
        const u = await UserModel.findById(senderId).select('displayName').lean();
        if (u?.displayName) {
          resolvedSenderName = u.displayName;
        }
      } catch (_) {}
    }

    const payload = {
      documentId: docId,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      senderName: resolvedSenderName || 'Sender',
      createdAt: document.createdAt,
      expiresAt: document.policy?.expiresAt ?? null,
      oneTimeUse: Boolean(document.policy?.oneTimeUse),
      hasGeofence
    };

    const reachedCount = emit(receiverId, 'document:sealed', payload);

    await auditLog({
      actor: senderId,
      action: 'DOC_NOTIFIED',
      resource: { kind: 'document', id: docId },
      outcome: 'success',
      meta: { delivered: reachedCount > 0 }
    });
  } catch (err) {
    // SECURITY & RELIABILITY: Log only the safe error message, never throw or reveal sensitive data
    console.error('[Notifier Error]:', err.message);
  }
}
