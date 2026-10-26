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

  it('SSE parser preserves leading-space, whitespace-only, and newline tokens', () => {
    const state = { buffer: '' };
    const raw = [
      'event: token\ndata: {"text":"According"}\n\n',
      'event: token\ndata: {"text":" to"}\n\n',
      'event: token\ndata: {"text":" the"}\n\n',
      'event: token\ndata: {"text":" doc"}\n\n',
      'event: token\ndata: {"text":"."}\n\n',
      'event: token\ndata: {"text":"\\n\\n"}\n\n',
      'event: token\ndata: {"text":"Next"}\n\n',
      'event: token\ndata: {"text":" line"}\n\n'
    ].join('');

    const events = parseSseChunk(raw, state);
    const tokens = events.filter((e) => e.event === 'token').map((e) => e.data.text);
    expect(tokens).toEqual(['According', ' to', ' the', ' doc', '.', '\n\n', 'Next', ' line']);
    expect(tokens.join('')).toBe('According to the doc.\n\nNext line');
  });

  it('SSE parser strips only ONE leading space after data: and preserves exact token whitespace', () => {
    const state = { buffer: '' };
    // "data: {"text":"one"}" -> 1 space stripped, valid JSON
    // "data:{"text":"two"}" -> 0 spaces stripped, valid JSON
    const chunk = 'data: {"text":"with space"}\n\ndata:{"text":"no space"}\n\n';
    const events = parseSseChunk(chunk, state);
    expect(events.length).toBe(2);
    expect(events[0].data).toEqual({ text: 'with space' });
    expect(events[1].data).toEqual({ text: 'no space' });
  });

  it('handles multi-byte UTF-8 sequences split across reader chunks without corruption', async () => {
    // UTF-8 for euro sign € is [0xE2, 0x82, 0xAC]
    // We stream: 'event: token\ndata: {"text":"Price: ' + [0xE2] then [0x82, 0xAC] + '100"}\n\n'
    const part1 = new TextEncoder().encode('event: token\ndata: {"text":"Price: ');
    const part2 = new Uint8Array([0xE2]); // first byte of 3-byte char
    const part3 = new Uint8Array([0x82, 0xAC]); // remaining 2 bytes
    const part4 = new TextEncoder().encode('100"}\n\nevent: done\ndata: {"finalText":"Price: €100"}\n\n');

    // Combine into 2 chunks
    const chunk1 = new Uint8Array(part1.length + part2.length);
    chunk1.set(part1, 0);
    chunk1.set(part2, part1.length);

    const chunk2 = new Uint8Array(part3.length + part4.length);
    chunk2.set(part3, 0);
    chunk2.set(part4, part3.length);

    let readCount = 0;
    const mockBody = {
      getReader: () => ({
        read: async () => {
          readCount++;
          if (readCount === 1) return { done: false, value: chunk1 };
          if (readCount === 2) return { done: false, value: chunk2 };
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn(),
        cancel: vi.fn()
      })
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockBody
    });

    const receivedTokens = [];
    let doneData = null;

    await streamChat(
      { sessionId: 'sid', token: 'tok' },
      'Price query',
      {
        onToken: (t) => receivedTokens.push(t),
        onDone: (d) => {
          doneData = d;
        }
      }
    );

    expect(receivedTokens.join('')).toBe('Price: €100');
    expect(doneData).toEqual({ finalText: 'Price: €100' });
  });
});
