import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat.js';

/**
 * ChatPanel allows users to ask context-grounded questions about the decrypted document
 * through the local AI microservice.
 *
 * Security Requirements:
 * - Plain text rendering only: no dangerouslySetInnerHTML, no markdown parser, no auto-linking.
 * - In-memory conversation: zero persistence in localStorage, sessionStorage, or cookies.
 * - Questions and answers never logged to console or network-leaked.
 * - Page chips derived strictly from the verified `sources` SSE event.
 *
 * @param {{
 *   session: { sessionId: string, token: string } | null
 * }} props
 */
export function ChatPanel({ session }) {
  const { messages, isStreaming, error, ask, stop, clear } = useChat(session);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll as streaming tokens arrive
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    ask(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      role="region"
      aria-label="Local Document Chat"
      style={{
        marginTop: '1.25rem',
        backgroundColor: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        color: '#f8fafc'
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1e293b',
          paddingBottom: '0.5rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>&#128172;</span>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            Ask Document Questions
          </h4>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={messages.length === 0 && !isStreaming}
          aria-label="Clear chat"
          style={{
            background: 'none',
            border: '1px solid #475569',
            borderRadius: '4px',
            color: '#94a3b8',
            fontSize: '0.75rem',
            padding: '0.25rem 0.6rem',
            cursor: messages.length === 0 && !isStreaming ? 'not-allowed' : 'pointer',
            opacity: messages.length === 0 && !isStreaming ? 0.5 : 1
          }}
        >
          Clear chat
        </button>
      </div>

      {/* Message List */}
      <div
        style={{
          maxHeight: '320px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '0.5rem 0'
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              color: '#64748b',
              fontSize: '0.825rem',
              textAlign: 'center',
              padding: '1.5rem 0'
            }}
          >
            Ask questions about the content of this document. Answers are generated entirely offline.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: m.role === 'user' ? '#38bdf8' : '#a78bfa'
                }}
              >
                {m.role === 'user' ? 'You' : 'Local AI'}
              </div>

              {/* Strict Plain-Text Render Container */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  backgroundColor: m.role === 'user' ? '#0369a1' : '#1e293b',
                  color: '#f8fafc',
                  border: m.error ? '1px solid #ef4444' : '1px solid #334155'
                }}
              >
                {m.text}
                {m.streaming && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '14px',
                      backgroundColor: '#38bdf8',
                      marginLeft: '4px',
                      verticalAlign: 'text-bottom',
                      animation: 'pulse 1s infinite'
                    }}
                  />
                )}
              </div>

              {/* Sources Citation Line */}
              {m.role === 'assistant' && Array.isArray(m.sources) && m.sources.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    flexWrap: 'wrap',
                    fontSize: '0.75rem',
                    color: '#94a3b8'
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Sources:</span>
                  {Array.from(
                    new Map(
                      m.sources
                        .filter((s) => s && s.page !== undefined)
                        .map((s) => [s.page, s])
                    ).values()
                  ).map((s, idx) => (
                    <span
                      key={s.page ?? idx}
                      data-testid="page-chip"
                      style={{
                        backgroundColor: '#334155',
                        color: '#38bdf8',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 500
                      }}
                    >
                      p.{s.page}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Live Region for Screen Readers */}
      <div
        aria-live="polite"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0
        }}
      >
        {messages.filter((m) => m.role === 'assistant').slice(-1)[0]?.text || ''}
      </div>

      {/* Model Accuracy Disclaimer */}
      <div
        role="note"
        style={{
          fontSize: '0.725rem',
          color: '#64748b',
          lineHeight: 1.35
        }}
      >
        Answers are generated by a local model and can be wrong. Check the cited pages.
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: '#450a0a',
            border: '1px solid #7f1d1d',
            borderRadius: '4px',
            padding: '0.5rem 0.75rem',
            fontSize: '0.8rem',
            color: '#fca5a5'
          }}
        >
          {error}
        </div>
      )}

      {/* Input & Action Bar */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about this document (Enter to send, Shift+Enter for newline)..."
          disabled={isStreaming}
          rows={2}
          maxLength={1000}
          aria-label="Question"
          style={{
            flex: 1,
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#f8fafc',
            padding: '0.5rem 0.75rem',
            fontSize: '0.85rem',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generation"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              height: '42px'
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Send question"
            style={{
              padding: '0.5rem 1.1rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: !input.trim() ? 'not-allowed' : 'pointer',
              opacity: !input.trim() ? 0.5 : 1,
              height: '42px'
            }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatPanel;
