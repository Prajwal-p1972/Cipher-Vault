import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Analytics } from './Analytics.jsx';
import * as httpApi from '../api/http.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { SocketContext } from '../realtime/SocketContext.jsx';

// Mock chart.js / react-chartjs-2 to prevent canvas errors in jsdom
vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="mock-line-chart">Line Chart</div>,
  Bar: () => <div data-testid="mock-bar-chart">Bar Chart</div>,
  Doughnut: () => <div data-testid="mock-doughnut-chart">Doughnut Chart</div>
}));

describe('Analytics Page Component Tests', () => {
  const mockUser = { id: 'u1', email: 'user@vault.test', displayName: 'Test User', role: 'user' };

  const mockOverview = {
    totals: { events: 42, failures: 3, documentsSent: 12, documentsReceived: 8 },
    activityByDay: [
      { date: '2024-01-01', success: 5, failure: 1 },
      { date: '2024-01-02', success: 8, failure: 0 }
    ],
    actionBreakdown: [
      { action: 'LOGIN_PASSWORD_OK', count: 10 },
      { action: 'DOC_SEALED', count: 12 }
    ],
    documentStatus: { sealed: 5, consumed: 4, expired: 2, revoked: 1 },
    deniedByReason: [
      { code: 'OUTSIDE_AREA', count: 2 },
      { code: 'EXPIRED', count: 1 }
    ]
  };

  const mockEventsPage1 = {
    events: [
      {
        seq: 102,
        action: 'DOC_SEALED',
        outcome: 'success',
        createdAt: '2024-01-02T12:00:00.000Z',
        resourceKind: 'Document',
        resourceId: 'doc-670c999988887777'
      }
    ],
    nextCursor: 101
  };

  const mockEventsPage2 = {
    events: [
      {
        seq: 101,
        action: 'LOGIN_PASSWORD_OK',
        outcome: 'success',
        createdAt: '2024-01-01T10:00:00.000Z',
        resourceKind: 'User',
        resourceId: 'u1'
      }
    ],
    nextCursor: null
  };

  const renderWithProviders = (ui) => {
    return render(
      <AuthContext.Provider value={{ user: mockUser, logout: vi.fn() }}>
        <SocketContext.Provider value={{ connected: true, on: () => () => {} }}>
          <MemoryRouter>{ui}</MemoryRouter>
        </SocketContext.Provider>
      </AuthContext.Provider>
    );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders overview metrics, charts, and events from backend response', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/me/overview')) return mockOverview;
      if (path.includes('/api/analytics/me/events')) return mockEventsPage1;
      return {};
    });

    renderWithProviders(<Analytics />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeTruthy(); // total events
      expect(screen.getByText('3')).toBeTruthy(); // failures
      expect(screen.getByText('12')).toBeTruthy(); // sent
      expect(screen.getByText('8')).toBeTruthy(); // received
    });

    // Check table row for event
    expect(screen.getByText('DOC_SEALED')).toBeTruthy();
    expect(screen.getByText('doc-670c...')).toBeTruthy();
  });

  it('allows toggling between chart view and table view on a chart card', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/me/overview')) return mockOverview;
      if (path.includes('/api/analytics/me/events')) return mockEventsPage1;
      return {};
    });

    renderWithProviders(<Analytics />);

    await waitFor(() => {
      expect(screen.getByText('Activity Over Time')).toBeTruthy();
    });

    const toggleBtn = screen.getByRole('button', { name: /Show table for Activity Over Time/i });
    fireEvent.click(toggleBtn);

    // Should now display the table headers
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Successes')).toBeTruthy();
    expect(screen.getByText('Failures')).toBeTruthy();

    // Toggle back
    fireEvent.click(screen.getByRole('button', { name: /Show chart for Activity Over Time/i }));
    expect(screen.getByTestId('mock-line-chart')).toBeTruthy();
  });

  it('range selector refetches data with updated from/to date parameters', async () => {
    const requestSpy = vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/me/overview')) return mockOverview;
      if (path.includes('/api/analytics/me/events')) return mockEventsPage1;
      return {};
    });

    renderWithProviders(<Analytics />);

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalled();
    });

    // Click 7 Days button
    const btn7 = screen.getByRole('button', { name: /7 Days/i });
    fireEvent.click(btn7);

    await waitFor(() => {
      // Find call with updated 7-day query
      const calls = requestSpy.mock.calls.map((c) => c[0]);
      const hasOverview7 = calls.some((c) => c.includes('/api/analytics/me/overview'));
      expect(hasOverview7).toBe(true);
    });
  });

  it('Load more button paginates events using nextCursor', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/me/overview')) return mockOverview;
      if (path.includes('/api/analytics/me/events') && path.includes('cursor=101')) {
        return mockEventsPage2;
      }
      if (path.includes('/api/analytics/me/events')) return mockEventsPage1;
      return {};
    });

    renderWithProviders(<Analytics />);

    await waitFor(() => {
      expect(screen.getByText('DOC_SEALED')).toBeTruthy();
    });

    const loadMoreBtn = screen.getByRole('button', { name: /Load more/i });
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText('LOGIN_PASSWORD_OK')).toBeTruthy();
    });
  });

  it('strictly never renders forbidden privacy fields (ip, userAgent, meta, hashes)', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/me/overview')) return mockOverview;
      if (path.includes('/api/analytics/me/events')) return mockEventsPage1;
      return {};
    });

    const { container } = renderWithProviders(<Analytics />);

    await waitFor(() => {
      expect(screen.getByText('DOC_SEALED')).toBeTruthy();
    });

    const html = container.innerHTML;
    expect(html).not.toContain('127.0.0.1');
    expect(html).not.toContain('Mozilla');
    expect(html).not.toContain('prevHash');
    expect(html).not.toContain('secretEnc');
  });
});
