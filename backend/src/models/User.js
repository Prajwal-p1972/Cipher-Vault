import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    mfa: {
      enabled: {
        type: Boolean,
        default: false
      },
      secretEnc: {
        type: String,
        select: false,
        default: null
      },
      pendingSecretEnc: {
        type: String,
        select: false,
        default: null
      },
      lastUsedStep: {
        type: Number,
        default: 0,
        select: false
      }
    },
    failedLoginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date,
      default: null
    },
    refreshTokenHashes: {
      type: [String],
      default: [],
      select: false
    },
    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

/**
 * Serializes user instance to safe public profile.
 * Strips password hash, refresh tokens, MFA secrets, and lockout internals.
 *
 * @returns {{ id: string, email: string, displayName: string, role: string, mfaEnabled: boolean }}
 */
userSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    mfaEnabled: Boolean(this.mfa?.enabled)
  };
};

export const User = mongoose.model('User', userSchema);
