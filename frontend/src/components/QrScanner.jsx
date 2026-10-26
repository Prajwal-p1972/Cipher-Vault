import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';

/**
 * QrScanner provides dual-mode QR code scanning:
 * 1. Live camera feed using getUserMedia + requestAnimationFrame + jsQR.
 * 2. Uploaded image file downscaled to max 1600px + jsQR.
 *
 * Hardware camera tracks are stopped immediately upon decode, tab-switch, cancel, or unmount.
 *
 * @param {{
 *   onResult: (text: string) => void,
 *   onCancel: () => void
 * }} props
 */
export function QrScanner({ onResult, onCancel }) {
  const [mode, setMode] = useState('camera'); // 'camera' | 'upload'
  const [cameraError, setCameraError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isStoppedRef = useRef(false);

  const stopCamera = useCallback(() => {
    isStoppedRef.current = true;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      try {
        const tracks = streamRef.current.getTracks();
        for (const track of tracks) {
          track.stop();
        }
      } catch (_) {
        // Stream tracks cleanup safeguard
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    isStoppedRef.current = false;
    setCameraError(null);

    // Context & API capability checks
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setCameraError('Camera access requires a secure context (HTTPS or localhost).');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera scanning is not supported by your browser or environment.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      if (isStoppedRef.current) {
        // Stopped while request was in-flight
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play().catch(() => {});
      }

      // Begin frame scanning loop (~10 fps rate limit)
      let lastScanTime = 0;
      const scanIntervalMs = 100;

      const tick = (now) => {
        if (isStoppedRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
          if (now - lastScanTime >= scanIntervalMs) {
            lastScanTime = now;

            const width = video.videoWidth;
            const height = video.videoHeight;

            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, width, height);
              const imageData = ctx.getImageData(0, 0, width, height);
              const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert'
              });

              if (qrResult && qrResult.data) {
                stopCamera();
                if (typeof onResult === 'function') {
                  onResult(qrResult.data);
                }
                return;
              }
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission denied. Please allow camera access in your browser or use the Upload tab.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. Please use the Upload tab.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError('Camera is currently in use by another application.');
      } else {
        setCameraError('Unable to start camera feed. Please use the Upload tab.');
      }
    }
  }, [stopCamera, onResult]);

  useEffect(() => {
    if (mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [mode, startCamera, stopCamera]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsProcessingUpload(true);

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        const maxDim = 1600;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          setUploadError('Failed to initialize 2D canvas context.');
          setIsProcessingUpload(false);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const qrResult = jsQR(imageData.data, imageData.width, imageData.height);

        setIsProcessingUpload(false);

        if (qrResult && qrResult.data) {
          if (typeof onResult === 'function') {
            onResult(qrResult.data);
          }
        } else {
          setUploadError('No QR code found in the selected image. Please try another image.');
        }
      } catch (_) {
        setIsProcessingUpload(false);
        setUploadError('Failed to process image file.');
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setIsProcessingUpload(false);
      setUploadError('Failed to load image file. Please verify it is a valid image format.');
    };

    img.src = objectUrl;
    // Reset file input value so re-selecting same file triggers onChange
    e.target.value = '';
  };

  const handleCancel = () => {
    stopCamera();
    if (typeof onCancel === 'function') {
      onCancel();
    }
  };

  return (
    <div
      className="qr-scanner"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        width: '100%'
      }}
    >
      {/* Tab Switcher */}
      <div
        role="tablist"
        aria-label="Scanner mode"
        style={{
          display: 'flex',
          borderBottom: '1px solid #e2e8f0',
          gap: '0.5rem'
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'camera'}
          onClick={() => {
            setMode('camera');
            setCameraError(null);
          }}
          className={`tab-btn ${mode === 'camera' ? 'tab-active' : ''}`}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: mode === 'camera' ? '#2563eb' : '#64748b',
            borderBottom: mode === 'camera' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: '-1px'
          }}
        >
          Scan with Camera
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          onClick={() => {
            setMode('upload');
            setUploadError(null);
          }}
          className={`tab-btn ${mode === 'upload' ? 'tab-active' : ''}`}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: mode === 'upload' ? '#2563eb' : '#64748b',
            borderBottom: mode === 'upload' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: '-1px'
          }}
        >
          Upload QR Image
        </button>
      </div>

      {/* Camera Mode */}
      {mode === 'camera' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {cameraError ? (
            <div
              className="alert alert-error"
              role="alert"
              style={{
                width: '100%',
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#991b1b',
                fontSize: '0.875rem',
                lineHeight: 1.5
              }}
            >
              {cameraError}
            </div>
          ) : (
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '360px',
                aspectRatio: '1 / 1',
                backgroundColor: '#0f172a',
                borderRadius: '12px',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Aiming Reticle Overlay */}
              <div
                style={{
                  position: 'absolute',
                  width: '65%',
                  height: '65%',
                  border: '2px dashed rgba(255, 255, 255, 0.75)',
                  borderRadius: '12px',
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                  pointerEvents: 'none'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  color: '#ffffff',
                  fontSize: '0.75rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  pointerEvents: 'none'
                }}
              >
                Center QR code within viewfinder
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Mode */}
      {mode === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: '8px',
              padding: '2rem 1.5rem',
              textAlign: 'center',
              backgroundColor: '#f8fafc'
            }}
          >
            <label
              htmlFor="qr-file-upload-input"
              style={{
                display: 'inline-block',
                cursor: isProcessingUpload ? 'wait' : 'pointer',
                fontWeight: 600,
                color: '#2563eb',
                fontSize: '0.9rem'
              }}
            >
              {isProcessingUpload ? 'Processing image...' : 'Choose a QR Code Image (PNG / JPEG)'}
            </label>
            <input
              id="qr-file-upload-input"
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={isProcessingUpload}
              style={{
                display: 'block',
                margin: '0.75rem auto 0 auto',
                fontSize: '0.85rem'
              }}
            />
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Select a downloaded or photographed QR code image file.
            </p>
          </div>

          {uploadError && (
            <div
              className="alert alert-error"
              role="alert"
              style={{
                padding: '0.75rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '0.85rem'
              }}
            >
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={handleCancel}
          className="btn btn-secondary"
          style={{ width: 'auto', padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default QrScanner;
