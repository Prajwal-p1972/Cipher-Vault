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
export function LocalAiPanel({ blob, ai: externalAi, onResetRef, isExpanded = false, onToggleExpand, style = {} }) {
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
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 15, 29, 0.98) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        boxShadow: '0 12px 30px -5px rgba(0, 0, 0, 0.8), 0 0 16px rgba(56, 189, 248, 0.15)',
        borderRadius: '12px',
        padding: '1.25rem',
        margin: 0,
        color: '#f8fafc',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        ...style
      }}
    >
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.85rem',
          paddingBottom: '0.65rem',
          borderBottom: '1px solid rgba(56, 189, 248, 0.15)',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem'
            }}
          >
            🤖
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Local AI Intelligence
            </h3>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              Zero-Leakage In-Memory Analysis
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '0.2rem 0.55rem',
              borderRadius: '9999px',
              backgroundColor: state === 'offline' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: state === 'offline' ? '#fca5a5' : '#34d399',
              border: state === 'offline' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: state === 'offline' ? '#ef4444' : '#10b981'
              }}
            />
            {state === 'offline' ? 'Service Offline' : state === 'indexed' ? 'Indexed in RAM' : 'Engine Ready'}
          </span>

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                color: '#94a3b8',
                borderRadius: '6px',
                padding: '0.25rem 0.6rem',
                fontSize: '0.72rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
              title={isExpanded ? 'Shrink to standard split' : 'Expand chat width'}
            >
              {isExpanded ? '🗗 Split' : '🗖 Expand'}
            </button>
          )}
        </div>
      </div>

      <div
        role="note"
        style={{
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          borderRadius: '8px',
          padding: '0.65rem 0.85rem',
          fontSize: '0.78rem',
          color: '#94a3b8',
          lineHeight: 1.45,
          marginBottom: '0.9rem'
        }}
      >
        Analysis runs on this computer. The decrypted file is sent only to 127.0.0.1 and is deleted from the AI service when you close this window or after 30 idle minutes.
      </div>

      {/* Action / Trigger */}
      {state !== 'indexed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isBusy || !blob}
            className="btn btn-primary btn-3d-cyber"
            style={{
              padding: '0.75rem 1.25rem',
              fontSize: '0.92rem',
              fontWeight: 700,
              cursor: isBusy || !blob ? 'not-allowed' : 'pointer',
              opacity: isBusy || !blob ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 0 20px rgba(56, 189, 248, 0.2)'
            }}
          >
            <span>{isBusy ? '⚡' : '✨'}</span>
            <span>{isBusy ? 'Indexing Document in Local Memory...' : 'Analyze with local AI'}</span>
          </button>

          {isBusy && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.82rem',
                color: '#38bdf8',
                padding: '0.4rem 0.6rem',
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                borderRadius: '6px'
              }}
            >
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              <span>{state === 'checking' ? 'Connecting to local AI microservice...' : 'Extracting text and building vector index...'}</span>
            </div>
          )}
        </div>
      )}

      {/* Offline Guidance */}
      {state === 'offline' && (
        <div
          role="alert"
          style={{
            marginTop: '0.85rem',
            padding: '0.9rem 1rem',
            backgroundColor: 'rgba(69, 26, 3, 0.7)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '8px',
            color: '#fef3c7'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.35rem', color: '#fbbf24' }}>
            ⚠️ Local AI Service Unavailable
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#fde68a', lineHeight: 1.4 }}>
            {error || 'The local AI microservice is offline or model weights are missing.'}
          </p>
          <div style={{ fontSize: '0.76rem', color: '#fef08a', marginBottom: '0.35rem' }}>
            Start the service with one command:
          </div>
          <pre
            style={{
              margin: 0,
              padding: '0.5rem 0.75rem',
              backgroundColor: '#1c1917',
              border: '1px solid #44403c',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
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
