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
import api from '../api/axios.js';

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
        const { data } = await api.get('/audit/me');
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
    <div className="bg-gray-800 p-6 rounded-lg shadow border border-gray-700 mt-8">
      <h2 className="text-xl font-bold text-white mb-6">Security &amp; Audit Analytics</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-gray-900 p-4 rounded-lg flex flex-col items-center">
          <h3 className="text-gray-400 mb-2 font-semibold">Security Outcomes</h3>
          <div className="w-48 h-48">
            <Doughnut data={doughnutData} options={doughnutOptions} />
          </div>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg flex flex-col">
          <h3 className="text-gray-400 mb-2 font-semibold">Event Distribution</h3>
          <div className="h-48">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-400">
          <thead className="text-xs text-gray-300 uppercase bg-gray-700">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 10).map((log, index) => (
              <tr key={log.seq || log._id || index} className="border-b border-gray-700 hover:bg-gray-600">
                <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-3 text-blue-400">{log.documentName || 'Unknown Document'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded text-xs font-bold ${
                      log.outcome === 'success'
                        ? 'bg-green-900 text-green-300'
                        : 'bg-red-900 text-red-300'
                    }`}
                  >
                    {String(log.outcome || '').toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{log.ip || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditDashboard;
