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
});
