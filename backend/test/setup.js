// Test environment setup (imported first by all tests)
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGO_URI = 'mongodb://127.0.0.1:59999/unused';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.MFA_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUDIT_HMAC_KEY = 'c'.repeat(40);
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test_access_key_id';
process.env.AWS_SECRET_ACCESS_KEY = 'test_secret_access_key';
process.env.AWS_S3_BUCKET_NAME = 'test-cipher-vault-bucket';
