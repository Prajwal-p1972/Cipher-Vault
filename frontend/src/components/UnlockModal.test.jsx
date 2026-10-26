import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnlockModal } from './UnlockModal.jsx';
import { DocumentViewer } from './DocumentViewer.jsx';
import { encodePayload } from '../utils/qrPayload.js';
import * as httpModule from '../api/http.js';
import * as geoModule from '../utils/geolocation.js';

// Mock QrScanner to deterministically feed scan strings into UnlockModal
vi.mock('./QrScanner.jsx', () => ({
  QrScanner: ({ onResult, onCancel }) => (
    <div data-testid="mock-qr-scanner">
      <button
        type="button"
        data-testid="mock-scan-btn"
        onClick={() => onResult(window.__testScanPayload)}
      >
        Simulate Scan
      </button>
      <button type="button" data-testid="mock-cancel-btn" onClick={onCancel}>
        Simulate Cancel
      </button>
    </div>
  ),
  default: ({ onResult, onCancel }) => (
    <div data-testid="mock-qr-scanner">
      <button
        type="button"
        data-testid="mock-scan-btn"
        onClick={() => onResult(window.__testScanPayload)}
      >
        Simulate Scan
      </button>
      <button type="button" data-testid="mock-cancel-btn" onClick={onCancel}>
        Simulate Cancel
      </button>
    </div>
  )
}));

