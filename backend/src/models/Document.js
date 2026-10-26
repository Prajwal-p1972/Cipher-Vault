/**
 * ==============================================================================
 * CRITICAL ZERO-KNOWLEDGE ARCHITECTURE GUARANTEE:
 * Plaintext document data NEVER touches this collection or server storage.
 * AES document decryption keys are NEVER stored on the server (the decryption
 * key travels exclusively inside the client-sealed QR/key exchange payload).
 * The server stores purely encrypted metadata, envelope verification digests,
 * and geofenced access policies.
 * ==============================================================================
 */

import mongoose from 'mongoose';

// Schema comment: Document keys and plaintext payloads are strictly forbidden on server-side databases.
const documentSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    originalName: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true
    },
    mimeType: {
      type: String,
      required: true,
      trim: true
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0
    },
    storage: {
      provider: {
        type: String,
        default: 's3'
      },
      key: {
        type: String,
        required: true,
        trim: true
      }
    },
    crypto: {
      algorithm: {
        type: String,
        default: 'aes-256-gcm'
      },
      iv: {
        type: String,
        required: true
      },
      authTag: {
        type: String,
        required: true
      },
      hmac: {
        type: String,
        default: null
      },
      ciphertextSha256: {
        type: String,
        required: true
      },
      compressed: {
        type: Boolean,
        default: true
      }
    },
    policy: {
      geofence: {
        lat: {
          type: Number,
          min: -90,
          max: 90,
          default: null
        },
        lng: {
          type: Number,
          min: -180,
          max: 180,
          default: null
        },
        radiusMeters: {
          type: Number,
          min: 1,
          max: 100000,
          default: null
        }
      },
      expiresAt: {
        type: Date,
        default: null
      },
      oneTimeUse: {
        type: Boolean,
        default: false
      }
    },
    status: {
      type: String,
      enum: ['pending', 'sealed', 'delivered', 'consumed', 'expired', 'revoked'],
      default: 'pending'
    },
    accessCount: {
      type: Number,
      default: 0
    },
    consumedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Performance compound indexes
documentSchema.index({ receiver: 1, status: 1, createdAt: -1 });
documentSchema.index({ sender: 1, createdAt: -1 });
documentSchema.index({ 'policy.expiresAt': 1 });

export const Document = mongoose.model('Document', documentSchema);
