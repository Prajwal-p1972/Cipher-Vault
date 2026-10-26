import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';

/**
 * Storage adapter implementing S3 object storage operations via AWS SDK v3.
 * Enforces AES256 server-side encryption and supports custom endpoints (MinIO/LocalStack).
 */
export class S3Storage {
  /**
   * @param {object} [config={}]
   * @param {string} [config.bucket]
   * @param {string} [config.region]
   * @param {string} [config.endpoint]
   * @param {S3Client} [config.client]
   */
  constructor(config = {}) {
    this.bucket = config.bucket || env.S3_BUCKET;
    this.region = config.region || env.S3_REGION || 'us-east-1';
    const endpoint = config.endpoint || env.S3_ENDPOINT;

    if (!this.bucket) {
      throw new Error('S3Storage requires a valid S3_BUCKET name');
    }

    if (config.client) {
      this.client = config.client;
    } else {
      const clientConfig = {
        region: this.region
      };

      if (endpoint) {
        clientConfig.endpoint = endpoint;
        clientConfig.forcePathStyle = true;
      }

      this.client = new S3Client(clientConfig);
    }
  }

  /**
   * Uploads a buffer to S3 with AES256 server-side encryption.
   *
   * @param {string} key - S3 object key
   * @param {Buffer} buffer - Payload buffer
   * @returns {Promise<void>}
   */
  async put(key, buffer) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Storage payload must be a Buffer');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ServerSideEncryption: 'AES256'
    });

    await this.client.send(command);
  }

  /**
   * Streams an object from S3 into a memory Buffer.
   *
   * @param {string} key - S3 object key
   * @returns {Promise<Buffer|null>} Buffer or null if object not found
   */
  async get(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    try {
      const response = await this.client.send(command);
      if (!response.Body) {
        return null;
      }

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Deletes an object from S3.
   *
   * @param {string} key - S3 object key
   * @returns {Promise<boolean>} True if deleted or already absent
   */
  async delete(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    try {
      await this.client.send(command);
      return true;
    } catch (err) {
      if (
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Checks whether an object exists in S3 using HeadObject.
   *
   * @param {string} key - S3 object key
   * @returns {Promise<boolean>} True if object exists, false otherwise
   */
  async exists(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    try {
      await this.client.send(command);
      return true;
    } catch (err) {
      if (
        err.name === 'NotFound' ||
        err.name === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }
}
