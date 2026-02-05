import * as React from 'react';
import * as d3 from 'd3';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from '../app/styles';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';

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
  const { tooltip, show, move, hide } = useChartTooltip();
  const xAxisRef = React.useRef<SVGGElement | null>(null);
  const yAxisRef = React.useRef<SVGGElement | null>(null);

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
  const margin = { top: 10, right: 12, bottom: 28, left: 44 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const parsedPoints = React.useMemo(
    () =>
      points.map((point) => ({
        ...point,
        date: new Date(point.hour),
      })),
    [points],
  );
  const maxCount = Math.max(1, ...parsedPoints.map((point) => point.count));
  const extent = d3.extent(
    parsedPoints,
    (point: (typeof parsedPoints)[number]) => point.date,
  );
  const xScale = d3
    .scaleTime()
    .domain(
      extent[0] && extent[1]
        ? [extent[0], extent[1]]
        : [new Date(), new Date()],
    )
    .range([0, innerWidth]);
  const yScale = d3
    .scaleLog()
    .domain([1, maxCount])
    .nice()
    .range([innerHeight, 0]);
  const gridTicks = yScale.ticks(4);
  const barWidth = parsedPoints.length
    ? Math.max(1, innerWidth / parsedPoints.length)
    : innerWidth;

  React.useEffect(() => {
    if (!parsedPoints.length) {
      return;
    }
    const hours = parsedPoints.length;
    const tickInterval =
      hours <= 48
        ? d3.timeHour.every(6)
        : hours <= 168
          ? d3.timeDay.every(1)
          : d3.timeDay.every(2);
    const tickFormat =
      hours <= 48 ? d3.timeFormat('%I %p') : d3.timeFormat('%b %d');
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickInterval)
      .tickFormat(tickFormat);
    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('~s'));
    if (xAxisRef.current) {
      d3.select(xAxisRef.current).call(xAxis);
    }
    if (yAxisRef.current) {
      d3.select(yAxisRef.current).call(yAxis);
    }
  }, [parsedPoints, xScale, yScale]);

  const hourFormatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });

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
              <g transform={`translate(${margin.left}, ${margin.top})`}>
                {gridTicks.map((tick) => {
                  const y = yScale(tick);
                  return (
                    <line
                      key={`grid-${tick}`}
                      x1={0}
                      x2={innerWidth}
                      y1={y}
                      y2={y}
                      stroke="#0f766e"
                      strokeOpacity={0.12}
                      strokeWidth={1}
                    />
                  );
                })}
                {parsedPoints.map((point) => {
                  const x = xScale(point.date) - barWidth / 2;
                  const clampedCount = Math.max(1, point.count);
                  const y = yScale(clampedCount);
                  const barHeight =
                    point.count <= 0 ? 0 : Math.max(1, innerHeight - y);
                  const label = `${hourFormatter.format(
                    point.date,
                  )}: ${point.count} messages`;
                  return (
                    <rect
                      key={point.hour}
                      x={x}
                      y={y}
                      width={Math.max(1, barWidth - 1)}
                      height={barHeight}
                      fill="#0f766e"
                      opacity={0.85}
                      aria-label={label}
                      onMouseEnter={(event) =>
                        show(event, {
                          title: hourFormatter.format(point.date),
                          lines: [`${point.count} messages`, point.hour],
                        })
                      }
                      onMouseMove={move}
                      onMouseLeave={hide}
                    />
                  );
                })}
                <g
                  ref={xAxisRef}
                  transform={`translate(0, ${innerHeight})`}
                  style={{ color: '#284b63', fontSize: '11px' }}
                />
                <g
                  ref={yAxisRef}
                  style={{ color: '#284b63', fontSize: '11px' }}
                />
              </g>
            </svg>
            <ChartTooltip tooltip={tooltip} />
          </div>
        </div>
      </div>
    </div>
  );
}
