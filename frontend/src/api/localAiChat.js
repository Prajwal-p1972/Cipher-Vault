import { AI_URL } from '../config.js';

/**
 * Custom error class for local AI chat interactions.
 */
export class LocalAiChatError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'LocalAiChatError';
    this.status = status;
  }
}

/** Maximum allowed character length for a generated answer */
export const MAX_ANSWER_CHARS = 20000;

/**
 * Checks the status of the local LLM runtime (e.g. Ollama).
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ online: boolean, modelPresent: boolean, model: string|null }>}
 */
export async function llmStatus(signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  // Link external signal if provided
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${AI_URL}/v1/llm/status`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!res.ok) {
      return { online: false, modelPresent: false, model: null };
    }

    const data = await res.json().catch(() => ({}));
    return {
      online: Boolean(data.online),
      modelPresent: Boolean(data.modelPresent),
      model: data.model || null
    };
  } catch (_) {
    return { online: false, modelPresent: false, model: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clears multi-turn conversation history for the current AI session.
 *
 * @param {{ sessionId: string, token: string } | null} session
 * @returns {Promise<void>}
 */
export async function clearHistory(session) {
  if (!session || !session.sessionId || !session.token) {
    throw new LocalAiChatError(401, 'Missing active AI session');
  }

  const res = await fetch(`${AI_URL}/v1/sessions/${session.sessionId}/history`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });

  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new LocalAiChatError(
      res.status,
      data.error || data.detail || 'Failed to clear conversation history'
    );
  }
}

/**
 * Parses raw SSE text frames into structured events.
 * Handles frames split across chunks and multiple events per chunk.
 *
 * @param {string} rawChunk
 * @param {{ buffer: string }} state
 * @returns {Array<{ event: string, data: any }>}
 */
export function parseSseChunk(rawChunk, state) {
  state.buffer += rawChunk;
  const events = [];

  // Frames in SSE are separated by double newlines (\n\n or \r\n\r\n)
  let boundaryIndex;
  while ((boundaryIndex = state.buffer.search(/\r?\n\r?\n/)) !== -1) {
    const rawFrame = state.buffer.slice(0, boundaryIndex);
    // Advance past the double newline delimiter
    const delimiterMatch = state.buffer.slice(boundaryIndex).match(/^(\r?\n){2}/);
    const delimiterLength = delimiterMatch ? delimiterMatch[0].length : 2;
    state.buffer = state.buffer.slice(boundaryIndex + delimiterLength);

    if (!rawFrame.trim()) continue;

    let eventType = 'message';
    const dataLines = [];

    const lines = rawFrame.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length > 0) {
      const combinedData = dataLines.join('\n');
      try {
        const parsed = JSON.parse(combinedData);
        events.push({ event: eventType, data: parsed });
      } catch (_) {
        events.push({ event: eventType, data: combinedData });
      }
    }
  }

  return events;
}

/**
 * Streams a chat query against the local AI document index using Server-Sent Events.
 *
 * @param {{ sessionId: string, token: string }} session
 * @param {string} question
 * @param {{
 *   signal?: AbortSignal,
 *   onSources?: (sources: Array<{ page: number, source: string, score: number }>) => void,
 *   onToken?: (text: string) => void,
 *   onDone?: (stats: object) => void,
 *   onError?: (error: Error) => void
 * }} callbacks
 * @returns {Promise<void>}
 */
export async function streamChat(session, question, callbacks = {}) {
  const { signal, onSources, onToken, onDone, onError } = callbacks;

  if (!session || !session.sessionId || !session.token) {
    const err = new LocalAiChatError(401, 'Session expired, re-analyze the document');
    onError?.(err);
    throw err;
  }

  if (typeof question !== 'string' || question.trim().length === 0) {
    const err = new LocalAiChatError(400, 'Question must not be empty');
    onError?.(err);
    throw err;
  }

  let res;
  try {
    res = await fetch(`${AI_URL}/v1/sessions/${session.sessionId}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question: question.trim() }),
      signal
    });
  } catch (err) {
    if (signal?.aborted) {
      return;
    }
    const mappedErr = new LocalAiChatError(
      0,
      'Local AI service unreachable. Please ensure Ollama is running and run `ollama pull llama3`.'
    );
    onError?.(mappedErr);
    throw mappedErr;
  }

  if (!res.ok) {
    let msg;
    if (res.status === 409) {
      msg = 'Still answering the previous question';
    } else if (res.status === 429) {
      msg = 'Slow down a little';
    } else if (res.status === 401) {
      msg = 'Session expired, re-analyze the document';
    } else {
      const data = await res.json().catch(() => ({}));
      msg = data.error || data.detail || `Chat request failed with status ${res.status}`;
    }
    const err = new LocalAiChatError(res.status, msg);
    onError?.(err);
    throw err;
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // If not a streaming body (e.g. test environment polyfill)
    const text = await res.text();
    const state = { buffer: '' };
    const events = parseSseChunk(text, state);
    let totalChars = 0;
    for (const ev of events) {
      if (ev.event === 'sources') {
        onSources?.(ev.data?.sources || ev.data);
      } else if (ev.event === 'token') {
        const tokenText = ev.data?.text ?? '';
        if (totalChars + tokenText.length > MAX_ANSWER_CHARS) {
          const allowed = MAX_ANSWER_CHARS - totalChars;
          if (allowed > 0) {
            onToken?.(tokenText.slice(0, allowed));
            totalChars += allowed;
          }
          break;
        } else {
          onToken?.(tokenText);
          totalChars += tokenText.length;
        }
      } else if (ev.event === 'done') {
        onDone?.(ev.data?.stats || ev.data);
      } else if (ev.event === 'error') {
        onError?.(new LocalAiChatError(500, ev.data?.message || 'Streaming error'));
      }
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const sseState = { buffer: '' };
  let totalChars = 0;
  let capped = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parseSseChunk(chunk, sseState);

      for (const ev of events) {
        if (ev.event === 'sources') {
          onSources?.(ev.data?.sources || ev.data);
        } else if (ev.event === 'token') {
          if (capped) continue;
          const tokenText = ev.data?.text ?? '';
          if (totalChars + tokenText.length >= MAX_ANSWER_CHARS) {
            const allowed = Math.max(0, MAX_ANSWER_CHARS - totalChars);
            if (allowed > 0) {
              onToken?.(tokenText.slice(0, allowed));
              totalChars += allowed;
            }
            capped = true;
            try {
              await reader.cancel();
            } catch (_) {}
            break;
          } else {
            onToken?.(tokenText);
            totalChars += tokenText.length;
          }
        } else if (ev.event === 'done') {
          onDone?.(ev.data?.stats || ev.data);
        } else if (ev.event === 'error') {
          const err = new LocalAiChatError(500, ev.data?.message || 'Streaming error');
          onError?.(err);
          try {
            await reader.cancel();
          } catch (_) {}
          return;
        }
      }

      if (capped) {
        break;
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return;
    }
    onError?.(err);
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }
}
