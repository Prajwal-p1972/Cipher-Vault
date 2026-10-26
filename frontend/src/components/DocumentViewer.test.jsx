import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentViewer } from './DocumentViewer.jsx';
import * as localAiApi from '../api/localAi.js';
import * as chatApi from '../api/localAiChat.js';

describe('DocumentViewer Integration Tests', () => {
  const mockBlob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const mockSession = { sessionId: 'sid-viewer-test', token: 'tok-viewer-test' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closing the viewer deletes the AI session before the object URL is revoked', async () => {
    const callOrder = [];

    // Spy on URL creation/revocation
    const createObjectURLMock = vi.fn(() => 'blob:http://localhost:3000/mock-viewer-doc');
    const revokeObjectURLMock = vi.fn((url) => {
      callOrder.push('revokeObjectURL');
    });

    Object.assign(URL, {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock
    });

    // Spy on AI session creation and deletion
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });
    vi.spyOn(localAiApi, 'deleteSession').mockImplementation(async (session) => {
      callOrder.push('deleteSession');
    });

    const onClose = vi.fn();

    render(
      <DocumentViewer
        blob={mockBlob}
        contentType="application/pdf"
        originalName="contract.pdf"
        onClose={onClose}
      />
    );

    // 1. Trigger AI indexing to establish an active in-memory session
    const analyzeBtn = screen.getByRole('button', { name: /Analyze with local AI/i });
    fireEvent.click(analyzeBtn);

    // Wait until indexed
    await screen.findByText('2'); // chunk count

    // 2. Click Close Viewer
    const closeBtn = screen.getByRole('button', { name: /Close Viewer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // 3. Assert exact call order: deleteSession MUST occur BEFORE revokeObjectURL
    expect(callOrder).toEqual(['deleteSession', 'revokeObjectURL']);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost:3000/mock-viewer-doc');
  });

  it('unmounting the viewer deletes the AI session before the object URL is revoked', async () => {
    const callOrder = [];

    const createObjectURLMock = vi.fn(() => 'blob:http://localhost:3000/mock-viewer-unmount');
    const revokeObjectURLMock = vi.fn((url) => {
      callOrder.push('revokeObjectURL');
    });

    Object.assign(URL, {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock
    });

    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });
    vi.spyOn(localAiApi, 'deleteSession').mockImplementation(async (session) => {
      callOrder.push('deleteSession');
    });

    const { unmount } = render(
      <DocumentViewer
        blob={mockBlob}
        contentType="application/pdf"
        originalName="contract.pdf"
        onClose={vi.fn()}
      />
    );

    const analyzeBtn = screen.getByRole('button', { name: /Analyze with local AI/i });
    fireEvent.click(analyzeBtn);

    await screen.findByText('2');

    unmount();

    expect(callOrder).toEqual(['deleteSession', 'revokeObjectURL']);
  });

  it('closing the viewer aborts active chat, deletes the AI session, THEN revokes the URL', async () => {
    const callOrder = [];

    const createObjectURLMock = vi.fn(() => 'blob:http://localhost:3000/mock-viewer-chat-close');
    const revokeObjectURLMock = vi.fn(() => {
      callOrder.push('revokeObjectURL');
    });

    Object.assign(URL, {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock
    });

    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });
    vi.spyOn(localAiApi, 'deleteSession').mockImplementation(async () => {
      callOrder.push('deleteSession');
    });

    // Spy on streamChat to capture the abort event
    vi.spyOn(chatApi, 'streamChat').mockImplementation((session, q, callbacks) => {
      callbacks.signal?.addEventListener('abort', () => {
        callOrder.push('abortChat');
      });
      return new Promise(() => {}); // hold streaming open
    });

    const onClose = vi.fn();
    render(
      <DocumentViewer
        blob={mockBlob}
        contentType="application/pdf"
        originalName="contract.pdf"
        onClose={onClose}
      />
    );

    // 1. Analyze to get into indexed state
    fireEvent.click(screen.getByRole('button', { name: /Analyze with local AI/i }));
    await screen.findByText('2');

    // 2. Start a chat stream
    const textarea = screen.getByPlaceholderText(/Ask a question about this document/i);
    fireEvent.change(textarea, { target: { value: 'Streaming question' } });
    fireEvent.click(screen.getByRole('button', { name: /Send question/i }));

    // Stop button should now be visible indicating active stream
    await screen.findByRole('button', { name: /Stop generation/i });

    // 3. Close the viewer
    const closeBtn = screen.getByRole('button', { name: /Close Viewer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // 4. Verify call order: deleteSession occurs before revokeObjectURL, and active chat was aborted
    expect(callOrder).toContain('abortChat');
    expect(callOrder).toContain('deleteSession');
    expect(callOrder).toContain('revokeObjectURL');

    const deleteIndex = callOrder.indexOf('deleteSession');
    const revokeIndex = callOrder.indexOf('revokeObjectURL');
    expect(deleteIndex).toBeLessThan(revokeIndex);
  });
});
