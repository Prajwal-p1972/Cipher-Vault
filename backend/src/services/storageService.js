import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { s3Client } from '../config/aws.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

/**
 * Pipes a readable stream through compression and encryption, uploading to S3.
 * @param {stream.Readable} rawFileStream 
 * @param {Object} cryptoPipeline - from createEncryptionStream()
 * @returns {Promise<{ objectKey: string, authTag: Buffer }>}
 */
export async function uploadEncryptedStream(rawFileStream, cryptoPipeline) {
  const { cipher, compressor } = cryptoPipeline;
  const objectKey = crypto.randomBytes(16).toString('hex');
  
  // Secure pipe: Raw File -> Gzip -> AES-256-GCM
  const secureStream = rawFileStream.pipe(compressor).pipe(cipher);
  
  let authTag = null;
  
  cipher.on('end', () => {
    authTag = cipher.getAuthTag();
  });

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: env.AWS_S3_BUCKET_NAME,
      Key: objectKey,
      Body: secureStream,
    },
  });

  await upload.done();
  
  if (!authTag) {
    throw new Error('Encryption pipeline failed: Auth tag was not generated.');
  }

  return { objectKey, authTag };
}

/**
 * Fetches the encrypted stream from AWS S3.
 * @param {string} objectKey 
 * @returns {Promise<stream.Readable>}
 */
export async function downloadEncryptedStream(objectKey) {
  const command = new GetObjectCommand({
    Bucket: env.AWS_S3_BUCKET_NAME,
    Key: objectKey,
  });
  
  const response = await s3Client.send(command);
  return response.Body; // This is a readable stream
}
