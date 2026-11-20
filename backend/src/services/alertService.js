import mongoose from 'mongoose';
import { emitToUser as defaultEmitToUser } from '../realtime/socketServer.js';
import { audit as defaultAudit } from './auditService.js';
import { User as DefaultUser } from '../models/User.js';

/**
 * Multi-Channel Intrusion & Breach Defense Alerting Service.
 * Dispatches real-time WebSocket events, structured email security warnings,
 * and SMS breach alerts, while maintaining cryptographic HMAC audit integrity.
 *
 * @param {{
 *   doc: object,
 *   reason: string,
 *   failedAttempts: number,
 *   maxFailedAttempts: number,
 *   remainingAttempts: number,
 *   isDestroyed: boolean,
 *   userId?: string,
 *   ipAddress?: string,
 *   attemptedLat?: number,
 *   attemptedLng?: number,
 *   distanceMeters?: number
 * }} params
 * @param {object} [customDeps={}] Injectable dependencies for unit testing
 * @returns {Promise<object>} Alert dispatch status summary
 */
export async function sendBreachAlert(params, customDeps = {}) {
  const deps = {
    emitToUser: customDeps.emitToUser || defaultEmitToUser,
    audit: customDeps.audit || defaultAudit,
    User: customDeps.User || DefaultUser,
    ...customDeps
  };

  const {
    doc,
    reason,
    failedAttempts,
    maxFailedAttempts,
    remainingAttempts,
    isDestroyed,
    userId = null,
    ipAddress = 'Unknown IP',
    attemptedLat = null,
    attemptedLng = null,
    distanceMeters = null
  } = params;

  const docId = doc?._id ? doc._id.toString() : doc?.id || 'unknown';
  const docName = doc?.originalName || 'Secured Document';
  const senderId = doc?.sender?._id ? doc.sender._id.toString() : doc?.sender?.toString() || null;
  const receiverId = doc?.receiver?._id ? doc.receiver._id.toString() : doc?.receiver?.toString() || null;
  const alertPhone = doc?.alertPhone || null;

  const timestamp = new Date().toISOString();

  // 1. Audit Logging (HMAC Audit Chain)
  try {
    const auditAction = isDestroyed ? 'DOC_DESTROYED_ALERT' : 'DOC_BREACH_ALERT';
    await deps.audit({
      actor: userId || 'system',
      action: auditAction,
      resourceKind: 'Document',
      resourceId: docId,
      outcome: 'failure',
      ip: ipAddress,
      meta: {
        reason,
        failedAttempts,
        maxFailedAttempts,
        remainingAttempts: Math.max(0, remainingAttempts),
        isDestroyed,
        distanceMeters,
        storageKey: doc?.storage?.key || null,
        alertPhoneRedacted: alertPhone ? `${alertPhone.slice(0, 3)}***` : null
      }
    });
  } catch (auditErr) {
    console.error('[AlertService Audit Warning]:', auditErr.message);
  }

  // 2. Real-Time WebSocket Alerts
  const wsEvent = isDestroyed ? 'document:destroyed' : 'document:breach_alert';
  const wsPayload = {
    documentId: docId,
    originalName: docName,
    failedAttempts,
    maxFailedAttempts,
    remainingAttempts: Math.max(0, remainingAttempts),
    isDestroyed,
    reason,
    distanceMeters,
    timestamp
  };

  try {
    if (senderId) {
      deps.emitToUser(senderId, wsEvent, wsPayload);
    }
    if (receiverId && receiverId !== senderId) {
      deps.emitToUser(receiverId, wsEvent, wsPayload);
    }
  } catch (wsErr) {
    console.error('[AlertService WebSocket Warning]:', wsErr.message);
  }

  // 3. Email Alert Formulation
  let senderEmail = 'Document Owner';
  if (senderId && deps.User && typeof deps.User.findById === 'function' && mongoose.connection.readyState === 1) {
    try {
      const senderUser = await deps.User.findById(senderId).select('email displayName').lean();
      if (senderUser?.email) {
        senderEmail = senderUser.email;
      }
    } catch (_) {}
  }

  const emailSubject = isDestroyed
    ? `🚨 CRITICAL SECURITY ALERT: Document "${docName}" Crypto-Shredded & Destroyed`
    : `⚠️ SECURITY WARNING: Unauthorized Access Attempt on "${docName}" (${failedAttempts}/${maxFailedAttempts})`;

  const emailBody = `
================================================================================
CIPHER VAULT ZERO-TRUST INTRUSION DEFENSE NOTIFICATION
================================================================================
Document Name:      ${docName}
Document ID:        ${docId}
Alert Timestamp:    ${timestamp}
Source IP Address:  ${ipAddress}
Violation Reason:   ${reason}
${distanceMeters !== null && distanceMeters !== undefined ? `Perimeter Distance:  ${distanceMeters} meters (Exceeded Geofence Radius)` : ''}
Attempt Status:     ${failedAttempts} of ${maxFailedAttempts} failed attempts
Security Posture:   ${isDestroyed ? 'PERMANENTLY DESTROYED & CIPHERTEXT CRYPTO-SHREDDED' : `WARNING: ${remainingAttempts} attempts remaining before automated self-destruct`}
Recipient Contact:  ${senderEmail}
================================================================================
`.trim();

  // 4. SMS Alert Formulation
  let smsMessage = null;
  if (alertPhone) {
    smsMessage = isDestroyed
      ? `[CIPHER VAULT ALERT] Document "${docName}" was PERMANENTLY DESTROYED & CRYPTO-SHREDDED after ${failedAttempts}/${maxFailedAttempts} unauthorized attempts. Reason: ${reason}.`
      : `[CIPHER VAULT WARNING] Unauthorized access attempt detected on "${docName}". Attempt ${failedAttempts}/${maxFailedAttempts}. ${remainingAttempts} attempts before crypto-shred.`;
  }

  return {
    dispatched: true,
    isDestroyed,
    wsEvent,
    emailSubject,
    emailBody,
    smsMessage,
    alertPhone
  };
}
