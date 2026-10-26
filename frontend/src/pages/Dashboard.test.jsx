import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Dashboard } from './Dashboard.jsx';
import { SocketContext } from '../realtime/SocketContext.jsx';

// Mock useAuth for Dashboard and Layout
vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { displayName: 'Alice', email: 'alice@example.com' },
    status: 'authed',
    logout: vi.fn()
  })
}));

describe('Dashboard Component Tests', () => {
  const originalFetch = globalThis.fetch;
  let socketListeners = {};

  const createMockSocketContext = () => {
    socketListeners = {};
    return {
      connected: true,
      on: vi.fn((event, handler) => {
        if (!socketListeners[event]) {
          socketListeners[event] = [];
        }
        socketListeners[event].push(handler);
        return () => {
          socketListeners[event] = socketListeners[event].filter((h) => h !== handler);
        };
      }),
      socket: null
    };
  };

  const emitSocket = (event, payload) => {
    if (socketListeners[event]) {
      act(() => {
        socketListeners[event].forEach((fn) => fn(payload));
      });
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles 'document:sealed' event by adding a row, bumping bell badge, and showing toast", async () => {
    const mockSocket = createMockSocketContext();

    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/documents/sent') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: [] })
        };
      }
      if (url === '/api/documents/received') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            documents: [
              {
                id: 'doc-init-1',
                originalName: 'existing_contract.pdf',
                sender: 'Charlie',
                sizeBytes: 2048,
                status: 'sealed',
                createdAt: new Date().toISOString(),
                policy: { oneTimeUse: false }
              }
            ]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(
      <SocketContext.Provider value={mockSocket}>
        <Dashboard />
      </SocketContext.Provider>
    );

    // Initial document loads
    expect(await screen.findByText('existing_contract.pdf')).toBeTruthy();

    // Verify unread badge is not present initially
    expect(screen.queryByTestId('unread-badge')).toBeNull();

    // Emit live 'document:sealed' event
    emitSocket('document:sealed', {
      documentId: 'doc-live-100',
      originalName: 'top_secret_plans.pdf',
      senderName: 'Bob Ross',
      sizeBytes: 5242880,
      mimeType: 'application/pdf',
      createdAt: new Date().toISOString(),
      oneTimeUse: true,
      hasGeofence: false
    });

    // 1. Live row is added to the Received table
    expect(await screen.findByText('top_secret_plans.pdf')).toBeTruthy();
    expect(screen.getByText('Bob Ross')).toBeTruthy();

    // 2. Bell badge is bumped
    const badge = await screen.findByTestId('unread-badge');
    expect(badge.textContent).toBe('1');

    // 3. Toast notification appears with expected message
    expect(screen.getByText('Bob Ross sent you top_secret_plans.pdf')).toBeTruthy();
  });

  it('ignores duplicate incoming document events with the same documentId', async () => {
    const mockSocket = createMockSocketContext();

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ documents: [] })
    }));

    render(
      <SocketContext.Provider value={mockSocket}>
        <Dashboard />
      </SocketContext.Provider>
    );

    await screen.findByText(/No documents have been received yet/i);

    const liveDoc = {
      documentId: 'dup-id-123',
      originalName: 'unique_spec.pdf',
      senderName: 'Dave',
      sizeBytes: 1024,
      createdAt: new Date().toISOString()
    };

    // Emit first time
    emitSocket('document:sealed', liveDoc);
    expect(await screen.findByText('unique_spec.pdf')).toBeTruthy();

    // Emit second time with identical ID
    emitSocket('document:sealed', liveDoc);

    // Row should exist exactly once in DOM
    const matchingRows = screen.getAllByText('unique_spec.pdf');
    expect(matchingRows.length).toBe(1);
  });

  it('refetches documents when socket reconnects', async () => {
    const mockSocket = createMockSocketContext();
    let fetchCount = 0;

    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/documents/sent' || url === '/api/documents/received') {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: [] })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(
      <SocketContext.Provider value={mockSocket}>
        <Dashboard />
      </SocketContext.Provider>
    );

    await waitFor(() => {
      // 1 fetch for sent + 1 fetch for received = 2 fetches
      expect(fetchCount).toBe(2);
    });

    // Simulate socket reconnect event
    emitSocket('connect');

    await waitFor(() => {
      // Refetch happened: now total 4 fetches
      expect(fetchCount).toBe(4);
    });
  });
});
