import { User as DefaultUser } from '../models/User.js';
import { audit as defaultAudit } from './auditService.js';
import { verifyStepUp as defaultVerifyStepUp } from './authService.js';
import {
  validatePublicKey as defaultValidatePublicKey,
  computeKeyId as defaultComputeKeyId,
  fingerprintOf as defaultFingerprintOf
} from './crypto/keyWrap.js';
import { AppError } from '../utils/errors.js';

function resolveDeps(custom = {}) {
  return {
    User: custom.User || DefaultUser,
    audit: custom.audit || defaultAudit,
    verifyStepUp: custom.verifyStepUp || defaultVerifyStepUp,
    validatePublicKey: custom.validatePublicKey || defaultValidatePublicKey,
    computeKeyId: custom.computeKeyId || defaultComputeKeyId,
    fingerprintOf: custom.fingerprintOf || defaultFingerprintOf,
    clock: custom.clock || (() => new Date())
  };
}

/**
 * Registers or rotates a user's ECDH P-256 vault public key.
 * Enforces TOTP step-up authentication prior to public key parsing and storage.
 * Audits KEY_REGISTERED on initial setup, or KEY_ROTATED on subsequent setups.
 *
 * @param {{ userId: string, publicKey: string, code: string }} params
 * @param {{ ip?: string, userAgent?: string }} [ctx={}]
 * @param {object} [customDeps={}]
 * @returns {Promise<{ keyId: string, fingerprint: string, registeredAt: Date }>}
 */
export async function registerVaultKey(params, ctx = {}, customDeps = {}) {
  const deps = resolveDeps(customDeps);
  const { userId, publicKey, code } = params;

  // 1) Enforce TOTP step-up authentication FIRST to prevent unauthorized key substitution
  await deps.verifyStepUp(userId, code, ctx);

  // 2) Validate public key curve geometry and format
  const rawPubBuf = deps.validatePublicKey(publicKey);

  // 3) Derive key ID and fingerprint
  const keyId = deps.computeKeyId(rawPubBuf);
  const fingerprint = deps.fingerprintOf(keyId);

  // 4) Check user record to detect rotation vs initial registration
  const user = await deps.User.findById(userId).exec();
  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  const isRotation = Boolean(user.vaultKey?.keyId);
  const registeredAt = deps.clock();

  user.vaultKey = {
    publicKey,
    keyId,
    registeredAt
  };
  await user.save();

  // 5) Tamper-evident audit logging (never logs raw public key bytes, only keyId)
  await deps.audit({
    actor: user._id,
    action: isRotation ? 'KEY_ROTATED' : 'KEY_REGISTERED',
    resource: { kind: 'User', id: user._id.toString() },
    outcome: 'success',
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    meta: { keyId }
  });

  return {
    keyId,
    fingerprint,
    registeredAt
  };
}

/**
 * Retrieves the authenticated user's registered vault key status.
 *
 * @param {string} userId
 * @param {object} [customDeps={}]
 * @returns {Promise<{ registered: boolean, keyId?: string, fingerprint?: string }>}
 */
export async function getMyVaultKey(userId, customDeps = {}) {
  const deps = resolveDeps(customDeps);
  const user = await deps.User.findById(userId).lean().exec();
  if (!user) {
    throw AppError.unauthorized('User not found');
  }

  if (!user.vaultKey?.keyId) {
    return { registered: false };
  }

  return {
    registered: true,
    keyId: user.vaultKey.keyId,
    fingerprint: deps.fingerprintOf(user.vaultKey.keyId)
  };
}

/**
 * Retrieves a receiver's vault key registration status and fingerprint by email.
 * Returns 404 for missing recipient or uninitialized vault keys to prevent account enumeration.
 *
 * @param {string} email
 * @param {object} [customDeps={}]
 * @returns {Promise<{ registered: true, fingerprint: string }>}
 */
export async function getReceiverVaultKey(email, customDeps = {}) {
  const deps = resolveDeps(customDeps);
  const normalized = typeof email === 'string' ? email.toLowerCase().trim() : '';

  const user = await deps.User.findOne({ email: normalized }).lean().exec();
  if (!user || !user.vaultKey?.keyId) {
    throw AppError.notFound('Receiver not found or has no vault key');
  }

  return {
    registered: true,
    fingerprint: deps.fingerprintOf(user.vaultKey.keyId)
  };
}
