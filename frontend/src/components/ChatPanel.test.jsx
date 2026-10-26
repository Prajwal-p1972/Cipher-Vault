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
});
