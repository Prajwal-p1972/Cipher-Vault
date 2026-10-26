import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from './useChat.js';
import * as chatApi from '../api/localAiChat.js';

describe('useChat Hook Lifecycle & Security Tests', () => {
  const mockSession = { sessionId: 'sid-chat-hook', token: 'tok-chat-hook' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tokens accumulate into a single assistant message and sources attach correctly', async () => {
    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, question, callbacks) => {
      callbacks.onSources?.([{ page: 3, source: 'doc.pdf', score: 0.95 }]);
      callbacks.onToken?.('Hello ');
      callbacks.onToken?.('world!');
      callbacks.onDone?.({});
    });

    const { result } = renderHook(() => useChat(mockSession));

    await act(async () => {
      await result.current.ask('Hello?');
    });

    expect(result.current.messages.length).toBe(2);
    const userMsg = result.current.messages[0];
    const assistantMsg = result.current.messages[1];

    expect(userMsg.role).toBe('user');
    expect(userMsg.text).toBe('Hello?');

    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.text).toBe('Hello world!');
    expect(assistantMsg.sources).toEqual([{ page: 3, source: 'doc.pdf', score: 0.95 }]);
    expect(assistantMsg.streaming).toBe(false);
  });

  it('blocks double-send while a reply is actively streaming', async () => {
    let completeStream;
    vi.spyOn(chatApi, 'streamChat').mockImplementation(
      () =>
        new Promise((resolve) => {
          completeStream = resolve;
        })
    );

    const { result } = renderHook(() => useChat(mockSession));

    act(() => {
      result.current.ask('First question');
    });

    expect(result.current.isStreaming).toBe(true);

    // Attempt second ask while streaming
    await act(async () => {
      await result.current.ask('Second question');
    });

    // Messages should only have the first pair (user + assistant)
    expect(result.current.messages.length).toBe(2);
    expect(result.current.messages[0].text).toBe('First question');

    // Finish stream
    await act(async () => {
      completeStream();
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('maps 409, 429, 401, and offline errors to user-safe messages', async () => {
    // 409
    vi.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(
      new chatApi.LocalAiChatError(409, 'Still answering the previous question')
    );
    const { result } = renderHook(() => useChat(mockSession));

    await act(async () => {
      await result.current.ask('Question 1');
    });
    expect(result.current.error).toBe('Still answering the previous question');

    // 429
    vi.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(
      new chatApi.LocalAiChatError(429, 'Slow down a little')
    );
    await act(async () => {
      await result.current.ask('Question 2');
    });
    expect(result.current.error).toBe('Slow down a little');

    // 401
    vi.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(
      new chatApi.LocalAiChatError(401, 'Session expired, re-analyze the document')
    );
    await act(async () => {
      await result.current.ask('Question 3');
    });
    expect(result.current.error).toBe('Session expired, re-analyze the document');

    // Offline / status 0
    vi.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(
      new chatApi.LocalAiChatError(0, 'Connection failed')
    );
    await act(async () => {
      await result.current.ask('Question 4');
    });
    expect(result.current.error).toContain('Local AI service is offline. Please start Ollama and run `ollama pull llama3`.');
  });

  it('aborts active streaming request upon unmount', () => {
    let passedSignal;
    vi.spyOn(chatApi, 'streamChat').mockImplementation((session, q, callbacks) => {
      passedSignal = callbacks.signal;
      return new Promise(() => {}); // never resolves
    });

    const { result, unmount } = renderHook(() => useChat(mockSession));

    act(() => {
      result.current.ask('Test prompt');
    });

    expect(passedSignal).toBeDefined();
    expect(passedSignal.aborted).toBe(false);

    unmount();

    expect(passedSignal.aborted).toBe(true);
  });

  it('strictly never writes questions, tokens, or sessions to localStorage, sessionStorage, or console', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLogSpy = vi.spyOn(console, 'log');

    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onToken?.('SuperSecretContent');
      callbacks.onDone?.({});
    });

    const { result } = renderHook(() => useChat(mockSession));

    await act(async () => {
      await result.current.ask('Classified query');
    });

    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
