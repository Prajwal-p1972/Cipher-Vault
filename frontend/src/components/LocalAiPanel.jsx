import React from 'react';
import { useLocalAi } from '../hooks/useLocalAi.js';
import { ChatPanel } from './ChatPanel.jsx';

/**
 * LocalAiPanel displays in-memory AI analysis options, privacy guarantees,
 * real-time indexing status, and offline troubleshooting steps.
 *
 * Privacy Guarantees:
 * - Decrypted document content is sent ONLY to loopback 127.0.0.1.
 * - Ingested embeddings exist ONLY in memory and are discarded on close or after 30 min idle.
 * - Session tokens and document contents are never logged or rendered in DOM/storage.
 *
 * @param {{
 *   blob: Blob | null,
 *   ai?: ReturnType<typeof useLocalAi>,
 *   onResetRef?: React.MutableRefObject<(() => Promise<void>) | null>
 * }} props
 */
export function LocalAiPanel({ blob, ai: externalAi, onResetRef }) {
  const internalAi = useLocalAi();
  const ai = externalAi || internalAi;

  // Bind reset reference if requested
  if (onResetRef) {
    onResetRef.current = ai.reset;
  }

  const { state, stats, error, analyze } = ai;

  const handleAnalyze = () => {
    if (blob) {
      analyze(blob);
    }
  };

  const isBusy = state === 'checking' || state === 'analyzing';

  return (
    <div
      role="region"
      aria-label="Local AI Analysis"
      style={{
        backgroundColor: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '1.25rem',
        margin: '1rem 0',
        color: '#f8fafc',
        width: '100%',
        maxWidth: '800px',
        boxSizing: 'border-box'
      }}
    >
      {/* Header & Privacy Notice */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>&#129302;</span>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Local AI Document Analysis</h3>
      </div>

      <div
        role="note"
        style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '6px',
          padding: '0.75rem',
          fontSize: '0.8rem',
          color: '#94a3b8',
          lineHeight: 1.45,
          marginBottom: '1rem'
        }}
      >
        Analysis runs on this computer. The decrypted file is sent only to 127.0.0.1 and is deleted from the AI service when you close this window or after 30 idle minutes.
      </div>

      {/* Action / Trigger */}
      {state !== 'indexed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isBusy || !blob}
            className="btn btn-primary"
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: isBusy || !blob ? 'not-allowed' : 'pointer',
              opacity: isBusy || !blob ? 0.6 : 1
            }}
          >
            {isBusy ? 'Processing...' : 'Analyze with local AI'}
          </button>

          {isBusy && (
            <span style={{ fontSize: '0.85rem', color: '#38bdf8' }}>
              {state === 'checking' ? 'Checking local AI service...' : 'Analyzing document in local memory...'}
            </span>
          )}
        </div>
      )}

      {/* Offline Guidance */}
      {state === 'offline' && (
        <div
          role="alert"
          style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: '#451a03',
            border: '1px solid #78350f',
            borderRadius: '6px',
            color: '#fef3c7'
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            Local AI Service Unavailable
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.825rem' }}>
            {error || 'The local AI microservice is offline or model weights are missing.'}
          </p>
          <div style={{ fontSize: '0.8rem', color: '#fde68a', marginBottom: '0.25rem' }}>
            To launch the local microservice on your computer:
          </div>
          <pre
            style={{
              margin: 0,
              padding: '0.5rem 0.75rem',
              backgroundColor: '#1c1917',
              border: '1px solid #44403c',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              overflowX: 'auto',
              color: '#a3e635'
            }}
          >
            cd ai-service; .\.venv\Scripts\activate; python run.py
          </pre>
        </div>
      )}

      {/* Error Message */}
      {state === 'error' && (
        <div
          role="alert"
          style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            backgroundColor: '#450a0a',
            border: '1px solid #7f1d1d',
            borderRadius: '6px',
            color: '#fca5a5',
            fontSize: '0.85rem'
          }}
        >
          <strong>Analysis Error:</strong> {error}
        </div>
      )}

      {/* Indexed Results & Statistics */}
      {state === 'indexed' && stats && (
        <div style={{ marginTop: '0.5rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}
          >
            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.75rem',
                borderRadius: '6px',
                textAlign: 'center',
                border: '1px solid #334155'
              }}
            >
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Pages</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>{stats.pageCount}</div>
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.75rem',
                borderRadius: '6px',
                textAlign: 'center',
                border: '1px solid #334155'
              }}
            >
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>OCR Pages</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>{stats.ocrPages}</div>
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.75rem',
                borderRadius: '6px',
                textAlign: 'center',
                border: '1px solid #334155'
              }}
            >
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Chunks</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>{stats.chunkCount}</div>
            </div>
          </div>

          {stats.warnings && stats.warnings.length > 0 && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.6rem 0.8rem',
                backgroundColor: '#2e1065',
                border: '1px solid #581c87',
                borderRadius: '6px',
                fontSize: '0.8rem',
                color: '#e9d5ff'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Warnings:</div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {stats.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Document Chat Panel */}
          <ChatPanel session={ai.session} />
        </div>
      )}
    </div>
  );
}

export default LocalAiPanel;
