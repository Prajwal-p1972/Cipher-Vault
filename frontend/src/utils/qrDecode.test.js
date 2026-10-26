import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { encodePayload, parsePayload } from './qrPayload.js';

describe('qrDecode In-Memory Matrix Rendering & jsQR Decoding Tests', () => {
  it('builds a QR matrix with qrcode.create, renders into RGBA buffer without canvas, decodes with jsQR', () => {
    const documentId = 'abcdef0123456789abcdef01';
    const documentKey = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFG';
    const payload = encodePayload({ documentId, documentKey });

    // 1. Build QR matrix using qrcode.create
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size;

    // 2. Render into an RGBA ImageData buffer with 8px module size and 4-module quiet zone
    const moduleSize = 8;
    const quietZone = 4;
    const totalModules = moduleCount + 2 * quietZone;
    const width = totalModules * moduleSize;
    const height = totalModules * moduleSize;

    const rgbaBuffer = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      const moduleY = Math.floor(y / moduleSize) - quietZone;

      for (let x = 0; x < width; x++) {
        const moduleX = Math.floor(x / moduleSize) - quietZone;
        const pixelIndex = (y * width + x) * 4;

        let isDark = false;
        if (moduleY >= 0 && moduleY < moduleCount && moduleX >= 0 && moduleX < moduleCount) {
          isDark = Boolean(qr.modules.get(moduleY, moduleX));
        }

        const color = isDark ? 0 : 255;
        rgbaBuffer[pixelIndex] = color;     // R
        rgbaBuffer[pixelIndex + 1] = color; // G
        rgbaBuffer[pixelIndex + 2] = color; // B
        rgbaBuffer[pixelIndex + 3] = 255;   // A
      }
    }

    // 3. Decode buffer with jsQR
    const decoded = jsQR(rgbaBuffer, width, height);

    expect(decoded).not.toBeNull();
    expect(decoded.data).toBe(payload);

    // 4. parsePayload matches original document credentials
    const parsed = parsePayload(decoded.data);
    expect(parsed).toEqual({
      documentId,
      documentKey
    });
  });
});
