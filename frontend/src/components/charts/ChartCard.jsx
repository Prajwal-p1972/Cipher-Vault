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
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(10, 15, 29, 0.96) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.22)',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.75), 0 0 16px rgba(56, 189, 248, 0.08)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '290px'
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
            fontWeight: 700,
            color: '#f8fafc',
            letterSpacing: '-0.01em',
            textShadow: '0 0 12px rgba(56, 189, 248, 0.3)'
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
              padding: '0.3rem 0.75rem',
              fontSize: '0.75rem',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              color: '#cbd5e1',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)'
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
                <tr style={{ borderBottom: '2px solid rgba(56, 189, 248, 0.25)', color: '#94a3b8' }}>
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
                      borderBottom: '1px solid rgba(51, 65, 85, 0.45)',
                      backgroundColor: rIdx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'rgba(30, 41, 59, 0.3)'
                    }}
                  >
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} style={{ padding: '0.5rem 0.75rem', color: '#e2e8f0' }}>
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
