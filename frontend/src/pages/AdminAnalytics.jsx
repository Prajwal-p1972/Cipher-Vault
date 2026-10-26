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
            backgroundColor: '#ffffff',
            border: '1px solid #fed7aa',
            borderRadius: '8px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
          }}
        >
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>
            &#128274;
          </span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#9a3412', margin: '0 0 0.5rem 0' }}>
            Administrator Access Required
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
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
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.2,
        fill: true
      },
      {
        label: 'Failure',
        data: activityDays.map((d) => d.failure),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
        backgroundColor: '#ef4444'
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
        backgroundColor: ['#0284c7', '#10b981', '#f59e0b', '#ef4444']
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#0f172a' }}>
                System Analytics & Health
              </h2>
              <span
                style={{
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  textTransform: 'uppercase'
                }}
              >
                Admin
              </span>
            </div>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              System-wide aggregates and cryptographic audit chain verification. Never exposes individual user data.
            </p>
          </div>

          {/* Date Range Selector */}
          <div
            role="group"
            aria-label="Date range selector"
            style={{
              display: 'inline-flex',
              backgroundColor: '#e2e8f0',
              padding: '0.2rem',
              borderRadius: '6px'
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
                  padding: '0.35rem 0.85rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: days === num ? '#ffffff' : 'transparent',
                  color: days === num ? '#0f172a' : '#64748b',
                  boxShadow: days === num ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
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
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '0.85rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid #fecaca',
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
            <div style={metricValueStyle}>{systemOverview?.totals?.users ?? '—'}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Documents</div>
            <div style={metricValueStyle}>{systemOverview?.totals?.documents ?? '—'}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Events</div>
            <div style={metricValueStyle}>{systemOverview?.totals?.events ?? '—'}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Failed Events</div>
            <div style={{ ...metricValueStyle, color: '#ef4444' }}>
              {systemOverview?.totals?.failures ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Account Lockouts</div>
            <div style={{ ...metricValueStyle, color: '#ea580c' }}>
              {systemOverview?.lockouts?.count ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Token Reuses</div>
            <div style={{ ...metricValueStyle, color: '#dc2626' }}>
              {systemOverview?.tokenReuse?.count ?? '—'}
            </div>
          </div>
        </div>

        {/* Audit Chain Integrity Card */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '1.25rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>&#128279;</span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                Audit Chain Integrity
              </h3>
            </div>
            <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: '#475569' }}>
              Status:{' '}
              {chainHealth ? (
                <strong
                  style={{
                    color: chainHealth.valid ? '#16a34a' : '#dc2626'
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
                <span style={{ marginLeft: '0.75rem', color: '#64748b' }}>
                  ({chainHealth.checked} entries verified)
                </span>
              )}
              {chainHealth?.checkedAt && (
                <span style={{ marginLeft: '0.75rem', color: '#94a3b8', fontSize: '0.75rem' }}>
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
            className="btn btn-secondary"
            style={{
              padding: '0.45rem 1rem',
              fontSize: '0.85rem',
              width: 'auto',
              backgroundColor: '#f8fafc',
              borderColor: '#cbd5e1'
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
                scales: {
                  y: { beginAtZero: true, ticks: { precision: 0 } }
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
                scales: {
                  y: { beginAtZero: true, ticks: { precision: 0 } }
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
                maintainAspectRatio: false
              }}
            />
          </ChartCard>
        </div>
      </div>
    </Layout>
  );
}

const metricCardStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '1rem',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)'
};

const metricLabelStyle = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em'
};

const metricValueStyle = {
  fontSize: '1.4rem',
  fontWeight: 700,
  color: '#0f172a',
  marginTop: '0.35rem'
};

export default AdminAnalytics;
