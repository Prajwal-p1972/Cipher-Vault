import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import {
  validateUpload,
  detectMimeType,
  sanitizeFileName
} from '../src/services/fileValidation.js';

describe('File Validation Tests', () => {
  const pdfHeader = Buffer.from('%PDF-1.7\n%sample data for testing');
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const zipHeaderStandard = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const zipHeaderEmpty = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);

  it('accepts valid PDF, JPEG, and ZIP uploads', () => {
    // PDF
    const pdfRes = validateUpload({
      buffer: pdfHeader,
      originalName: 'contract.pdf',
      declaredMime: 'application/pdf'
    });
    assert.strictEqual(pdfRes.mimeType, 'application/pdf');
    assert.strictEqual(pdfRes.safeName, 'contract.pdf');

    // JPEG
    const jpegRes = validateUpload({
      buffer: jpegHeader,
      originalName: 'photo.jpg',
      declaredMime: 'image/jpeg'
    });
    assert.strictEqual(jpegRes.mimeType, 'image/jpeg');
    assert.strictEqual(jpegRes.safeName, 'photo.jpg');

    // Standard ZIP
    const zipRes = validateUpload({
      buffer: zipHeaderStandard,
      originalName: 'archive.zip',
      declaredMime: 'application/zip'
    });
    assert.strictEqual(zipRes.mimeType, 'application/zip');
    assert.strictEqual(zipRes.safeName, 'archive.zip');

    // Empty ZIP
    const zipEmptyRes = validateUpload({
      buffer: zipHeaderEmpty,
      originalName: 'empty_bundle.zip',
      declaredMime: 'application/zip'
    });
    assert.strictEqual(zipEmptyRes.mimeType, 'application/zip');
    assert.strictEqual(zipEmptyRes.safeName, 'empty_bundle.zip');
  });

  it('rejects renamed executable (.exe) masquerading as PDF', () => {
    // Windows PE executable magic: "MZ"
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    assert.throws(
      () =>
        validateUpload({
          buffer: exeBuffer,
          originalName: 'malware.pdf',
          declaredMime: 'application/pdf'
        }),
      /unsupported file type or invalid magic bytes/i
    );
  });

  it('rejects uploads when declared MIME and magic bytes disagree', () => {
    // PDF buffer declared as image/jpeg
    assert.throws(
      () =>
        validateUpload({
          buffer: pdfHeader,
          originalName: 'contract.pdf',
          declaredMime: 'image/jpeg'
        }),
      /declared MIME type .* does not match/i
    );

    // JPEG buffer declared as application/pdf
    assert.throws(
      () =>
        validateUpload({
          buffer: jpegHeader,
          originalName: 'picture.jpg',
          declaredMime: 'application/pdf'
        }),
      /declared MIME type .* does not match/i
    );
  });

  it('rejects empty files', () => {
    assert.throws(
      () =>
        validateUpload({
          buffer: Buffer.alloc(0),
          originalName: 'empty.pdf',
          declaredMime: 'application/pdf'
        }),
      /file is empty/i
    );
  });

  it('rejects oversized files exceeding MAX_UPLOAD_BYTES', () => {
    const oversizedBuffer = Buffer.alloc(env.MAX_UPLOAD_BYTES + 1, 0x25); // '%...'
    assert.throws(
      () =>
        validateUpload({
          buffer: oversizedBuffer,
          originalName: 'large.pdf',
          declaredMime: 'application/pdf'
        }),
      /exceeds maximum limit/i
    );
  });

  it('rejects path traversal attempts in originalName', () => {
    const traversalNames = [
      '../../x.pdf',
      '..\\..\\x.pdf',
      '/etc/passwd.pdf',
      'subfolder/x.pdf',
      '..\\x.pdf'
    ];

    for (const badName of traversalNames) {
      assert.throws(
        () =>
          validateUpload({
            buffer: pdfHeader,
            originalName: badName,
            declaredMime: 'application/pdf'
          }),
        /path traversal detected/i
      );
    }
  });

  it('sanitizes leading dots, control characters, and collapses whitespace in safeName', () => {
    const res = validateUpload({
      buffer: pdfHeader,
      originalName: '   .hidden_annual   audit.pdf   ',
      declaredMime: 'application/pdf'
    });

    assert.strictEqual(res.safeName, 'hidden_annual audit.pdf');

    // Test sanitizeFileName helper isolation
    assert.strictEqual(
      sanitizeFileName('evil\x00\x1bname.pdf'),
      'evilname.pdf'
    );
    assert.strictEqual(
      sanitizeFileName('a'.repeat(300)),
      'a'.repeat(255)
    );
  });
});
