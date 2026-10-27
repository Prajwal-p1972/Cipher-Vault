import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatPanel } from './ChatPanel.jsx';
import * as chatApi from '../api/localAiChat.js';

describe('ChatPanel Component Security & Interaction Tests', () => {
  const mockSession = { sessionId: 'sid-chat-panel', token: 'tok-chat-panel' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders malicious model answer containing HTML and markdown as inert plain text', async () => {
    const maliciousPayload = '<img src=x onerror=alert(1)> and [click](http://evil)';

    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onToken?.(maliciousPayload);
      callbacks.onDone?.({});
    });

    render(<ChatPanel session={mockSession} />);

    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'Trigger injection' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/<img src=x onerror=alert\(1\)> and \[click\]\(http:\/\/evil\)/).length).toBeGreaterThanOrEqual(1);
    });

    // Verify absolutely no <img> tag or <a> tag was rendered into the DOM
    const imgElement = document.querySelector('img');
    const anchorElement = document.querySelector('a');
    expect(imgElement).toBeNull();
    expect(anchorElement).toBeNull();
  });

  it('renders page chips derived strictly from the verified sources SSE event', async () => {
    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onSources?.([
        { page: 2, source: 'report.pdf', score: 0.88 },
        { page: 7, source: 'report.pdf', score: 0.92 }
      ]);
      callbacks.onToken?.('Contextual answer from the file.');
      callbacks.onDone?.({});
    });

    render(<ChatPanel session={mockSession} />);

    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'Where is the data?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Contextual answer from the file.').length).toBeGreaterThanOrEqual(1);
    });

    const chips = screen.getAllByTestId('page-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('p.2');
    expect(chips[1].textContent).toBe('p.7');
  });

  it('Enter triggers submit while Shift+Enter inserts a newline', () => {
    const streamSpy = vi.spyOn(chatApi, 'streamChat').mockImplementation(() => new Promise(() => {}));

    render(<ChatPanel session={mockSession} />);
    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);

    // 1. Shift+Enter: does NOT submit
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(streamSpy).not.toHaveBeenCalled();

    // 2. Enter: DOES submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(streamSpy).toHaveBeenCalledWith(
      mockSession,
      'Line 1',
      expect.any(Object)
    );
  });

  it('Clear chat button invokes history DELETE endpoint on the local AI service', async () => {
    const clearHistorySpy = vi.spyOn(chatApi, 'clearHistory').mockResolvedValue();
    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onToken?.('Existing conversation answer');
      callbacks.onDone?.({});
    });

    render(<ChatPanel session={mockSession} />);

    // Populate a message
    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'Question for clear test' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Existing conversation answer').length).toBeGreaterThanOrEqual(1);
    });

    // Click Clear chat
    const clearBtn = screen.getByRole('button', { name: /Clear chat/i });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(clearHistorySpy).toHaveBeenCalledWith(mockSession);
      expect(screen.queryAllByText('Existing conversation answer').length).toBe(0);
    });
  });

  it('deduplicates page chips when sources contain multiple chunks from the same page', async () => {
    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onSources?.([
        { page: 4, source: 'spec.pdf', score: 0.95 },
        { page: 4, source: 'spec.pdf', score: 0.85 },
        { page: 9, source: 'spec.pdf', score: 0.75 }
      ]);
      callbacks.onToken?.('Answer referencing page 4 multiple times.');
      callbacks.onDone?.({});
    });

    render(<ChatPanel session={mockSession} />);
    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'Explain section 4' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Answer referencing page 4 multiple times.').length).toBeGreaterThanOrEqual(1);
    });

    const chips = screen.getAllByTestId('page-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('p.4');
    expect(chips[1].textContent).toBe('p.9');
  });

  it('Summarize document and Detailed summary buttons send the correct modes and question text', async () => {
    const streamSpy = vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onToken?.('Summary result.');
      callbacks.onDone?.({});
    });

    render(<ChatPanel session={mockSession} />);

    // 1. Click "Summarize document"
    const summaryBtn = screen.getByRole('button', { name: /Summarize document/i });
    fireEvent.click(summaryBtn);

    expect(streamSpy).toHaveBeenCalledWith(
      mockSession,
      'Summarize document',
      expect.objectContaining({ mode: 'summary' })
    );

    await waitFor(() => {
      expect(screen.getAllByText('Summary result.').length).toBeGreaterThanOrEqual(1);
    });

    // 2. Click "Detailed summary"
    const detailedBtn = screen.getByRole('button', { name: /Detailed summary/i });
    fireEvent.click(detailedBtn);

    expect(streamSpy).toHaveBeenCalledWith(
      mockSession,
      'Detailed summary of document',
      expect.objectContaining({ mode: 'detailed' })
    );
  });

  it('renders progress indicator when progress SSE events are received and finalText replaces streamed text', async () => {
    let capturedCallbacks;
    vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      capturedCallbacks = callbacks;
    });

    render(<ChatPanel session={mockSession} />);

    const detailedBtn = screen.getByRole('button', { name: /Detailed summary/i });
    fireEvent.click(detailedBtn);

    // Emit progress event
    await waitFor(() => {
      expect(capturedCallbacks).toBeDefined();
    });

    capturedCallbacks.onProgress?.({ step: 2, of: 5 });

    await waitFor(() => {
      const progressEl = screen.getByTestId('summary-progress');
      expect(progressEl.textContent).toBe('Summarizing... step 2 of 5');
    });

    // Stream initial tokens
    capturedCallbacks.onToken?.('Draft stream text');

    await waitFor(() => {
      expect(screen.getAllByText(/Draft stream text/).length).toBeGreaterThanOrEqual(1);
    });

    // Complete with finalText
    capturedCallbacks.onDone?.({ finalText: 'Polished sanitized final text.' });

    await waitFor(() => {
      expect(screen.queryByText('Draft stream text')).toBeNull();
      expect(screen.getAllByText('Polished sanitized final text.').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByTestId('summary-progress')).toBeNull();
    });
  });

  it('auto-detects typed questions and preserves zero storage/console leakage', async () => {
    const streamSpy = vi.spyOn(chatApi, 'streamChat').mockImplementation(async (session, q, callbacks) => {
      callbacks.onToken?.('Regular answer');
      callbacks.onDone?.({ finalText: 'Regular answer' });
    });

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLogSpy = vi.spyOn(console, 'log');

    render(<ChatPanel session={mockSession} />);

    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'what is this pdf about' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    expect(streamSpy).toHaveBeenCalledWith(
      mockSession,
      'what is this pdf about',
      expect.objectContaining({ mode: 'auto' })
    );

    await waitFor(() => {
      expect(screen.getAllByText('Regular answer').length).toBeGreaterThanOrEqual(1);
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

