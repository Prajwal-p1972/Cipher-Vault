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
        marginTop: '0.75rem',
        backgroundColor: 'rgba(10, 15, 29, 0.95)',
        border: '1px solid rgba(168, 85, 247, 0.35)',
        boxShadow: '0 16px 36px -5px rgba(0, 0, 0, 0.85), 0 0 20px rgba(168, 85, 247, 0.15)',
        borderRadius: '12px',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        color: '#f8fafc',
        height: '100%',
        minHeight: '480px'
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(139, 92, 246, 0.25)',
          paddingBottom: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div className="neural-orb-wrapper" aria-hidden="true">
            <div className="neural-orb-ring-1" />
            <div className="neural-orb-ring-2" />
            <div className="neural-orb-core" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Ask Document Questions
            </h4>
            <span className="model-badge-3d">
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981' }} />
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
            padding: '0.35rem 0.8rem',
            borderRadius: '6px',
            cursor: messages.length === 0 && !isStreaming ? 'not-allowed' : 'pointer',
            opacity: messages.length === 0 && !isStreaming ? 0.45 : 1
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
          📝 Summarize document
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
          📑 Detailed summary
        </button>
        <button
          type="button"
          onClick={() => handleQuickAsk('What are the main key points and risks in this document?', 'auto')}
          disabled={isStreaming || !session}
          aria-label="Key Points"
          className="quick-action-3d-chip"
          style={{
            cursor: isStreaming || !session ? 'not-allowed' : 'pointer',
            opacity: isStreaming || !session ? 0.5 : 1
          }}
        >
          🔍 Key Points &amp; Risks
        </button>
      </div>

      {/* Message List Container with Scroll Freeze Prevention */}
      <div style={{ position: 'relative', flex: 1, minHeight: '260px', display: 'flex', flexDirection: 'column' }}>
        <div
          ref={messageListRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            maxHeight: '440px',
            minHeight: '220px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
            padding: '0.75rem 0.4rem'
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                color: '#64748b',
                fontSize: '0.85rem',
                textAlign: 'center',
                padding: '2.5rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.65rem'
              }}
            >
              <div style={{ fontSize: '2rem', opacity: 0.8 }}>💬</div>
              <div style={{ fontWeight: 600, color: '#94a3b8' }}>
                Document Ingested in Memory
              </div>
              <div style={{ maxWidth: '320px', lineHeight: 1.45, fontSize: '0.8rem' }}>
                Ask anything about this document. Questions and answers are analyzed locally by Llama 3 with verified page citations.
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem'
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    color: m.role === 'user' ? '#38bdf8' : '#c084fc'
                  }}
                >
                  <span>{m.role === 'user' ? '👤 You' : '🤖 Cipher AI (Llama 3)'}</span>
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
                    padding: '0.75rem 0.95rem',
                    borderRadius: '10px',
                    fontSize: '0.88rem',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#f8fafc',
                    border: m.error ? '1px solid #ef4444' : undefined,
                    boxShadow: m.role === 'user' ? '0 4px 12px rgba(2, 132, 199, 0.25)' : '0 4px 16px rgba(0, 0, 0, 0.5)'
                  }}
                >
                  {m.text}
                  {m.streaming && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: '7px',
                        height: '15px',
                        backgroundColor: '#38bdf8',
                        marginLeft: '5px',
                        verticalAlign: 'text-bottom',
                        animation: 'pulse 1s infinite',
                        borderRadius: '1px'
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
                      color: '#94a3b8',
                      marginTop: '0.1rem'
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
                        style={{
                          backgroundColor: 'rgba(168, 85, 247, 0.15)',
                          border: '1px solid rgba(168, 85, 247, 0.35)',
                          color: '#d8b4fe',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 600
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
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6), 0 0 10px rgba(56, 189, 248, 0.25)',
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
            backgroundColor: 'rgba(69, 10, 10, 0.8)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '6px',
            padding: '0.55rem 0.85rem',
            fontSize: '0.8rem',
            color: '#fca5a5',
            lineHeight: 1.4
          }}
        >
          {error}
        </div>
      )}

      {/* Modern Floating Input Dock */}
      <div
        style={{
          display: 'flex',
          gap: '0.65rem',
          alignItems: 'flex-end',
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '10px',
          padding: '0.5rem 0.65rem',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
        }}
      >
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
            backgroundColor: 'transparent',
            border: 'none',
            color: '#f8fafc',
            padding: '0.35rem 0.45rem',
            fontSize: '0.86rem',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.45
          }}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generation"
            className="btn-3d-danger"
            style={{
              padding: '0.55rem 1.15rem',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              height: '38px',
              borderRadius: '8px'
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
              padding: '0.55rem 1.15rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: !input.trim() ? 'not-allowed' : 'pointer',
              opacity: !input.trim() ? 0.4 : 1,
              height: '38px',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <span>Send</span>
            <span>➤</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatPanel;
