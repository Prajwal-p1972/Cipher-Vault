import React from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { useMyAnalytics } from '../hooks/useAnalytics.js';
import { Layout } from '../components/Layout.jsx';
import { ChartCard } from '../components/charts/ChartCard.jsx';

export const DENIAL_LABELS = {
  OUTSIDE_AREA: 'Outside Area',
  LOCATION_REQUIRED: 'Location Required',
  LOCATION_IMPRECISE: 'Location Imprecise',
  EXPIRED: 'Expired',
  CONSUMED: 'Already Consumed',
  INTEGRITY: 'Integrity Check Failed',
  MFA_REQUIRED: 'MFA Required',
  OTHER: 'Other Reason'
};

export function formatDenialCode(code) {
  if (!code) return 'Other';
  const upper = String(code).toUpperCase();
  return DENIAL_LABELS[upper] || upper;
}

export function formatShortId(id) {
  if (!id) return '—';
  const str = String(id);
  return str.length > 10 ? `${str.slice(0, 8)}...` : str;
}

/**
 * User Analytics Dashboard: renders activity trends, action distributions,
 * document statuses, access denials, and paginated audit events.
 */
export function Analytics() {
  const {
    days,
    setDays,
    overview,
    events,
    nextCursor,
    loading,
    eventsLoading,
    error,
    loadMoreEvents
  } = useMyAnalytics(30);

  // 1. Activity over time (Line)
  const activityDays = overview?.activityByDay || [];
  const lineData = {
    labels: activityDays.map((d) => d.date.slice(5)), // MM-DD
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

  // 2. Action Breakdown (Bar)
  const actionItems = overview?.actionBreakdown || [];
  const barData = {
    labels: actionItems.map((a) => a.action),
    datasets: [
      {
        label: 'Events',
        data: actionItems.map((a) => a.count),
        backgroundColor: '#0284c7'
      }
    ]
  };

  const barTable = {
    headers: ['Action', 'Count'],
    rows: actionItems.map((a) => [a.action, a.count])
  };

  // 3. Document Status (Doughnut)
  const docStatus = overview?.documentStatus || {};
  const statusLabels = ['sealed', 'consumed', 'expired', 'revoked'];
  const statusCounts = statusLabels.map((s) => docStatus[s] || 0);
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

  // 4. Access Denials by Reason (Bar)
  const denialItems = overview?.deniedByReason || [];
  const denialData = {
    labels: denialItems.map((d) => formatDenialCode(d.code)),
    datasets: [
      {
        label: 'Denials',
        data: denialItems.map((d) => d.count),
        backgroundColor: '#f43f5e'
      }
    ]
  };

  const denialTable = {
    headers: ['Denial Reason', 'Count'],
    rows: denialItems.map((d) => [formatDenialCode(d.code), d.count])
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
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#0f172a' }}>
              My Activity & Analytics
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Private overview of your document operations and security events.
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

        {/* Global Error Notice */}
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

        {/* Metrics Summary Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem'
          }}
        >
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Events</div>
            <div style={metricValueStyle}>{overview?.totals?.events ?? '—'}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Failed Operations</div>
            <div style={{ ...metricValueStyle, color: '#ef4444' }}>
              {overview?.totals?.failures ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Documents Sent</div>
            <div style={metricValueStyle}>{overview?.totals?.documentsSent ?? '—'}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Documents Received</div>
            <div style={metricValueStyle}>{overview?.totals?.documentsReceived ?? '—'}</div>
          </div>
        </div>

        {/* 2x2 Grid of Charts */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '1.25rem'
          }}
        >
          {/* Chart A: Activity Over Time */}
          <ChartCard
            title="Activity Over Time"
            loading={loading}
            empty={activityDays.length === 0}
            summary={`Activity over the last ${days} days showing daily success and failure counts.`}
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

          {/* Chart B: Actions Breakdown */}
          <ChartCard
            title="Actions Breakdown"
            loading={loading}
            empty={actionItems.length === 0}
            summary="Distribution of actions performed during the selected period."
            tableData={barTable}
          >
            <Bar
              data={barData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: { beginAtZero: true, ticks: { precision: 0 } }
                }
              }}
            />
          </ChartCard>

          {/* Chart C: Document Status */}
          <ChartCard
            title="My Documents by Status"
            loading={loading}
            empty={statusTotal === 0}
            summary="Status breakdown of documents sent by you: sealed, consumed, expired, or revoked."
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

          {/* Chart D: Access Denials */}
          <ChartCard
            title="Access Denials by Reason"
            loading={loading}
            empty={denialItems.length === 0}
            summary="Breakdown of document access denials by reason code."
            tableData={denialTable}
          >
            <Bar
              data={denialData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: { beginAtZero: true, ticks: { precision: 0 } }
                }
              }}
            />
          </ChartCard>
        </div>

        {/* Recent Events Table */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '1.25rem',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#1e293b' }}>
              Recent Events
            </h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Showing {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          </div>

          {events.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '1rem 0' }}>
              No recent activity recorded.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.85rem',
                  textAlign: 'left'
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.65rem 0.75rem' }}>Time</th>
                    <th style={{ padding: '0.65rem 0.75rem' }}>Action</th>
                    <th style={{ padding: '0.65rem 0.75rem' }}>Outcome</th>
                    <th style={{ padding: '0.65rem 0.75rem' }}>Resource Kind</th>
                    <th style={{ padding: '0.65rem 0.75rem' }}>Resource ID</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr
                      key={ev.seq}
                      style={{
                        borderBottom: '1px solid #f1f5f9'
                      }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', color: '#64748b' }}>
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500, color: '#1e293b' }}>
                        {ev.action}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            backgroundColor: ev.outcome === 'success' ? '#ecfdf5' : '#fef2f2',
                            color: ev.outcome === 'success' ? '#065f46' : '#991b1b'
                          }}
                        >
                          {ev.outcome}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#64748b' }}>
                        {ev.resourceKind || '—'}
                      </td>
                      <td
                        style={{
                          padding: '0.6rem 0.75rem',
                          fontFamily: 'monospace',
                          color: '#475569',
                          fontSize: '0.8rem'
                        }}
                      >
                        {formatShortId(ev.resourceId)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor !== null && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button
                type="button"
                onClick={loadMoreEvents}
                disabled={eventsLoading}
                className="btn btn-secondary"
                style={{
                  padding: '0.45rem 1.25rem',
                  fontSize: '0.85rem',
                  width: 'auto'
                }}
              >
                {eventsLoading ? 'Loading more...' : 'Load more'}
              </button>
            </div>
          )}
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

export default Analytics;
