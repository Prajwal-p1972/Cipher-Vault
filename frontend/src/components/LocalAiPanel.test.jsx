import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalAiPanel } from './LocalAiPanel.jsx';
import * as localAiApi from '../api/localAi.js';

describe('LocalAiPanel Component Tests', () => {
  const mockBlob = new Blob(['sample-data'], { type: 'application/pdf' });
  const mockSession = { sessionId: 'secret-session-id-999', token: 'secret-token-xyz-888' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders privacy notice and triggers analysis button flow', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 5,
      ocrPages: 2,
      chunkCount: 18,
      warnings: ['Page 2 has low contrast']
    });

    render(<LocalAiPanel blob={mockBlob} />);

    // Privacy notice
    expect(
      screen.getByText(/The decrypted file is sent only to 127.0.0.1 and is deleted from the AI service/i)
    ).toBeTruthy();

    const analyzeBtn = screen.getByRole('button', { name: /Analyze with local AI/i });
    expect(analyzeBtn).toBeTruthy();
    expect(analyzeBtn.disabled).toBe(false);

    fireEvent.click(analyzeBtn);

    // Shows indexed statistics
    expect(await screen.findByText('5')).toBeTruthy(); // pageCount
    expect(screen.getByText('2')).toBeTruthy(); // ocrPages
    expect(screen.getByText('18')).toBeTruthy(); // chunkCount
    expect(screen.getByText(/Page 2 has low contrast/i)).toBeTruthy();

    // Shows active ChatPanel once indexed
    expect(screen.getByRole('region', { name: /Local Document Chat/i })).toBeTruthy();
    expect(screen.getByText(/Ask Document Questions/i)).toBeTruthy();
  });

  it('renders offline troubleshooting instructions when service is offline', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: false, modelsReady: false });

    render(<LocalAiPanel blob={mockBlob} />);
    const analyzeBtn = screen.getByRole('button', { name: /Analyze with local AI/i });
    fireEvent.click(analyzeBtn);

    expect(await screen.findByText(/Local AI Service Unavailable/i)).toBeTruthy();
    expect(screen.getByText(/cd ai-service; \.\\\.venv\\Scripts\\activate; python run\.py/i)).toBeTruthy();
  });

  it('never leaks session token or session id into DOM, storage, or console', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log');
    const consoleWarnSpy = vi.spyOn(console, 'warn');
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');

    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 4,
      warnings: []
    });

    const { container } = render(<LocalAiPanel blob={mockBlob} />);
    const analyzeBtn = screen.getByRole('button', { name: /Analyze with local AI/i });
    fireEvent.click(analyzeBtn);

    await screen.findByText('4');

    // 1. Assert DOM purity
    expect(container.innerHTML).not.toContain('secret-token-xyz-888');
    expect(container.innerHTML).not.toContain('secret-session-id-999');

    // 2. Assert Storage purity
    expect(localStorageSpy).not.toHaveBeenCalled();

    // 3. Assert Console purity
    for (const spy of [consoleLogSpy, consoleWarnSpy, consoleErrorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('secret-token-xyz-888');
          expect(String(arg)).not.toContain('secret-session-id-999');
        }
      }
    }
  });
});
