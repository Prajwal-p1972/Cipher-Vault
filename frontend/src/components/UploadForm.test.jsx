import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm, formatDateTimeLocal } from './UploadForm.jsx';

describe('UploadForm Component Tests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enforces client-side file type and file size prechecks', async () => {
    render(<UploadForm onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Document File/i);

    // 1. Invalid file extension (.txt)
    const invalidFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(screen.getByText(/Only PDF, JPEG, and ZIP files are allowed/i)).toBeTruthy();

    // 2. Oversized file (> 25 MB)
    const oversizedFile = new File(['a'.repeat(100)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversizedFile, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(screen.getByText(/exceeds maximum allowed limit of 25 MB/i)).toBeTruthy();
  });

  it('validates expiry date bounds (future only, max 30 days ahead)', async () => {
    render(<UploadForm onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Document File/i);
    const emailInput = screen.getByLabelText(/Recipient Email/i);
    const expiryInput = screen.getByLabelText(/Access Expiration/i);
    const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

    const validFile = new File(['content'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.change(emailInput, { target: { value: 'receiver@example.com' } });

    // Expiry in past
    const pastDate = new Date(Date.now() - 3600000);
    fireEvent.change(expiryInput, { target: { value: formatDateTimeLocal(pastDate) } });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Expiry date must be in the future/i)).toBeTruthy();

    // Expiry beyond 30 days
    const distantFuture = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
    fireEvent.change(expiryInput, { target: { value: formatDateTimeLocal(distantFuture) } });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Expiry date cannot exceed 30 days from now/i)).toBeTruthy();
  });

  it('enforces all-or-none validation for geofence parameters', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    render(<UploadForm onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Document File/i);
    const emailInput = screen.getByLabelText(/Recipient Email/i);
    const geofenceCheckbox = screen.getByLabelText(/Enforce Geofenced Decryption/i);
    const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

    const validFile = new File(['content'], 'document.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.change(emailInput, { target: { value: 'receiver@example.com' } });

    // Enable geofence
    fireEvent.click(geofenceCheckbox);

    const latInput = screen.getByLabelText(/Latitude/i);
    const lngInput = screen.getByLabelText(/Longitude/i);
    const radiusInput = screen.getByLabelText(/Radius/i);

    // Fill only lat, leave lng empty
    fireEvent.change(latInput, { target: { value: '37.7749' } });
    fireEvent.change(lngInput, { target: { value: '' } });
    fireEvent.change(radiusInput, { target: { value: '500' } });

    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/All three geofence fields \(latitude, longitude, and radius\) are required/i)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits exact FormData field names and values to /api/documents', async () => {
    let capturedBody = null;
    let capturedPath = null;

    globalThis.fetch = vi.fn(async (url, init) => {
      capturedPath = url;
      capturedBody = init.body;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          document: { id: 'doc-123', originalName: 'doc.pdf' },
          documentKey: 'secret-key-abc'
        })
      };
    });

    const onSuccess = vi.fn();
    render(<UploadForm onSuccess={onSuccess} />);

    const fileInput = screen.getByLabelText(/Document File/i);
    const emailInput = screen.getByLabelText(/Recipient Email/i);
    const oneTimeCheckbox = screen.getByLabelText(/One-Time Access/i);
    const geofenceCheckbox = screen.getByLabelText(/Enforce Geofenced Decryption/i);
    const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

    const validFile = new File(['binary-content'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.change(emailInput, { target: { value: 'bob@example.com' } });
    fireEvent.click(oneTimeCheckbox);

    // Enable geofence with valid data
    fireEvent.click(geofenceCheckbox);
    const latInput = screen.getByLabelText(/Latitude/i);
    const lngInput = screen.getByLabelText(/Longitude/i);
    const radiusInput = screen.getByLabelText(/Radius/i);

    fireEvent.change(latInput, { target: { value: '40.7128' } });
    fireEvent.change(lngInput, { target: { value: '-74.0060' } });
    fireEvent.change(radiusInput, { target: { value: '1500' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        document: { id: 'doc-123', originalName: 'doc.pdf' },
        documentKey: 'secret-key-abc'
      });
    });

    expect(capturedPath).toBe('/api/documents');
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody.get('file')).toEqual(validFile);
    expect(capturedBody.get('receiverEmail')).toBe('bob@example.com');
    expect(capturedBody.get('oneTimeUse')).toBe('true');
    expect(capturedBody.get('geoLat')).toBe('40.7128');
    expect(capturedBody.get('geoLng')).toBe('-74.006');
    expect(capturedBody.get('geoRadiusMeters')).toBe('1500');
  });

  it('maps server error status codes (400, 404, 413, 429) to explicit user messages', async () => {
    const errorStatuses = [
      {
        status: 400,
        body: { error: 'Validation failed', details: [{ path: 'file', message: 'Malformed file' }] },
        expected: /Malformed file/i
      },
      {
        status: 404,
        body: { error: 'Not Found' },
        expected: /Recipient user not found/i
      },
      {
        status: 413,
        body: { error: 'Payload Too Large' },
        expected: /Maximum allowed file size is 25 MB/i
      },
      {
        status: 429,
        body: { error: 'Too Many Requests' },
        expected: /Upload rate limit reached/i
      }
    ];

    for (const item of errorStatuses) {
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: item.status,
        json: async () => item.body
      }));

      const { unmount } = render(<UploadForm onSuccess={vi.fn()} />);

      const fileInput = screen.getByLabelText(/Document File/i);
      const emailInput = screen.getByLabelText(/Recipient Email/i);
      const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

      const validFile = new File(['hello'], 'contract.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      fireEvent.click(submitBtn);

      expect(await screen.findByText(item.expected)).toBeTruthy();
      unmount();
    }
  });

  describe('Phase 7 Batch 2 Secure Delivery & Vault Key Integration', () => {
    it('defaults delivery selector to wrapped mode', () => {
      render(<UploadForm onSuccess={vi.fn()} />);
      const deliverySelect = screen.getByLabelText(/Delivery Method/i);
      expect(deliverySelect.value).toBe('wrapped');
    });

    it('fetches receiver key on blur and displays fingerprint in wrapped mode', async () => {
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/api/keys/receiver')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              registered: true,
              fingerprint: '1111 2222 3333 4444 5555 6666 7777 8888'
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      render(<UploadForm onSuccess={vi.fn()} />);

      const emailInput = screen.getByLabelText(/Recipient Email/i);
      fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
      fireEvent.blur(emailInput);

      expect(await screen.findByText(/Receiver key fingerprint:/i)).toBeTruthy();
      expect(screen.getByText('1111 2222 3333 4444 5555 6666 7777 8888')).toBeTruthy();
      expect(screen.getByText(/Ask them to confirm it matches the one on their screen/i)).toBeTruthy();
    });

    it('disables submit button and shows warning when recipient has no registered vault key in wrapped mode', async () => {
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/api/keys/receiver')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Not Found' })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      render(<UploadForm onSuccess={vi.fn()} />);

      const fileInput = screen.getByLabelText(/Document File/i);
      const emailInput = screen.getByLabelText(/Recipient Email/i);
      const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

      const validFile = new File(['data'], 'contract.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      fireEvent.change(emailInput, { target: { value: 'nokey@example.com' } });
      fireEvent.blur(emailInput);

      expect(
        await screen.findByText(/Recipient has not set up a vault key/i)
      ).toBeTruthy();
      expect(submitBtn.disabled).toBe(true);
    });

    it('submits FormData containing delivery field', async () => {
      let capturedBody = null;
      globalThis.fetch = vi.fn(async (url, init) => {
        if (url.includes('/api/keys/receiver')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ registered: true, fingerprint: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh' })
          };
        }
        if (url.includes('/api/documents')) {
          capturedBody = init.body;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              document: { id: 'doc-wrapped-1', delivery: 'wrapped', originalName: 'report.pdf' }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      render(<UploadForm onSuccess={vi.fn()} />);

      const fileInput = screen.getByLabelText(/Document File/i);
      const emailInput = screen.getByLabelText(/Recipient Email/i);
      const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

      const validFile = new File(['data'], 'report.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      fireEvent.change(emailInput, { target: { value: 'bob@example.com' } });
      fireEvent.blur(emailInput);

      await screen.findByText(/Receiver key fingerprint:/i);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(capturedBody).toBeInstanceOf(FormData);
      });
      expect(capturedBody.get('delivery')).toBe('wrapped');
    });

    it('shows secure upload success message and no key or QR after secure upload', async () => {
      const onSuccess = vi.fn();
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/api/keys/receiver')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ registered: true, fingerprint: '1234 5678 1234 5678 1234 5678 1234 5678' })
          };
        }
        if (url.includes('/api/documents')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              document: { id: 'doc-secure-77', delivery: 'wrapped', originalName: 'confidential.pdf' }
              // NOTE: secure upload does NOT include documentKey
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      render(<UploadForm onSuccess={onSuccess} />);

      const fileInput = screen.getByLabelText(/Document File/i);
      const emailInput = screen.getByLabelText(/Recipient Email/i);
      const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

      const validFile = new File(['secret'], 'confidential.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
      fireEvent.blur(emailInput);

      await screen.findByText(/Receiver key fingerprint:/i);
      fireEvent.click(submitBtn);

      const successNotice = await screen.findByTestId('secure-upload-success');
      expect(successNotice).toBeTruthy();
      expect(successNotice.textContent).toContain('Document securely sealed and delivered');

      // Ensure no QR canvas, qr code elements or keys appear in DOM
      expect(screen.queryByTestId('key-reveal-modal')).toBeNull();
      expect(document.body.innerHTML).not.toContain('Scan with Phone');

      expect(onSuccess).toHaveBeenCalledWith({
        document: { id: 'doc-secure-77', delivery: 'wrapped', originalName: 'confidential.pdf' }
      });
      // documentKey was NOT returned or passed
      expect(onSuccess.mock.calls[0][0].documentKey).toBeUndefined();
    });

    it('keeps existing QR mode flow unchanged with documentKey passed to onSuccess', async () => {
      let capturedBody = null;
      const onSuccess = vi.fn();
      globalThis.fetch = vi.fn(async (url, init) => {
        if (url.includes('/api/documents')) {
          capturedBody = init.body;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              document: { id: 'doc-qr-99', delivery: 'qr', originalName: 'qr-plan.pdf' },
              documentKey: 'raw-doc-key-xyz-789'
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      render(<UploadForm onSuccess={onSuccess} />);

      // Switch to QR handover
      const deliverySelect = screen.getByLabelText(/Delivery Method/i);
      fireEvent.change(deliverySelect, { target: { value: 'qr' } });

      const fileInput = screen.getByLabelText(/Document File/i);
      const emailInput = screen.getByLabelText(/Recipient Email/i);
      const submitBtn = screen.getByRole('button', { name: /Seal & Send Document/i });

      const validFile = new File(['data'], 'qr-plan.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      fireEvent.change(emailInput, { target: { value: 'receiver@example.com' } });
      fireEvent.blur(emailInput);

      // In QR mode, receiver key check is not triggered
      expect(screen.queryByText(/Receiver key fingerprint:/i)).toBeNull();
      expect(submitBtn.disabled).toBe(false);

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith({
          document: { id: 'doc-qr-99', delivery: 'qr', originalName: 'qr-plan.pdf' },
          documentKey: 'raw-doc-key-xyz-789'
        });
      });

      expect(capturedBody.get('delivery')).toBe('qr');
      expect(screen.queryByTestId('secure-upload-success')).toBeNull();
    });
  });
});