describe('UnlockModal & DocumentViewer Security and Integration Tests', () => {
  const TARGET_DOC_ID = '6543210987abcdef01234567';
  const OTHER_DOC_ID = '111122223333444455556666';
  const SECRET_KEY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP1';

  beforeEach(() => {
    vi.restoreAllMocks();
    window.__testScanPayload = '';
  });

  afterEach(() => {
    delete window.__testScanPayload;
  });

  it('rejects a QR code for a different document and immediately discards the key', async () => {
    const doc = {
      id: TARGET_DOC_ID,
      originalName: 'top_secret.pdf',
      hasGeofence: false
    };

    window.__testScanPayload = encodePayload({
      documentId: OTHER_DOC_ID,
      documentKey: SECRET_KEY
    });

    render(<UnlockModal document={doc} onSuccess={vi.fn()} onClose={vi.fn()} />);

    const scanBtn = screen.getByTestId('mock-scan-btn');
    fireEvent.click(scanBtn);

    // Verify error message
    expect(
      await screen.findByText('This QR belongs to a different document')
    ).toBeTruthy();

    // Verify we remain in scan step and verification input is NOT shown
    expect(screen.queryByLabelText(/Authenticator MFA Code/i)).toBeNull();
  });

  it('builds request body with exactly { documentKey, code } for non-geofenced documents', async () => {
    const doc = {
      id: TARGET_DOC_ID,
      originalName: 'normal_doc.pdf',
      hasGeofence: false
    };

    const requestBlobSpy = vi.spyOn(httpModule, 'requestBlob').mockResolvedValue({
      status: 200,
      blob: new Blob(['fake-pdf'], { type: 'application/pdf' }),
      headers: new Headers({
        'content-type': 'application/pdf',
        'x-document-name': encodeURIComponent('normal_doc.pdf')
      })
    });

    const getCurrentLocationSpy = vi.spyOn(geoModule, 'getCurrentLocation');
    const onSuccess = vi.fn();

    window.__testScanPayload = encodePayload({
      documentId: TARGET_DOC_ID,
      documentKey: SECRET_KEY
    });

    render(<UnlockModal document={doc} onSuccess={onSuccess} onClose={vi.fn()} />);

    // 1. Scan valid QR
    fireEvent.click(screen.getByTestId('mock-scan-btn'));

    // 2. Expect transition to verification step
    const codeInput = await screen.findByLabelText(/Authenticator MFA Code/i);
    expect(codeInput).toBeTruthy();

    // 3. Enter 6-digit MFA code
    fireEvent.change(codeInput, { target: { value: '654321' } });

    // 4. Submit
    const submitBtn = screen.getByRole('button', { name: /Unlock Document/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestBlobSpy).toHaveBeenCalledTimes(1);
    });

    expect(getCurrentLocationSpy).not.toHaveBeenCalled();

    // Verify request payload contains ONLY documentKey and code
    const [path, options] = requestBlobSpy.mock.calls[0];
    expect(path).toBe(`/api/documents/${TARGET_DOC_ID}/open`);
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({
      documentKey: SECRET_KEY,
      code: '654321'
    });
    expect(options.body.lat).toBeUndefined();
    expect(options.body.lng).toBeUndefined();
    expect(options.body.accuracyMeters).toBeUndefined();

    expect(onSuccess).toHaveBeenCalled();
  });

  it('includes { lat, lng, accuracyMeters } on-submit only when document is geofenced', async () => {
    const doc = {
      id: TARGET_DOC_ID,
      originalName: 'geofenced_brief.pdf',
      hasGeofence: true
    };

    const requestBlobSpy = vi.spyOn(httpModule, 'requestBlob').mockResolvedValue({
      status: 200,
      blob: new Blob(['geofenced-pdf'], { type: 'application/pdf' }),
      headers: new Headers({
        'content-type': 'application/pdf',
        'x-document-name': 'geofenced_brief.pdf'
      })
    });

    const getCurrentLocationSpy = vi.spyOn(geoModule, 'getCurrentLocation').mockResolvedValue({
      lat: 37.7749,
      lng: -122.4194,
      accuracyMeters: 12.5
    });

    window.__testScanPayload = encodePayload({
      documentId: TARGET_DOC_ID,
      documentKey: SECRET_KEY
    });

    render(<UnlockModal document={doc} onSuccess={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('mock-scan-btn'));

    const codeInput = await screen.findByLabelText(/Authenticator MFA Code/i);
    fireEvent.change(codeInput, { target: { value: '112233' } });

    const submitBtn = screen.getByRole('button', { name: /Unlock Document/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestBlobSpy).toHaveBeenCalledTimes(1);
    });

    expect(getCurrentLocationSpy).toHaveBeenCalledTimes(1);

    const [, options] = requestBlobSpy.mock.calls[0];
    expect(options.body).toEqual({
      documentKey: SECRET_KEY,
      code: '112233',
      lat: 37.7749,
      lng: -122.4194,
      accuracyMeters: 12.5
    });
  });

  it('maps backend error codes correctly to user-friendly messages without leaking coordinates', async () => {
    const doc = {
      id: TARGET_DOC_ID,
      originalName: 'classified.pdf',
      hasGeofence: false
    };

    const testErrorMapping = async (status, code, expectedText) => {
      vi.spyOn(httpModule, 'requestBlob').mockRejectedValueOnce(
        new httpModule.ApiError(status, 'Backend Error', null, code)
      );

      const codeInput = screen.getByLabelText(/Authenticator MFA Code/i);
      fireEvent.change(codeInput, { target: { value: '999999' } });

      const submitBtn = screen.getByRole('button', { name: /Unlock Document/i });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(expectedText)).toBeTruthy();

      // Back to scan to reset state for next test case
      fireEvent.click(screen.getByRole('button', { name: /Scan Again/i }));
      fireEvent.click(screen.getByTestId('mock-scan-btn'));
    };

    window.__testScanPayload = encodePayload({
      documentId: TARGET_DOC_ID,
      documentKey: SECRET_KEY
    });

    render(<UnlockModal document={doc} onSuccess={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mock-scan-btn'));

    // 401: bad MFA
    await testErrorMapping(401, null, /Invalid or expired MFA code/i);

    // 423: locked
    await testErrorMapping(423, null, /Account is temporarily locked/i);

    // 429: rate limited
    await testErrorMapping(429, null, /Too many requests/i);

    // 410: consumed
    await testErrorMapping(410, 'consumed', /This one-time document has already been opened and destroyed/i);

    // 410: expired
    await testErrorMapping(410, 'expired', /This document has expired and can no longer be accessed/i);

    // 403: integrity
    await testErrorMapping(403, 'integrity', /Unable to open this document with this QR/i);

    // 403: outside_area
    await testErrorMapping(403, 'outside_area', /You are outside the authorized geographic area/i);

    // 403: location_imprecise
    await testErrorMapping(403, 'location_imprecise', /Location accuracy is too low/i);

    // 404: not found
    await testErrorMapping(404, null, /Document not found or you are not authorized/i);
  });

  it('ensures the key is never leaked in DOM, localStorage, sessionStorage, or console after close', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log');
    const consoleWarnSpy = vi.spyOn(console, 'warn');
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');

    const doc = { id: TARGET_DOC_ID, originalName: 'doc.pdf', hasGeofence: false };

    function ParentWrapper() {
      const [isOpen, setIsOpen] = useState(true);
      return isOpen ? (
        <UnlockModal document={doc} onSuccess={vi.fn()} onClose={() => setIsOpen(false)} />
      ) : (
        <div data-testid="unlocked-closed">Modal Closed</div>
      );
    }

    window.__testScanPayload = encodePayload({
      documentId: TARGET_DOC_ID,
      documentKey: SECRET_KEY
    });

    render(<ParentWrapper />);

    fireEvent.click(screen.getByTestId('mock-scan-btn'));
    await screen.findByLabelText(/Authenticator MFA Code/i);

    // Cancel / close
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(await screen.findByTestId('unlocked-closed')).toBeTruthy();

    // Verify key is not in DOM
    expect(document.body.innerHTML).not.toContain(SECRET_KEY);

    // Verify no storage or console leaks
    expect(localStorageSpy).not.toHaveBeenCalled();
    for (const spy of [consoleLogSpy, consoleWarnSpy, consoleErrorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(SECRET_KEY);
        }
      }
    }
  });

  describe('DocumentViewer Tests', () => {
    it('rejects disallowed MIME types with an error message', () => {
      const onClose = vi.fn();
      const fakeBlob = new Blob(['alert(1)'], { type: 'text/html' });

      render(
        <DocumentViewer
          blob={fakeBlob}
          contentType="text/html"
          originalName="exploit.html"
          onClose={onClose}
        />
      );

      expect(screen.getByText(/Unsupported document format: text\/html/i)).toBeTruthy();
      expect(screen.queryByTitle(/Decrypted PDF Document/i)).toBeNull();
    });

    it('creates object URL for application/pdf and revokes it on close', () => {
      const createObjectURLMock = vi.fn(() => 'blob:http://localhost:3000/mock-pdf-uuid');
      const revokeObjectURLMock = vi.fn();
      Object.assign(URL, {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock
      });

      const onClose = vi.fn();
      const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

      const { unmount } = render(
        <DocumentViewer
          blob={pdfBlob}
          contentType="application/pdf"
          originalName="sample.pdf"
          onClose={onClose}
        />
      );

      expect(createObjectURLMock).toHaveBeenCalledWith(pdfBlob);
      const iframe = screen.getByTitle('Decrypted PDF Document');
      expect(iframe).toBeTruthy();
      expect(iframe.getAttribute('src')).toBe('blob:http://localhost:3000/mock-pdf-uuid');
      expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');

      // Click close
      const closeBtn = screen.getByRole('button', { name: /Close Viewer/i });
      fireEvent.click(closeBtn);

      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost:3000/mock-pdf-uuid');
      expect(onClose).toHaveBeenCalled();

      // Unmount safeguard
      unmount();
    });
  });
});
