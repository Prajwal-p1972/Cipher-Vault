import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminAnalytics } from './AdminAnalytics.jsx';
import * as httpApi from '../api/http.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { SocketContext } from '../realtime/SocketContext.jsx';

vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="mock-line-chart">Line Chart</div>,
  Bar: () => <div data-testid="mock-bar-chart">Bar Chart</div>,
  Doughnut: () => <div data-testid="mock-doughnut-chart">Doughnut Chart</div>
}));

describe('AdminAnalytics Page Component Tests', () => {
  const adminUser = { id: 'admin1', email: 'admin@vault.test', displayName: 'Admin User', role: 'admin' };
  const normalUser = { id: 'u1', email: 'user@vault.test', displayName: 'Normal User', role: 'user' };

  const mockSystemOverview = {
    totals: { users: 15, documents: 40, events: 120, failures: 7 },
    activityByDay: [{ date: '2024-01-01', success: 20, failure: 2 }],
    actionBreakdown: [{ action: 'DOC_SEALED', count: 40 }],
    failuresByAction: [{ action: 'LOGIN_FAILED', count: 5 }],
    lockouts: { count: 3 },
    tokenReuse: { count: 1 },
    documentStatus: { sealed: 15, consumed: 20, expired: 3, revoked: 2 }
  };

  const mockChainHealth = {
    valid: true,
    checked: 150,
    checkedAt: '2024-01-02T15:00:00.000Z',
    cached: false
  };

  const renderWithAuth = (ui, user = adminUser) => {
    return render(
      <AuthContext.Provider value={{ user, logout: vi.fn() }}>
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

  it('renders aggregate totals, security counters, and intact chain health for admin', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/system/overview')) return mockSystemOverview;
      if (path.includes('/api/analytics/system/chain')) return mockChainHealth;
      return {};
    });

    renderWithAuth(<AdminAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('15')).toBeTruthy(); // total users
      expect(screen.getByText('40')).toBeTruthy(); // total documents
      expect(screen.getByText('120')).toBeTruthy(); // total events
      expect(screen.getByText('3')).toBeTruthy(); // lockouts
      expect(screen.getByText('1')).toBeTruthy(); // token reuses
    });

    expect(screen.getByText(/Valid \(Unbroken HMAC Hash Chain\)/i)).toBeTruthy();
    expect(screen.getByText(/150 entries verified/i)).toBeTruthy();
  });

  it('displays friendly restricted access message when user is not admin', () => {
    renderWithAuth(<AdminAnalytics />, normalUser);

    expect(screen.getByText(/Administrator Access Required/i)).toBeTruthy();
    expect(screen.getByText(/System-wide analytics and audit chain verification are restricted/i)).toBeTruthy();
  });

  it('displays friendly restricted access message on 403 API response', async () => {
    vi.spyOn(httpApi, 'request').mockRejectedValue(
      new httpApi.ApiError(403, 'Forbidden: insufficient permissions')
    );

    renderWithAuth(<AdminAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/Administrator Access Required/i)).toBeTruthy();
    });
  });

  it('Verify now button triggers fresh audit chain integrity check', async () => {
    const requestSpy = vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/system/overview')) return mockSystemOverview;
      if (path.includes('/api/analytics/system/chain')) return mockChainHealth;
      return {};
    });

    renderWithAuth(<AdminAnalytics />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify now/i })).toBeTruthy();
    });

    const verifyBtn = screen.getByRole('button', { name: /Verify now/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      const chainCalls = requestSpy.mock.calls.filter((c) => c[0].includes('/api/analytics/system/chain'));
      expect(chainCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('displays broken audit chain status clearly when verification fails', async () => {
    vi.spyOn(httpApi, 'request').mockImplementation(async (path) => {
      if (path.includes('/api/analytics/system/overview')) return mockSystemOverview;
      if (path.includes('/api/analytics/system/chain')) {
        return {
          valid: false,
          checked: 45,
          brokenAtSeq: 12,
          checkedAt: '2024-01-02T15:00:00.000Z'
        };
      }
      return {};
    });

    renderWithAuth(<AdminAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/Broken at Sequence #12/i)).toBeTruthy();
    });
  });
});
