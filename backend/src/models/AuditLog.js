/**
 * AuditLog - Append-only, tamper-evident hash chain collection.
 *
 * PRODUCTION SECURITY RECOMMENDATION:
 * The MongoDB database user assigned to this application should have its role
 * configured strictly for insert and find permissions on this collection (e.g. readWrite
 * role without update/remove privileges), providing database-level defense-in-depth.
 */

import mongoose from 'mongoose';

export const AUDIT_ACTIONS = [
  'USER_REGISTER',
  'LOGIN_PASSWORD_OK',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'MFA_ENROLL_STARTED',
  'MFA_ENABLED',
  'MFA_VERIFY_OK',
  'MFA_VERIFY_FAILED',
  'TOKEN_REFRESH',
  'TOKEN_REUSE_DETECTED',
  'LOGOUT',
  'DOC_SEALED',
  'DOC_NOTIFIED',
  'DOC_ACCESS_GRANTED',
  'DOC_ACCESS_DENIED',
  'DOC_DECRYPTED',
  'DOC_REVOKED',
  'KEY_REGISTERED',
  'KEY_ROTATED'
];

const auditLogSchema = new mongoose.Schema(
  {
    seq: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS
    },
    resource: {
      kind: {
        type: String,
        required: true
      },
      id: {
        type: String,
        default: null
      }
    },
    outcome: {
      type: String,
      enum: ['success', 'failure'],
      required: true
    },
    ip: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    createdAt: {
      type: Date,
      required: true,
      immutable: true
    },
    prevHash: {
      type: String,
      required: true
    },
    hash: {
      type: String,
      required: true
    }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

// Prevent editing existing documents
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('AuditLog is append-only: existing entries cannot be modified.'));
  }
  next();
});

// Strictly block all update, replace, and delete operations
const forbidMutation = function (next) {
  next(new Error('AuditLog is append-only: update, replace, and delete operations are forbidden.'));
};

const blockedHooks = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete'
];

for (const hook of blockedHooks) {
  auditLogSchema.pre(hook, forbidMutation);
}

// Analytics compound indexes — created on startup via autoIndex.
// These support efficient range queries in analyticsService without altering
// the existing seq index or the audit chain structure in any way.
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ outcome: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
