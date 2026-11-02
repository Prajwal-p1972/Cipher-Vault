import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { request } from '../api/http.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export function AuditDashboard() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchLogs = async () => {
      try {
        const data = await request('/api/audit/me');
        if (isMounted) {
          setLogs(data?.logs || []);
        }
      } catch (error) {
        console.error('Failed to fetch audit logs', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    fetchLogs();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) return <div className="text-gray-400 p-4">Loading analytics...</div>;
  if (logs.length === 0) return <div className="text-gray-500 italic p-4">No audit data available yet. Seal a document to begin tracking.</div>;

  // Aggregate Data for Charts
  const successCount = logs.filter((l) => l.outcome === 'success').length;
  const failureCount = logs.filter((l) => l.outcome === 'failure').length;

  const actionCounts = logs.reduce((acc, log) => {
    const act = log.action || 'UNKNOWN';
    acc[act] = (acc[act] || 0) + 1;
    return acc;
  }, {});

  const doughnutData = {
    labels: ['Successful Access/Seals', 'Failed/Blocked Attempts'],
    datasets: [
      {
        data: [successCount, failureCount],
        backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)'],
        borderColor: ['#1f2937', '#1f2937'],
        borderWidth: 2,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: '#d1d5db', boxWidth: 12 },
      },
    },
  };

  const barData = {
    labels: Object.keys(actionCounts),
    datasets: [
      {
        label: 'System Events',
        data: Object.values(actionCounts),
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#d1d5db' } },
    },
    scales: {
      y: { ticks: { color: '#9ca3af', stepSize: 1 }, grid: { color: '#374151' } },
      x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
    },
  };

  return (
    <div className="audit-pod-3d preserve-3d mt-8" style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '1.25rem' }}>&#128737;</span>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', margin: 0, textShadow: '0 0 12px rgba(56, 189, 248, 0.4)' }}>
          Security &amp; Audit Analytics
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ background: 'rgba(10, 16, 30, 0.85)', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(56, 189, 248, 0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.75rem', fontWeight: 600, fontSize: '0.9rem' }}>Security Outcomes</h3>
          <div style={{ width: '190px', height: '190px' }}>
            <Doughnut data={doughnutData} options={doughnutOptions} />
          </div>
        </div>
        <div style={{ background: 'rgba(10, 16, 30, 0.85)', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(168, 85, 247, 0.25)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.75rem', fontWeight: 600, fontSize: '0.9rem' }}>Event Distribution</h3>
          <div style={{ height: '190px' }}>
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
        <table style={{ width: '100%', fontSize: '0.85rem', textAlign: 'left', color: '#cbd5e1', borderCollapse: 'collapse' }}>
          <thead style={{ fontSize: '0.75rem', textTransform: 'uppercase', background: 'rgba(15, 23, 42, 0.95)', color: '#94a3b8' }}>
            <tr>
              <th style={{ padding: '0.75rem 1rem' }}>Timestamp</th>
              <th style={{ padding: '0.75rem 1rem' }}>Action</th>
              <th style={{ padding: '0.75rem 1rem' }}>Document</th>
              <th style={{ padding: '0.75rem 1rem' }}>Outcome</th>
              <th style={{ padding: '0.75rem 1rem' }}>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 10).map((log, index) => (
              <tr key={log.seq || log._id || index} style={{ borderBottom: '1px solid rgba(30, 41, 59, 0.8)', background: index % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent' }}>
                <td style={{ padding: '0.75rem 1rem' }}>{new Date(log.createdAt).toLocaleString()}</td>
                <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#38bdf8' }}>{log.action}</td>
                <td style={{ padding: '0.75rem 1rem', color: '#60a5fa' }}>{log.documentName || 'Unknown Document'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    className={log.outcome === 'success' ? 'badge-3d-emerald' : 'badge-3d-crimson'}
                  >
                    {String(log.outcome || '').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.ip || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditDashboard;
