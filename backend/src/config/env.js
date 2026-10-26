import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

// Determine if running under test context
const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some((arg) => arg.includes('--test')) ||
  process.argv.some((arg) => arg.includes('--test') || arg.includes('test'));

if (isTestEnv) {
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT || '5001';
  process.env.MONGO_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cipher_vault_test';
  process.env.CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_min_32_characters_12345';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_67890';
  process.env.MFA_ENC_KEY =
    process.env.MFA_ENC_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.AUDIT_HMAC_KEY =
    process.env.AUDIT_HMAC_KEY || 'test_audit_hmac_key_min_32_characters_abcde';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  CLIENT_ORIGIN: z.string().min(1, 'CLIENT_ORIGIN is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  MFA_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'MFA_ENC_KEY must be exactly 64 hex characters (32 bytes)'),
  AUDIT_HMAC_KEY: z.string().min(32, 'AUDIT_HMAC_KEY must be at least 32 characters'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26214400),
  MAX_DECOMPRESSED_BYTES: z.coerce.number().int().positive().default(104857600),
  STORAGE_DRIVER: z.enum(['memory', 'disk', 's3']).default('memory'),
  STORAGE_DIR: z.string().default('./data/blobs'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  GEO_MAX_ACCURACY_METERS: z.coerce.number().int().positive().default(500),
  UNLOCK_MAX_PER_15MIN: z.coerce.number().int().positive().default(10)
}).superRefine((data, ctx) => {
  if (data.STORAGE_DRIVER === 's3') {
    if (!data.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'S3_BUCKET is required when STORAGE_DRIVER is s3',
        path: ['S3_BUCKET']
      });
    }
    if (!data.S3_REGION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'S3_REGION is required when STORAGE_DRIVER is s3',
        path: ['S3_REGION']
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // SECURITY REQUIREMENT: Print variable NAMES only (never values) and exit.
  const failedKeys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
  console.error(
    `[FATAL] Environment validation failed. Missing or invalid variables: ${failedKeys.join(', ')}`
  );
  process.exit(1);
}

export const env = parsed.data;
