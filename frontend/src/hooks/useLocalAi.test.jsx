import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalAi } from './useLocalAi.js';
import * as localAiApi from '../api/localAi.js';

describe('useLocalAi Hook Tests', () => {
  const mockBlob = new Blob(['sample-data'], { type: 'application/pdf' });
  const mockSession = { sessionId: 'sid-abc', token: 'tok-xyz' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes happy path: checking -> analyzing -> indexed with statistics', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 3,
      ocrPages: 0,
      chunkCount: 12,
      warnings: []
    });

    const { result } = renderHook(() => useLocalAi());

    expect(result.current.state).toBe('idle');
    expect(result.current.stats).toBeNull();
    expect(result.current.session).toBeNull();

    await act(async () => {
      await result.current.analyze(mockBlob);
    });

    expect(result.current.state).toBe('indexed');
    expect(result.current.stats).toEqual({
      pageCount: 3,
      ocrPages: 0,
      chunkCount: 12,
      warnings: []
    });
    expect(result.current.error).toBeNull();
    expect(result.current.session.sessionId).toBe('sid-abc');
  });

  it('transitions to offline state when health check fails', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: false, modelsReady: false });

    const { result } = renderHook(() => useLocalAi());

    await act(async () => {
      await result.current.analyze(mockBlob);
    });

    expect(result.current.state).toBe('offline');
    expect(result.current.error).toContain('offline');
    expect(result.current.stats).toBeNull();
  });

  it('transitions to offline state when modelsReady is false', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: false });

    const { result } = renderHook(() => useLocalAi());

    await act(async () => {
      await result.current.analyze(mockBlob);
    });

    expect(result.current.state).toBe('offline');
    expect(result.current.error).toContain('models are not downloaded');
  });

  it('maps 413, 415, and 422 errors into appropriate user-facing messages', async () => {
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);

    const testError = async (status, expectedMsg) => {
      vi.spyOn(localAiApi, 'ingestDocument').mockRejectedValueOnce(
        new localAiApi.LocalAiError(status, 'Raw error')
      );

      const { result } = renderHook(() => useLocalAi());

      await act(async () => {
        await result.current.analyze(mockBlob);
      });

      expect(result.current.state).toBe('error');
      expect(result.current.error).toBe(expectedMsg);
    };

    await testError(413, 'Document exceeds permitted size limit.');
    await testError(415, 'Unsupported document format.');
    await testError(422, 'Failed to extract text from document.');
  });

  it('reset() deletes the session and returns state to idle', async () => {
    const deleteSessionSpy = vi.spyOn(localAiApi, 'deleteSession').mockResolvedValue();
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });

    const { result } = renderHook(() => useLocalAi());

    await act(async () => {
      await result.current.analyze(mockBlob);
    });
    expect(result.current.state).toBe('indexed');

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.stats).toBeNull();
    expect(result.current.session).toBeNull();
    expect(deleteSessionSpy).toHaveBeenCalledWith(mockSession);
  });

  it('triggers deleteSession cleanup on hook unmount', async () => {
    const deleteSessionSpy = vi.spyOn(localAiApi, 'deleteSession').mockResolvedValue();
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });

    const { result, unmount } = renderHook(() => useLocalAi());

    await act(async () => {
      await result.current.analyze(mockBlob);
    });

    expect(result.current.state).toBe('indexed');

    unmount();

    expect(deleteSessionSpy).toHaveBeenCalledWith(mockSession);
  });

  it('triggers deleteSession on pagehide window event', async () => {
    const deleteSessionSpy = vi.spyOn(localAiApi, 'deleteSession').mockResolvedValue();
    vi.spyOn(localAiApi, 'checkHealth').mockResolvedValue({ online: true, modelsReady: true });
    vi.spyOn(localAiApi, 'createSession').mockResolvedValue(mockSession);
    vi.spyOn(localAiApi, 'ingestDocument').mockResolvedValue({
      docId: 'doc-1',
      pageCount: 1,
      ocrPages: 0,
      chunkCount: 2,
      warnings: []
    });

    const { result } = renderHook(() => useLocalAi());

    await act(async () => {
      await result.current.analyze(mockBlob);
    });

    // Simulate pagehide
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(deleteSessionSpy).toHaveBeenCalledWith(mockSession);
  });
});
