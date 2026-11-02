import React, { useState, useId } from 'react';
import { request, ApiError } from '../api/http.js';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.zip'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'application/zip',
  'application/x-zip-compressed'
];

/**
 * Formats a Date object or millisecond timestamp into a datetime-local input string (YYYY-MM-DDTHH:mm).
 *
 * @param {Date|number} date
 * @returns {string}
 */
export function formatDateTimeLocal(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Validates file extension and MIME type client-side before upload.
 *
 * @param {File} file
 * @returns {string|null} Error message or null if valid
 */
export function validateFile(file) {
  if (!file) {
    return 'Please select a file to upload.';
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File size exceeds maximum allowed limit of 25 MB.';
  }

  const name = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const hasValidMime = ALLOWED_MIME_TYPES.includes(file.type);

  if (!hasValidExt && !hasValidMime) {
    return 'Invalid file type. Only PDF, JPEG, and ZIP files are allowed.';
  }

  return null;
}

/**
 * Document upload form supporting Secure Delivery (ECDH key-wrapped) and In-person QR handover.
 *
 * @param {{
 *   onSuccess: (data: { document: object, documentKey?: string }) => void
 * }} props
 */
export function UploadForm({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [receiverEmail, setReceiverEmail] = useState('');
  const [delivery, setDelivery] = useState('wrapped'); // 'wrapped' | 'qr'
  const [expiresAt, setExpiresAt] = useState('');
  const [oneTimeUse, setOneTimeUse] = useState(false);

  // Receiver key check state for secure mode
  const [checkingReceiverKey, setCheckingReceiverKey] = useState(false);
  const [receiverKeyStatus, setReceiverKeyStatus] = useState(null); // 'found' | 'not_found' | null
  const [receiverFingerprint, setReceiverFingerprint] = useState(null);

  // Geofence fields
  const [enableGeofence, setEnableGeofence] = useState(false);
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [geoRadiusMeters, setGeoRadiusMeters] = useState('500');

  // UI status
  const [submitting, setSubmitting] = useState(false);
  const [geoLocating, setGeoLocating] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorDetails, setErrorDetails] = useState([]);
  const [secureSuccessMessage, setSecureSuccessMessage] = useState(null);

  const fileInputId = useId();
  const deliveryInputId = useId();
  const emailInputId = useId();
  const expiryInputId = useId();
  const oneTimeInputId = useId();
  const geofenceCheckboxId = useId();
  const latInputId = useId();
  const lngInputId = useId();
  const radiusInputId = useId();

  const now = new Date();
  const minExpiry = formatDateTimeLocal(now);
  const maxExpiry = formatDateTimeLocal(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setErrorMessage(null);
    setErrorDetails([]);
    setSecureSuccessMessage(null);

    if (selected) {
      const err = validateFile(selected);
      if (err) {
        setErrorMessage(err);
      }
    }
  };

  const handleEmailBlur = async () => {
    const email = receiverEmail.trim();
    if (!email || !email.includes('@')) {
      setReceiverKeyStatus(null);
      setReceiverFingerprint(null);
      return;
    }

    setCheckingReceiverKey(true);
    try {
      const res = await request(`/api/keys/receiver?email=${encodeURIComponent(email)}`);
      if (res && res.registered && res.fingerprint) {
        setReceiverKeyStatus('found');
        setReceiverFingerprint(res.fingerprint);
        setDelivery('wrapped');
      } else {
        setReceiverKeyStatus('not_found');
        setReceiverFingerprint(null);
      }
    } catch (_) {
      setReceiverKeyStatus('not_found');
      setReceiverFingerprint(null);
    } finally {
      setCheckingReceiverKey(false);
    }
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    setGeoLocating(true);
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoLocating(false);
        setGeoLat(position.coords.latitude.toFixed(6));
        setGeoLng(position.coords.longitude.toFixed(6));
      },
      (err) => {
        setGeoLocating(false);
        if (err.code === 1) {
          setErrorMessage('Location permission denied. Please allow location access or enter coordinates manually.');
        } else {
          setErrorMessage('Failed to determine location. Please enter coordinates manually.');
        }
      },
      { timeout: 10000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setErrorDetails([]);
    setSecureSuccessMessage(null);

    // 1. Validate File
    const fileError = validateFile(file);
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }

    // 2. Validate Receiver Email
    if (!receiverEmail.trim() || !receiverEmail.includes('@')) {
      setErrorMessage('A valid recipient email address is required.');
      return;
    }

    // 3. In Secure mode, enforce verified receiver key
    const hasRegisteredVaultKey = receiverKeyStatus === 'found' && Boolean(receiverFingerprint);
    const effectiveDelivery = hasRegisteredVaultKey ? 'wrapped' : delivery;

    if (effectiveDelivery === 'wrapped' && receiverKeyStatus === 'not_found') {
      setErrorMessage('Recipient has not set up a vault key. They must set up a browser vault key to receive secure deliveries, or you can switch to In-person QR handover.');
      return;
    }

    // 4. Validate Expiry Bounds if provided
    let isoExpiresAt = null;
    if (expiresAt) {
      const expDate = new Date(expiresAt);
      const currentTime = Date.now();
      const maxTime = currentTime + 30 * 24 * 60 * 60 * 1000;

      if (Number.isNaN(expDate.getTime()) || expDate.getTime() <= currentTime) {
        setErrorMessage('Expiry date must be in the future.');
        return;
      }

      if (expDate.getTime() > maxTime) {
        setErrorMessage('Expiry date cannot exceed 30 days from now.');
        return;
      }

      isoExpiresAt = expDate.toISOString();
    }

    // 5. Validate Geofence (all-or-none)
    const hasAnyGeo =
      enableGeofence ||
      geoLat.trim() !== '' ||
      geoLng.trim() !== '';

    let validatedGeo = null;
    if (hasAnyGeo) {
      if (geoLat.trim() === '' || geoLng.trim() === '' || geoRadiusMeters.trim() === '') {
        setErrorMessage('All three geofence fields (latitude, longitude, and radius) are required when geofencing is enabled.');
        return;
      }

      const parsedLat = Number(geoLat);
      const parsedLng = Number(geoLng);
      const parsedRadius = Number(geoRadiusMeters);

      if (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
        setErrorMessage('Latitude must be a valid number between -90 and 90.');
        return;
      }

      if (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
        setErrorMessage('Longitude must be a valid number between -180 and 180.');
        return;
      }

      if (Number.isNaN(parsedRadius) || parsedRadius < 1 || parsedRadius > 100000) {
        setErrorMessage('Radius must be between 1 and 100,000 meters.');
        return;
      }

      validatedGeo = {
        lat: parsedLat,
        lng: parsedLng,
        radiusMeters: parsedRadius
      };
    }

    // 6. Construct FormData
    const formData = new FormData();
    formData.append('file', file);
    formData.append('receiverEmail', receiverEmail.trim());
    formData.append('delivery', effectiveDelivery);
    formData.append('oneTimeUse', oneTimeUse ? 'true' : 'false');

    if (isoExpiresAt) {
      formData.append('expiresAt', isoExpiresAt);
    }

    if (validatedGeo) {
      formData.append('geoLat', String(validatedGeo.lat));
      formData.append('geoLng', String(validatedGeo.lng));
      formData.append('geoRadiusMeters', String(validatedGeo.radiusMeters));
    }

    // 7. Submit with UI progress & structured error mapping
    setSubmitting(true);

    try {
      const result = await request('/api/documents', {
        method: 'POST',
        body: formData
      });

      // Reset form fields
      setFile(null);
      setReceiverEmail('');
      setExpiresAt('');
      setOneTimeUse(false);
      setEnableGeofence(false);
      setGeoLat('');
      setGeoLng('');
      setGeoRadiusMeters('500');
      setReceiverKeyStatus(null);
      setReceiverFingerprint(null);

      if (effectiveDelivery === 'wrapped') {
        setSecureSuccessMessage('Document securely sealed and delivered! The recipient can open it directly in their verified browser without a QR code.');
      }

      if (typeof onSuccess === 'function') {
        onSuccess(result);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setErrorMessage(err.message || 'Validation failed. Please verify the document parameters.');
          if (Array.isArray(err.details)) {
            setErrorDetails(err.details);
          }
        } else if (err.status === 404) {
          setErrorMessage('Recipient user not found. Please verify the recipient email address.');
        } else if (err.status === 409) {
          setErrorMessage('Recipient has not registered a vault key for secure delivery. Switch to In-person QR handover or ask them to set up a vault key.');
        } else if (err.status === 413) {
          setErrorMessage('File too large. Maximum allowed file size is 25 MB.');
        } else if (err.status === 429) {
          setErrorMessage('Upload rate limit reached (max 20 uploads/hour). Please try again later.');
        } else {
          setErrorMessage(err.message || 'An unexpected error occurred while sealing the document.');
        }
      } else {
        setErrorMessage(err.message || 'Network error occurred. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const hasRegisteredVaultKey = receiverKeyStatus === 'found' && Boolean(receiverFingerprint);

  const isSubmitDisabled =
    submitting ||
    (!hasRegisteredVaultKey && delivery === 'wrapped' && receiverKeyStatus === 'not_found');

  return (
    <form onSubmit={handleSubmit} className="upload-form" noValidate>
      {secureSuccessMessage && (
        <div
          data-testid="secure-upload-success"
          role="status"
          style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.875rem'
          }}
        >
          {secureSuccessMessage}
        </div>
      )}

      {errorMessage && (
        <div
          className="alert alert-error"
          role="alert"
          style={{ marginBottom: '1.25rem' }}
        >
          <div>{errorMessage}</div>
          {errorDetails.length > 0 && (
            <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
              {errorDetails.map((det, idx) => (
                <li key={idx} style={{ fontSize: '0.82rem' }}>
                  {det.path ? `${det.path}: ` : ''}{det.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Delivery Mode Selector */}
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label htmlFor={deliveryInputId} className="form-label" style={{ fontWeight: 600 }}>
          Delivery Method <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <select
          id={deliveryInputId}
          value={hasRegisteredVaultKey ? 'wrapped' : delivery}
          onChange={(e) => {
            if (hasRegisteredVaultKey) return;
            setDelivery(e.target.value);
            setErrorMessage(null);
            setSecureSuccessMessage(null);
          }}
          disabled={submitting || hasRegisteredVaultKey}
          className="form-input"
          style={{ padding: '0.5rem' }}
        >
          <option value="wrapped">Secure delivery (recommended)</option>
          <option value="qr" disabled={hasRegisteredVaultKey}>
            In-person QR handover{hasRegisteredVaultKey ? ' (Receiver Vault Key detected)' : ''}
          </option>
        </select>
        <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginTop: '0.35rem' }}>
          {delivery === 'wrapped'
            ? 'Delivers the encryption key directly to the recipient’s browser vault key (no QR code required).'
            : 'Generates a one-time cryptographic QR code for in-person handover.'}
        </span>
      </div>

      {/* File Upload Field */}
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label htmlFor={fileInputId} className="form-label" style={{ fontWeight: 600 }}>
          Document File <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          id={fileInputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.zip"
          onChange={handleFileChange}
          disabled={submitting}
          className="form-input"
          style={{ padding: '0.5rem' }}
        />
        <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginTop: '0.35rem' }}>
          Accepted formats: PDF, JPEG, ZIP (Max 25 MB)
        </span>
      </div>

      {/* Recipient Email Field */}
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label htmlFor={emailInputId} className="form-label" style={{ fontWeight: 600 }}>
          Recipient Email <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          id={emailInputId}
          type="email"
          placeholder="receiver@example.com"
          value={receiverEmail}
          onChange={(e) => {
            setReceiverEmail(e.target.value);
            setSecureSuccessMessage(null);
            if (receiverKeyStatus) {
              setReceiverKeyStatus(null);
              setReceiverFingerprint(null);
            }
          }}
          onBlur={handleEmailBlur}
          disabled={submitting}
          required
          className="form-input"
        />

        {checkingReceiverKey && (
          <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginTop: '0.35rem' }}>
            Checking recipient vault key...
          </span>
        )}

        {(delivery === 'wrapped' || hasRegisteredVaultKey) && receiverKeyStatus === 'found' && receiverFingerprint && (
          <div
            data-testid="receiver-fingerprint-box"
            style={{
              marginTop: '0.5rem',
              padding: '0.65rem 0.85rem',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: '#166534'
            }}
          >
            <div>
              <strong>Receiver key fingerprint:</strong>{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                {receiverFingerprint}
              </code>
            </div>
            <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#15803d' }}>
              Ask them to confirm it matches the one on their screen.
            </div>
          </div>
        )}

        {delivery === 'wrapped' && !hasRegisteredVaultKey && receiverKeyStatus === 'not_found' && (
          <div
            data-testid="receiver-no-key-box"
            style={{
              marginTop: '0.5rem',
              padding: '0.65rem 0.85rem',
              backgroundColor: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: '#9f1239'
            }}
          >
            Recipient has not set up a vault key. They must set up a browser vault key to receive secure deliveries, or you can switch to In-person QR handover.
          </div>
        )}
      </div>

      {/* Expiry Date/Time */}
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label htmlFor={expiryInputId} className="form-label" style={{ fontWeight: 600 }}>
          Access Expiration (Optional)
        </label>
        <input
          id={expiryInputId}
          type="datetime-local"
          min={minExpiry}
          max={maxExpiry}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          disabled={submitting}
          className="form-input"
        />
        <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginTop: '0.35rem' }}>
          Leave empty for unlimited duration (up to 30 days ahead)
        </span>
      </div>

      {/* One-Time Access Checkbox */}
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor={oneTimeInputId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500
          }}
        >
          <input
            id={oneTimeInputId}
            type="checkbox"
            checked={oneTimeUse}
            onChange={(e) => setOneTimeUse(e.target.checked)}
            disabled={submitting}
            style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
          />
          <span>One-Time Access (Self-destructs after single decryption)</span>
        </label>
      </div>

      {/* Geofence Configuration Section */}
      <div
        className="geofence-section"
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1.5rem',
          backgroundColor: '#f8fafc'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label
            htmlFor={geofenceCheckboxId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600
            }}
          >
            <input
              id={geofenceCheckboxId}
              type="checkbox"
              checked={enableGeofence}
              onChange={(e) => setEnableGeofence(e.target.checked)}
              disabled={submitting}
              style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
            />
            <span>Enforce Geofenced Decryption</span>
          </label>

          {enableGeofence && (
            <button
              type="button"
              onClick={handleUseLocation}
              disabled={submitting || geoLocating}
              className="btn btn-secondary"
              style={{
                fontSize: '0.78rem',
                padding: '0.35rem 0.65rem',
                cursor: submitting || geoLocating ? 'not-allowed' : 'pointer'
              }}
            >
              {geoLocating ? 'Locating...' : 'Use My Location'}
            </button>
          )}
        </div>

        {enableGeofence && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label htmlFor={latInputId} className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Latitude (-90 to 90)
              </label>
              <input
                id={latInputId}
                type="number"
                step="any"
                min="-90"
                max="90"
                placeholder="e.g. 37.7749"
                value={geoLat}
                onChange={(e) => setGeoLat(e.target.value)}
                disabled={submitting}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor={lngInputId} className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Longitude (-180 to 180)
              </label>
              <input
                id={lngInputId}
                type="number"
                step="any"
                min="-180"
                max="180"
                placeholder="e.g. -122.4194"
                value={geoLng}
                onChange={(e) => setGeoLng(e.target.value)}
                disabled={submitting}
                className="form-input"
              />
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor={radiusInputId} className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Radius (meters: 1 - 100,000)
              </label>
              <input
                id={radiusInputId}
                type="number"
                min="1"
                max="100000"
                placeholder="e.g. 500"
                value={geoRadiusMeters}
                onChange={(e) => setGeoRadiusMeters(e.target.value)}
                disabled={submitting}
                className="form-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Submit Button with Loading State */}
      <button
        type="submit"
        disabled={isSubmitDisabled}
        className="btn btn-primary"
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          fontSize: '0.95rem',
          fontWeight: 600,
          cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
          opacity: isSubmitDisabled ? 0.6 : 1
        }}
      >
        {submitting ? 'Sealing & Uploading Document...' : 'Seal & Send Document'}
      </button>
    </form>
  );
}

export default UploadForm;
