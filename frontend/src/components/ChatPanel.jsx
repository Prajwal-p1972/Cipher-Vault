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
  const messageListRef = useRef(null);
  const textareaRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  // Detect whether user manually scrolled up to inspect earlier text/citations
  const handleScroll = (e) => {
    const el = e.currentTarget;
    if (!el) return;
    const threshold = 60; // px threshold from bottom
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    if (isNearBottom) {
      userScrolledUpRef.current = false;
      setIsScrolledUp(false);
    } else {
      userScrolledUpRef.current = true;
      setIsScrolledUp(true);
    }
  };

  // Auto-scroll as streaming tokens arrive ONLY when the user is already near the bottom
  useEffect(() => {
    if (!userScrolledUpRef.current && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    userScrolledUpRef.current = false;
    setIsScrolledUp(false);
    ask(trimmed);
    setInput('');
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleQuickAsk = (questionText, mode) => {
    if (isStreaming || !session) return;
    userScrolledUpRef.current = false;
    setIsScrolledUp(false);
    ask(questionText, mode);
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  };

  const scrollToLatest = () => {
    userScrolledUpRef.current = false;
    setIsScrolledUp(false);
    if (messageListRef.current) {
      messageListRef.current.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: 'smooth'
      });
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
      className="preserve-3d"
      style={{
        marginTop: '1.25rem',
        backgroundColor: '#0a0f1d',
        border: '1px solid rgba(168, 85, 247, 0.4)',
        boxShadow: '0 12px 30px -5px rgba(0, 0, 0, 0.8), 0 0 16px rgba(168, 85, 247, 0.2)',
        borderRadius: '12px',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        color: '#f8fafc'
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(139, 92, 246, 0.25)',
          paddingBottom: '0.65rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div className="neural-orb-wrapper" aria-hidden="true">
            <div className="neural-orb-ring-1" />
            <div className="neural-orb-ring-2" />
            <div className="neural-orb-core" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Ask Document Questions
            </h4>
            <span className="model-badge-3d">
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#8b5cf6' }} />
              Llama 3 • Offline RAG
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={messages.length === 0 && !isStreaming}
          aria-label="Clear chat"
          className="btn-3d-danger"
          style={{
            fontSize: '0.75rem',
            padding: '0.3rem 0.75rem',
            cursor: messages.length === 0 && !isStreaming ? 'not-allowed' : 'pointer',
            opacity: messages.length === 0 && !isStreaming ? 0.5 : 1
          }}
        >
          Clear chat
        </button>
      </div>

      {/* Quick Summary Action Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => handleQuickAsk('Summarize document', 'summary')}
          disabled={isStreaming || !session}
          aria-label="Summarize document"
          className="quick-action-3d-chip"
          style={{
            cursor: isStreaming || !session ? 'not-allowed' : 'pointer',
            opacity: isStreaming || !session ? 0.5 : 1
          }}
        >
          Summarize document
        </button>
        <button
          type="button"
          onClick={() => handleQuickAsk('Detailed summary of document', 'detailed')}
          disabled={isStreaming || !session}
          aria-label="Detailed summary"
          className="quick-action-3d-chip"
          style={{
            cursor: isStreaming || !session ? 'not-allowed' : 'pointer',
            opacity: isStreaming || !session ? 0.5 : 1
          }}
        >
          Detailed summary
        </button>
      </div>

      {/* Message List Container with Scroll Freeze Prevention */}
      <div style={{ position: 'relative' }}>
        <div
          ref={messageListRef}
          onScroll={handleScroll}
          style={{
            maxHeight: '360px',
            minHeight: '160px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '0.5rem 0.25rem'
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

                {/* Multi-step summarization progress indicator */}
                {m.role === 'assistant' && m.streaming && m.progress && (
                  <div
                    data-testid="summary-progress"
                    style={{
                      fontSize: '0.75rem',
                      color: '#38bdf8',
                      fontStyle: 'italic',
                      marginBottom: '0.15rem'
                    }}
                  >
                    Summarizing... step {m.progress.step} of {m.progress.of}
                  </div>
                )}

                {/* Strict Plain-Text Render Container */}
                <div
                  className={m.role === 'user' ? 'chat-bubble-3d-user' : 'chat-bubble-3d-ai'}
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#f8fafc',
                    border: m.error ? '1px solid #ef4444' : undefined
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
                        className="citation-pill-3d"
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

        {/* Floating Jump to Latest Button when User has Scrolled Up */}
        {isScrolledUp && (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Jump to latest message"
            style={{
              position: 'absolute',
              bottom: '0.5rem',
              right: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              borderRadius: '9999px',
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5), 0 0 10px rgba(56, 189, 248, 0.25)',
              cursor: 'pointer',
              zIndex: 10
            }}
          >
            <span>&darr;</span> Jump to latest
          </button>
        )}
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
          className="input-3d-well"
          style={{
            flex: 1,
            borderRadius: '8px',
            padding: '0.6rem 0.85rem',
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
            className="btn-3d-danger"
            style={{
              padding: '0.5rem 1.15rem',
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
            className="btn-3d-cyber"
            style={{
              padding: '0.5rem 1.25rem',
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
