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

  // Chart dark theme configuration
  const darkScales = {
    y: {
      beginAtZero: true,
      ticks: { color: '#94a3b8', precision: 0 },
      grid: { color: 'rgba(51, 65, 85, 0.4)' }
    },
    x: {
      ticks: { color: '#94a3b8' },
      grid: { color: 'rgba(51, 65, 85, 0.2)' }
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
              <span style={{ fontSize: '1.4rem' }}>📊</span>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.45rem',
                  fontWeight: 800,
                  color: '#f8fafc',
                  letterSpacing: '-0.02em',
                  textShadow: '0 0 16px rgba(56, 189, 248, 0.45)'
                }}
              >
                My Activity & Analytics
              </h2>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.875rem', color: '#94a3b8' }}>
              Private overview of your document operations and security events.
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

        {/* Global Error Notice */}
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
            <div style={{ ...metricValueStyle, color: '#38bdf8', textShadow: '0 0 14px rgba(56, 189, 248, 0.35)' }}>
              {overview?.totals?.events ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Failed Operations</div>
            <div style={{ ...metricValueStyle, color: '#f43f5e', textShadow: '0 0 14px rgba(244, 63, 94, 0.35)' }}>
              {overview?.totals?.failures ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Documents Sent</div>
            <div style={{ ...metricValueStyle, color: '#34d399', textShadow: '0 0 14px rgba(52, 211, 153, 0.35)' }}>
              {overview?.totals?.documentsSent ?? '—'}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Documents Received</div>
            <div style={{ ...metricValueStyle, color: '#a78bfa', textShadow: '0 0 14px rgba(167, 139, 250, 0.35)' }}>
              {overview?.totals?.documentsReceived ?? '—'}
            </div>
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
                scales: darkScales,
                plugins: {
                  legend: darkLegend
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
                scales: darkScales,
                plugins: {
                  legend: darkLegend
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
                scales: darkScales,
                plugins: {
                  legend: darkLegend
                }
              }}
            />
          </ChartCard>
        </div>

        {/* Recent Events Table */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(10, 15, 29, 0.96) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.22)',
            borderRadius: '12px',
            padding: '1.25rem',
            boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.75), 0 0 16px rgba(56, 189, 248, 0.08)'
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
              Recent Events
            </h3>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
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
                  <tr style={{ borderBottom: '2px solid rgba(56, 189, 248, 0.25)', color: '#94a3b8' }}>
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
                        borderBottom: '1px solid rgba(51, 65, 85, 0.45)'
                      }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', color: '#94a3b8' }}>
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: '#f8fafc' }}>
                        {ev.action}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor: ev.outcome === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: ev.outcome === 'success' ? '#34d399' : '#f87171',
                            border: `1px solid ${ev.outcome === 'success' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`
                          }}
                        >
                          {ev.outcome}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#cbd5e1' }}>
                        {ev.resourceKind || '—'}
                      </td>
                      <td
                        style={{
                          padding: '0.6rem 0.75rem',
                          fontFamily: 'ui-monospace, monospace',
                          color: '#38bdf8',
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
                className="btn btn-secondary btn-3d-cyber"
                style={{
                  padding: '0.5rem 1.5rem',
                  fontSize: '0.85rem',
                  width: 'auto',
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#f8fafc'
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

export default Analytics;
