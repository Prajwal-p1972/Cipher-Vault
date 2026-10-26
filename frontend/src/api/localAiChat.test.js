import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  llmStatus,
  clearHistory,
  parseSseChunk,
  streamChat,
  LocalAiChatError,
  MAX_ANSWER_CHARS
} from './localAiChat.js';

describe('localAiChat API Client & SSE Parser Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SSE parser handles split frames across chunks seamlessly', () => {
    const state = { buffer: '' };

    // Part 1: incomplete frame
    const events1 = parseSseChunk('event: token\ndata: {"te', state);
    expect(events1).toEqual([]);
    expect(state.buffer).toContain('data: {"te');

    // Part 2: completes the frame
    const events2 = parseSseChunk('xt":"hello"}\n\n', state);
    expect(events2).toEqual([{ event: 'token', data: { text: 'hello' } }]);
    expect(state.buffer).toBe('');
  });

  it('SSE parser processes multiple events in a single chunk and ignores unknown events', () => {
    const state = { buffer: '' };
    const chunk = [
      'event: sources\ndata: {"sources":[{"page":1,"source":"p1.pdf","score":0.9}]}\n\n',
      'event: unknown_event\ndata: {"foo":"bar"}\n\n',
      'event: token\ndata: {"text":"world"}\n\n',
      'event: done\ndata: {"stats":{"elapsed":1.2}}\n\n'
    ].join('');

    const events = parseSseChunk(chunk, state);
    expect(events.length).toBe(4);
    expect(events[0].event).toBe('sources');
    expect(events[1].event).toBe('unknown_event');
    expect(events[2].event).toBe('token');
    expect(events[3].event).toBe('done');
  });

  it('streamChat dispatches POST with correct URL, Authorization header, and question payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              const text = 'event: token\ndata: {"text":"Answer"}\n\nevent: done\ndata: {}\n\n';
              return { done: false, value: new TextEncoder().encode(text) };
            },
            releaseLock: vi.fn(),
            cancel: vi.fn()
          };
        }
      }
    });

    globalThis.fetch = fetchMock;

    const onToken = vi.fn();
    const onDone = vi.fn();

    await streamChat(
      { sessionId: 'test-sid', token: 'test-tok' },
      'What is this document about?',
      { onToken, onDone }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/v1/sessions/test-sid/chat');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ question: 'What is this document about?' });

    expect(onToken).toHaveBeenCalledWith('Answer');
    expect(onDone).toHaveBeenCalled();
  });

  it('streamChat halts streaming when AbortSignal fires', async () => {
    const cancelMock = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            // Wait forever until abort
            await new Promise((r) => setTimeout(r, 1000));
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn(),
          cancel: cancelMock
        })
      }
    });

    globalThis.fetch = fetchMock;

    const controller = new AbortController();
    const chatPromise = streamChat(
      { sessionId: 'test-sid', token: 'test-tok' },
      'Test question',
      { signal: controller.signal }
    );

    controller.abort();
    await chatPromise; // Should resolve/return cleanly upon abort
  });

  it('streamChat caps answer length at MAX_ANSWER_CHARS (20000) and cancels reader', async () => {
    const cancelMock = vi.fn();
    const longChunk = 'a'.repeat(15000);

    let callCount = 0;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            callCount++;
            if (callCount > 3) return { done: true, value: undefined };
            const payload = `event: token\ndata: {"text":"${longChunk}"}\n\n`;
            return { done: false, value: new TextEncoder().encode(payload) };
          },
          releaseLock: vi.fn(),
          cancel: cancelMock
        })
      }
    });

    globalThis.fetch = fetchMock;

    let receivedChars = 0;
    await streamChat(
      { sessionId: 'test-sid', token: 'test-tok' },
      'Give me a huge response',
      {
        onToken: (tok) => {
          receivedChars += tok.length;
        }
      }
    );

    expect(receivedChars).toBe(MAX_ANSWER_CHARS);
    expect(cancelMock).toHaveBeenCalled();
  });

  it('llmStatus reports offline when service does not respond', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const status = await llmStatus();
    expect(status).toEqual({ online: false, modelPresent: false, model: null });
  });

  it('clearHistory sends DELETE to /v1/sessions/:sid/history with Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = fetchMock;

    await clearHistory({ sessionId: 'sid-123', token: 'tok-abc' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/sessions/sid-123/history',
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer tok-abc' }
      }
    );
  });
});
