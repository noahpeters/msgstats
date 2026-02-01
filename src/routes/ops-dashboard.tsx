import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from '../app/styles';

type OpsSummary = {
  usersTotal: number;
  assetsTotal: number;
  conversationsTotal: number;
  messagesTotal: number;
  updatedAt: string | null;
};

type HourPoint = {
  hour: string;
  count: number;
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
};

const metricCardStyle: React.CSSProperties = {
  borderRadius: '14px',
  border: '1px solid rgba(12, 27, 26, 0.1)',
  backgroundColor: '#ffffff',
  padding: '14px',
  display: 'grid',
  gap: '6px',
};

const chartWrapStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: '14px',
  border: '1px solid rgba(12, 27, 26, 0.1)',
  backgroundColor: '#ffffff',
};

const formatRelativeTime = (value: string | null) => {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Never';
  }
  const diffMs = date.getTime() - Date.now();
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['week', 1000 * 60 * 60 * 24 * 7],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
    ['second', 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, range] of ranges) {
    if (Math.abs(diffMs) >= range || unit === 'second') {
      return formatter.format(Math.round(diffMs / range), unit);
    }
  }
  return 'Just now';
};

export default function OpsDashboard(): React.ReactElement {
  const [summary, setSummary] = React.useState<OpsSummary | null>(null);
  const [points, setPoints] = React.useState<HourPoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const summaryRes = await fetch('/api/ops/summary', {
          cache: 'no-store',
        });
        if (!summaryRes.ok) {
          throw new Error('Failed to load ops summary.');
        }
        const summaryData = (await summaryRes.json()) as OpsSummary;
        const pointsRes = await fetch('/api/ops/messages-per-hour?hours=168', {
          cache: 'no-store',
        });
        if (!pointsRes.ok) {
          throw new Error('Failed to load ops chart.');
        }
        const pointsData = (await pointsRes.json()) as {
          points: HourPoint[];
        };
        if (active) {
          setSummary(summaryData);
          setPoints(pointsData.points ?? []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load ops.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const width = 720;
  const height = 200;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const barWidth = points.length ? width / points.length : width;

  return (
    <div {...stylex.props(layout.page)}>
      <div {...stylex.props(layout.shell)}>
        <h1 {...stylex.props(layout.title)}>Ops dashboard</h1>
        <p {...stylex.props(layout.subtitle)}>
          Operational counters and ingestion throughput.
        </p>

        {error ? <p style={{ color: colors.coral }}>{error}</p> : null}
        {loading && !summary ? (
          <p {...stylex.props(layout.note)}>Loading metrics…</p>
        ) : null}

        <div style={cardGridStyle}>
          <div style={metricCardStyle}>
            <span {...stylex.props(layout.note)}>Users</span>
            <strong>{summary?.usersTotal ?? 0}</strong>
          </div>
          <div style={metricCardStyle}>
            <span {...stylex.props(layout.note)}>Assets</span>
            <strong>{summary?.assetsTotal ?? 0}</strong>
          </div>
          <div style={metricCardStyle}>
            <span {...stylex.props(layout.note)}>Conversations</span>
            <strong>{summary?.conversationsTotal ?? 0}</strong>
          </div>
          <div style={metricCardStyle}>
            <span {...stylex.props(layout.note)}>Messages</span>
            <strong>{summary?.messagesTotal ?? 0}</strong>
          </div>
        </div>

        <div style={{ marginTop: '18px', display: 'grid', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Messages per hour</h2>
            <span {...stylex.props(layout.note)}>
              Updated {formatRelativeTime(summary?.updatedAt ?? null)}
            </span>
          </div>
          <div style={chartWrapStyle}>
            <svg
              width="100%"
              height="220"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Messages per hour"
            >
              <rect width={width} height={height} fill="#f8f5f2" rx="12" />
              {points.map((point, index) => {
                const barHeight = Math.round((point.count / maxCount) * 160);
                const x = Math.floor(index * barWidth);
                const y = height - barHeight - 12;
                return (
                  <g key={point.hour}>
                    <rect
                      x={x}
                      y={y}
                      width={Math.max(1, barWidth - 1)}
                      height={barHeight}
                      fill="#0f766e"
                      opacity={0.85}
                    >
                      <title>
                        {point.hour} · {point.count}
                      </title>
                    </rect>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
