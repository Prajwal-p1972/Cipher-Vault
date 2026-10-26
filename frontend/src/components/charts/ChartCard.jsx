import React, { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Register only the specific Chart.js components needed across analytics
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

/**
 * Accessible container card for charts supporting loading, error, empty states,
 * screen-reader text summaries, and an accessible table view toggle.
 *
 * @param {{
 *   title: string,
 *   loading?: boolean,
 *   error?: string | null,
 *   empty?: boolean,
 *   summary?: string,
 *   tableData?: { headers: string[], rows: Array<Array<string|number>> },
 *   children: React.ReactNode
 * }} props
 */
export function ChartCard({
  title,
  loading = false,
  error = null,
  empty = false,
  summary = '',
  tableData = null,
  children
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div
      role="region"
      aria-label={title}
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '1.25rem',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '280px'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem'
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: '#1e293b'
          }}
        >
          {title}
        </h3>

        {tableData && !loading && !error && !empty && (
          <button
            type="button"
            onClick={() => setShowTable((prev) => !prev)}
            aria-label={showTable ? `Show chart for ${title}` : `Show table for ${title}`}
            style={{
              padding: '0.25rem 0.65rem',
              fontSize: '0.75rem',
              backgroundColor: '#f1f5f9',
              color: '#475569',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            {showTable ? 'View Chart' : 'Table View'}
          </button>
        )}
      </div>

      {/* Screen Reader Summary */}
      {summary && (
        <div
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            border: 0
          }}
        >
          {summary}
        </div>
      )}

      {/* Content States */}
      <div style={{ flex: 1, position: 'relative', minHeight: '200px' }}>
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#64748b',
              fontSize: '0.875rem'
            }}
          >
            Loading chart data...
          </div>
        ) : error ? (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#ef4444',
              fontSize: '0.85rem',
              textAlign: 'center',
              padding: '1rem'
            }}
          >
            {error}
          </div>
        ) : empty ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#94a3b8',
              fontSize: '0.875rem',
              fontStyle: 'italic'
            }}
          >
            No data recorded for this period.
          </div>
        ) : showTable && tableData ? (
          <div style={{ overflowX: 'auto', maxHeight: '250px' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.8rem',
                textAlign: 'left'
              }}
            >
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  {tableData.headers.map((h, idx) => (
                    <th key={idx} style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: rIdx % 2 === 0 ? '#ffffff' : '#f8fafc'
                    }}
                  >
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} style={{ padding: '0.45rem 0.75rem', color: '#334155' }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height: '100%', width: '100%' }}>{children}</div>
        )}
      </div>
    </div>
  );
}

export default ChartCard;
