import { useState, useRef, useEffect, useCallback } from 'react';
import { streamChat, clearHistory, LocalAiChatError } from '../api/localAiChat.js';

/**
 * Maps error objects from localAiChat into clear, user-friendly security-safe messages.
 *
 * @param {any} err
 * @returns {string}
 */
export function mapChatError(err) {
  if (err instanceof LocalAiChatError) {
    if (err.status === 409) return 'Still answering the previous question';
    if (err.status === 429) return 'Slow down a little';
    if (err.status === 401) return 'Session expired, re-analyze the document';
    if (err.status === 0) {
      return 'Local AI service is offline. Please start Ollama and run `ollama pull llama3`.';
    }
    return err.message;
  }
  if (err?.name === 'AbortError') {
    return 'Response generation stopped.';
  }
  return 'Local AI service is offline. Please start Ollama and run `ollama pull llama3`.';
}

/**
 * Hook managing ephemeral in-memory conversation state for local AI document Q&A.
 * Never persists messages, tokens, questions, or answers to any persistent storage.
 *
 * @param {{ sessionId: string, token: string } | null} session
 * @returns {{
 *   messages: Array<{ id: string, role: 'user'|'assistant', text: string, sources?: Array<object>, streaming?: boolean, error?: boolean }>,
 *   isStreaming: boolean,
 *   error: string | null,
 *   ask: (question: string) => Promise<void>,
 *   stop: () => void,
 *   clear: () => Promise<void>
 * }}
 */
export function useChat(session) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);
  const isMountedRef = useRef(true);

  // Stop active streaming request if in progress
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  }, []);

  // Clear state and server-side session history
  const clear = useCallback(async () => {
    stop();
    if (isMountedRef.current) {
      setMessages([]);
      setError(null);
    }
    if (session) {
      try {
        await clearHistory(session);
      } catch (_) {
        // Non-blocking best-effort history clear
      }
    }
  }, [session, stop]);

  // Submit a question to the active session
  const ask = useCallback(
    async (question, mode = 'auto') => {
      if (typeof question !== 'string') return;
      const trimmed = question.trim();

      if (trimmed.length < 1 || trimmed.length > 1000) {
        if (isMountedRef.current) {
          setError('Question must be between 1 and 1000 characters.');
        }
        return;
      }

      if (isStreaming) {
        return;
      }

      if (!session) {
        if (isMountedRef.current) {
          setError('Session expired, re-analyze the document');
        }
        return;
      }

      setError(null);
      setIsStreaming(true);

      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const userMessage = {
        id: userMsgId,
        role: 'user',
        text: trimmed
      };

      const assistantMessage = {
        id: assistantMsgId,
        role: 'assistant',
        text: '',
        sources: [],
        progress: null,
        streaming: true
      };

      if (isMountedRef.current) {
        setMessages((prev) => [...prev, userMessage, assistantMessage]);
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await streamChat(
          session,
          trimmed,
          {
            signal: controller.signal,
            mode,
            onSources: (sources) => {
              if (!isMountedRef.current) return;
              const rawSources = Array.isArray(sources) ? sources : [];
              const seenPages = new Set();
              const deduplicated = [];
              for (const s of rawSources) {
                if (s && s.page !== undefined && !seenPages.has(s.page)) {
                  seenPages.add(s.page);
                  deduplicated.push(s);
                }
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, sources: deduplicated }
                    : m
                )
              );
            },
            onProgress: (prog) => {
              if (!isMountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, progress: prog }
                    : m
                )
              );
            },
            onToken: (tokenText) => {
              if (!isMountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, text: m.text + tokenText } : m
                )
              );
            },
            onDone: (doneData) => {
              if (!isMountedRef.current) return;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        streaming: false,
                        progress: null,
                        text:
                          doneData && typeof doneData.finalText === 'string'
                            ? doneData.finalText
                            : m.text
                      }
                    : m
                )
              );
            },
            onError: (streamErr) => {
              if (!isMountedRef.current) return;
              const mapped = mapChatError(streamErr);
              setError(mapped);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        streaming: false,
                        progress: null,
                        error: true,
                        text: m.text || mapped
                      }
                    : m
                )
              );
            }
          }
        );
      } catch (err) {
        if (!isMountedRef.current) return;
        if (controller.signal.aborted) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, streaming: false } : m
            )
          );
          return;
        }
        const mapped = mapChatError(err);
        setError(mapped);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  streaming: false,
                  error: true,
                  text: m.text || mapped
                }
              : m
          )
        );
      } finally {
        if (isMountedRef.current) {
          setIsStreaming(false);
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [isStreaming, session]
  );

  // Clean up any ongoing streaming on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  return {
    messages,
    isStreaming,
    error,
    ask,
    stop,
    clear
  };
}

export default useChat;
