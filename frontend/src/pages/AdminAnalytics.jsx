import React from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAdminAnalytics } from '../hooks/useAnalytics.js';
import { Layout } from '../components/Layout.jsx';
import { ChartCard } from '../components/charts/ChartCard.jsx';

/**
 * System-wide Administrator Analytics Dashboard.
 *
 * Privacy Guarantees:
 * - Contains SYSTEM-WIDE AGGREGATES ONLY.
 * - Zero access to individual users' events, emails, IPs, user agents, or document keys.
 * - Backend strictly enforces 403 for non-admin accounts.
 */
export function AdminAnalytics() {
  const { user } = useAuth();
  const {
    days,
    setDays,
    systemOverview,
    chainHealth,
    loading,
    chainLoading,
    error,
    isForbidden,
    verifyChainNow
  } = useAdminAnalytics(30);

  // Friendly 403 Gate
  if (user?.role !== 'admin' || isForbidden) {
    return (
      <Layout>
        <div
          role="alert"
          style={{
            maxWidth: '600px',
            margin: '2rem auto',
            padding: '2rem',
            background: 'linear-gradient(180deg, rgba(24, 18, 30, 0.95) 0%, rgba(15, 10, 20, 0.98) 100%)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(244, 63, 94, 0.15)'
          }}
        >
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>
            &#128274;
          </span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fb7185', margin: '0 0 0.5rem 0', textShadow: '0 0 12px rgba(244, 63, 94, 0.4)' }}>
            Administrator Access Required
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0 }}>
            System-wide analytics and audit chain verification are restricted to administrator accounts.
          </p>
        </div>
      </Layout>
    );
  }

  // 1. System Activity over time (Line)
  const activityDays = systemOverview?.activityByDay || [];
  const lineData = {
    labels: activityDays.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: 'Success',
        data: activityDays.map((d) => d.success),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        tension: 0.2,
        fill: true
      },
      {
        label: 'Failure',
        data: activityDays.map((d) => d.failure),
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244, 63, 94, 0.2)',
        tension: 0.2,
        fill: true
      }
    ]
  };

  const lineTable = {
    headers: ['Date', 'Successes', 'Failures'],
    rows: activityDays.map((d) => [d.date, d.success, d.failure])
  };

  // 2. Failures by Action (Bar)
  const failureItems = systemOverview?.failuresByAction || [];
  const failureData = {
    labels: failureItems.map((f) => f.action),
    datasets: [
      {
        label: 'Failures',
        data: failureItems.map((f) => f.count),
        backgroundColor: 'rgba(244, 63, 94, 0.85)',
        borderColor: '#f43f5e',
        borderWidth: 1
      }
    ]
  };

  const failureTable = {
    headers: ['Action', 'Failures'],
    rows: failureItems.map((f) => [f.action, f.count])
  };

  // 3. Document Status Breakdown (Doughnut)
  const docStatus = systemOverview?.documentStatus || {};
  const statusCounts = [
    docStatus.sealed || 0,
    docStatus.consumed || 0,
    docStatus.expired || 0,
    docStatus.revoked || 0
  ];
  const statusTotal = statusCounts.reduce((acc, c) => acc + c, 0);

  const doughnutData = {
    labels: ['Sealed', 'Consumed', 'Expired', 'Revoked'],
    datasets: [
      {
        data: statusCounts,
        backgroundColor: ['#0284c7', '#10b981', '#f59e0b', '#f43f5e'],
        borderColor: '#0f172a',
        borderWidth: 2
      }
    ]
  };

  const doughnutTable = {
    headers: ['Status', 'Count'],
    rows: [
      ['Sealed', docStatus.sealed || 0],
      ['Consumed', docStatus.consumed || 0],
      ['Expired', docStatus.expired || 0],
      ['Revoked', docStatus.revoked || 0]
    ]
  };

  const darkScales = {
    y: {
      beginAtZero: true,
      ticks: { color: '#94a3b8', precision: 0 },
      grid: { color: 'rgba(51, 65, 85, 0.45)' }
    },
    x: {
      ticks: { color: '#94a3b8' },
      grid: { color: 'rgba(51, 65, 85, 0.25)' }
    }
  };

  const darkLegend = {
    labels: { color: '#cbd5e1', boxWidth: 12, padding: 12 }
  };

  return (
    <Layout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Header & Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🛡️</span>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.45rem',
                  fontWeight: 800,
                  color: '#f8fafc',
                  letterSpacing: '-0.02em',
                  textShadow: '0 0 16px rgba(244, 63, 94, 0.45)'
                }}
              >
                System Analytics & Health
              </h2>
              <span
                style={{
                  backgroundColor: 'rgba(244, 63, 94, 0.15)',
                  color: '#fb7185',
                  border: '1px solid rgba(244, 63, 94, 0.35)',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                Admin
              </span>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.875rem', color: '#94a3b8' }}>
              System-wide aggregates and cryptographic audit chain verification. Never exposes individual user data.
            </p>
          </div>

          {/* Date Range Selector */}
          <div
            role="group"
            aria-label="Date range selector"
            style={{
              display: 'inline-flex',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              padding: '0.25rem',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
            }}
          >
            {[7, 30, 90].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setDays(num)}
                aria-pressed={days === num}
                style={{
                  border: 'none',
                  padding: '0.35rem 0.9rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: days === num ? '#0284c7' : 'transparent',
                  color: days === num ? '#ffffff' : '#94a3b8',
                  boxShadow: days === num ? '0 0 12px rgba(56, 189, 248, 0.45)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {num} Days
              </button>
            ))}
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div
            role="alert"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
              padding: '0.85rem 1.25rem',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              fontSize: '0.875rem'
            }}
          >
            {error}
          </div>
        )}

        {/* Aggregate Totals & Security Counters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '1rem'
          }}
        >
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Users</div>
            <div style={{ ...metricValueStyle, color: '#38bdf8', textShadow: '0 0 14px rgba(56, 189, 248, 0.35)' }}>
              {systemOverview?.totals?.users ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Documents</div>
            <div style={{ ...metricValueStyle, color: '#34d399', textShadow: '0 0 14px rgba(52, 211, 153, 0.35)' }}>
              {systemOverview?.totals?.documents ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Events</div>
            <div style={{ ...metricValueStyle, color: '#a78bfa', textShadow: '0 0 14px rgba(167, 139, 250, 0.35)' }}>
              {systemOverview?.totals?.events ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Failed Events</div>
            <div style={{ ...metricValueStyle, color: '#f43f5e', textShadow: '0 0 14px rgba(244, 63, 94, 0.35)' }}>
              {systemOverview?.totals?.failures ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Account Lockouts</div>
            <div style={{ ...metricValueStyle, color: '#f59e0b', textShadow: '0 0 14px rgba(245, 158, 11, 0.35)' }}>
              {systemOverview?.lockouts?.count ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Token Reuses</div>
            <div style={{ ...metricValueStyle, color: '#f43f5e', textShadow: '0 0 14px rgba(244, 63, 94, 0.35)' }}>
              {systemOverview?.tokenReuse?.count ?? '—'}
            </div>
          </div>
        </div>

        {/* Audit Chain Integrity Card */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(10, 15, 29, 0.96) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.22)',
            borderRadius: '12px',
            padding: '1.25rem',
            boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.75), 0 0 16px rgba(56, 189, 248, 0.08)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🔗</span>
              <h3
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: '#f8fafc',
                  letterSpacing: '-0.01em',
                  textShadow: '0 0 12px rgba(56, 189, 248, 0.3)'
                }}
              >
                Audit Chain Integrity
              </h3>
            </div>
            <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: '#cbd5e1' }}>
              Status:{' '}
              {chainHealth ? (
                <strong
                  style={{
                    color: chainHealth.valid ? '#34d399' : '#f87171',
                    textShadow: `0 0 10px ${chainHealth.valid ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)'}`
                  }}
                >
                  {chainHealth.valid
                    ? 'Valid (Unbroken HMAC Hash Chain)'
                    : `Broken at Sequence #${chainHealth.brokenAtSeq}`}
                </strong>
              ) : (
                'Unchecked'
              )}
              {chainHealth?.checked !== undefined && (
                <span style={{ marginLeft: '0.75rem', color: '#94a3b8' }}>
                  ({chainHealth.checked} entries verified)
                </span>
              )}
              {chainHealth?.checkedAt && (
                <span style={{ marginLeft: '0.75rem', color: '#64748b', fontSize: '0.75rem' }}>
                  Checked at: {new Date(chainHealth.checkedAt).toLocaleTimeString()}
                  {chainHealth.cached && ' (cached)'}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={verifyChainNow}
            disabled={chainLoading}
            className="btn btn-secondary btn-3d-cyber"
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.85rem',
              width: 'auto',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#f8fafc'
            }}
          >
            {chainLoading ? 'Verifying...' : 'Verify now'}
          </button>
        </div>

        {/* Charts Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '1.25rem'
          }}
        >
          {/* Chart 1: System Activity Over Time */}
          <ChartCard
            title="System Activity Over Time"
            loading={loading}
            empty={activityDays.length === 0}
            summary={`System activity over the last ${days} days showing total successes and failures.`}
            tableData={lineTable}
          >
            <Line
              data={lineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: darkScales,
                plugins: {
                  legend: darkLegend
                }
              }}
            />
          </ChartCard>

          {/* Chart 2: Failures by Action */}
          <ChartCard
            title="Failures by Action"
            loading={loading}
            empty={failureItems.length === 0}
            summary="Distribution of failure events grouped by action type."
            tableData={failureTable}
          >
            <Bar
              data={failureData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: darkScales,
                plugins: {
                  legend: darkLegend
                }
              }}
            />
          </ChartCard>

          {/* Chart 3: System-Wide Document Status */}
          <ChartCard
            title="System Document Status"
            loading={loading}
            empty={statusTotal === 0}
            summary="System-wide document distribution across sealed, consumed, expired, and revoked states."
            tableData={doughnutTable}
          >
            <Doughnut
              data={doughnutData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: { color: '#cbd5e1', boxWidth: 12, padding: 12 }
                  }
                }
              }}
            />
          </ChartCard>
        </div>
      </div>
    </Layout>
  );
}

const metricCardStyle = {
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(10, 15, 29, 0.96) 100%)',
  border: '1px solid rgba(56, 189, 248, 0.22)',
  borderRadius: '12px',
  padding: '1.15rem 1.25rem',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.08)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)'
};

const metricLabelStyle = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

const metricValueStyle = {
  fontSize: '1.65rem',
  fontWeight: 800,
  color: '#f8fafc',
  marginTop: '0.35rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  letterSpacing: '-0.02em'
};

export default AdminAnalytics;
