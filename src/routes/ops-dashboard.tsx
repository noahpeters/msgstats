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

type SyncRun = {
  id: string;
  pageId: string;
  platform: string;
  igBusinessId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

type HourPoint = {
  hour: string;
  count: number;
};

type MetaMetrics = {
  window: string;
  overall: {
    total: number;
    errors: number;
    errorRate: number;
    avgDurationMs: number | null;
  };
  byOp: Array<{
    op: string;
    total: number;
    errors: number;
    errorRate: number;
    avgDurationMs: number | null;
  }>;
  topRoutes: Array<{
    route: string;
    status: string;
    metaErrorCode: string;
    metaErrorSubcode: string;
    count: number;
  }>;
};

type AppErrorMetrics = {
  window: string;
  overall: { totalErrors: number };
  byMinute: Array<{ minuteISO: string; errors: number }>;
  topKeys: Array<{
    errorKey: string;
    kind: string;
    severity: string;
    count: number;
  }>;
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
  const [metaMetrics, setMetaMetrics] = React.useState<MetaMetrics | null>(
    null,
  );
  const [errorMetrics, setErrorMetrics] =
    React.useState<AppErrorMetrics | null>(null);
  const [syncRuns, setSyncRuns] = React.useState<SyncRun[]>([]);
  const [flags, setFlags] = React.useState<{ followupInbox?: boolean } | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { tooltip, show, move, hide } = useChartTooltip();
  const {
    tooltip: errorTooltip,
    show: showErrorTooltip,
    move: moveErrorTooltip,
    hide: hideErrorTooltip,
  } = useChartTooltip();
  const xAxisRef = React.useRef<SVGGElement | null>(null);
  const yAxisRef = React.useRef<SVGGElement | null>(null);
  const errorAxisRef = React.useRef<SVGGElement | null>(null);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [summaryRes, pointsRes, metaRes, errorsRes, flagsRes] =
          await Promise.all([
            fetch('/api/ops/summary', { cache: 'no-store' }),
            fetch('/api/ops/messages-per-hour?hours=168', {
              cache: 'no-store',
            }),
            fetch('/api/ops/metrics/meta?window=15m', { cache: 'no-store' }),
            fetch('/api/ops/metrics/errors?window=60m', { cache: 'no-store' }),
            fetch('/api/feature-flags', { cache: 'no-store' }),
          ]);
        if (!summaryRes.ok) {
          throw new Error('Failed to load ops summary.');
        }
        if (!pointsRes.ok) {
          throw new Error('Failed to load ops chart.');
        }
        if (!metaRes.ok) {
          throw new Error('Failed to load Meta metrics.');
        }
        if (!errorsRes.ok) {
          throw new Error('Failed to load app error metrics.');
        }
        const summaryData = (await summaryRes.json()) as OpsSummary;
        const pointsData = (await pointsRes.json()) as { points: HourPoint[] };
        const metaData = (await metaRes.json()) as MetaMetrics;
        const errorsData = (await errorsRes.json()) as AppErrorMetrics;
        const flagsData = (await flagsRes.json()) as {
          followupInbox?: boolean;
        };
        let runsData: { runs: SyncRun[] } = { runs: [] };
        if (flagsData.followupInbox) {
          const runsRes = await fetch(
            '/api/ops/sync-runs?status=running&limit=25',
            {
              cache: 'no-store',
            },
          );
          if (runsRes.ok) {
            runsData = (await runsRes.json()) as { runs: SyncRun[] };
          }
        }
        if (active) {
          setSummary(summaryData);
          setPoints(pointsData.points ?? []);
          setMetaMetrics(metaData);
          setErrorMetrics(errorsData);
          setFlags(flagsData ?? null);
          setSyncRuns(runsData.runs ?? []);
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

  const cancelRun = async (runId: string) => {
    const confirm = window.confirm('Cancel this sync run?');
    if (!confirm) return;
    const response = await fetch(`/api/ops/sync-runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      setSyncRuns((prev) => prev.filter((run) => run.id !== runId));
    } else {
      setError('Failed to cancel sync run.');
    }
  };

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

  const appErrorMinutes = 60;
  const appErrorPoints = React.useMemo(() => {
    const map = new Map(
      (errorMetrics?.byMinute ?? []).map((row) => [
        row.minuteISO.slice(0, 16),
        row.errors,
      ]),
    );
    const end = new Date();
    const startMs = end.getTime() - (appErrorMinutes - 1) * 60 * 1000;
    return Array.from({ length: appErrorMinutes }, (_, index) => {
      const minute = new Date(startMs + index * 60 * 1000);
      const key = minute.toISOString().slice(0, 16);
      return {
        minute,
        errors: map.get(key) ?? 0,
      };
    });
  }, [errorMetrics]);

  const errorWidth = 720;
  const errorHeight = 140;
  const errorMargin = { top: 10, right: 12, bottom: 24, left: 44 };
  const errorInnerWidth = errorWidth - errorMargin.left - errorMargin.right;
  const errorInnerHeight = errorHeight - errorMargin.top - errorMargin.bottom;
  const errorMax = Math.max(1, ...appErrorPoints.map((point) => point.errors));
  const errorXScale = d3
    .scaleTime()
    .domain(
      appErrorPoints.length
        ? [appErrorPoints[0]?.minute ?? new Date(), new Date()]
        : [new Date(), new Date()],
    )
    .range([0, errorInnerWidth]);
  const errorYScale = d3
    .scaleLinear()
    .domain([0, errorMax])
    .nice()
    .range([errorInnerHeight, 0]);
  const errorBarWidth = appErrorPoints.length
    ? Math.max(1, errorInnerWidth / appErrorPoints.length)
    : errorInnerWidth;

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

  React.useEffect(() => {
    if (!appErrorPoints.length) {
      return;
    }
    const tickFormat = d3.timeFormat('%I:%M %p');
    const xAxis = d3.axisBottom(errorXScale).ticks(4).tickFormat(tickFormat);
    if (errorAxisRef.current) {
      d3.select(errorAxisRef.current).call(xAxis);
    }
  }, [appErrorPoints, errorXScale]);

  const hourFormatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });
  const minuteFormatter = new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: 'numeric',
  });
  const percentFormatter = new Intl.NumberFormat('en', {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  const numberFormatter = new Intl.NumberFormat('en');

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

        {flags?.followupInbox ? (
          <div
            style={{
              marginTop: '18px',
              display: 'grid',
              gap: '8px',
            }}
          >
            <h2 style={{ margin: 0 }}>Running syncs</h2>
            <p {...stylex.props(layout.note)}>
              Active sync runs and their start time. Cancel if stuck.
            </p>
            {syncRuns.length ? (
              <table {...stylex.props(layout.table)}>
                <thead>
                  <tr {...stylex.props(layout.tableRow)}>
                    <th {...stylex.props(layout.tableHead)}>Run ID</th>
                    <th {...stylex.props(layout.tableHead)}>Platform</th>
                    <th {...stylex.props(layout.tableHead)}>Started</th>
                    <th {...stylex.props(layout.tableHead)}>Status</th>
                    <th {...stylex.props(layout.tableHead)}>Last error</th>
                    <th {...stylex.props(layout.tableHead)}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {syncRuns.map((run) => (
                    <tr key={run.id} {...stylex.props(layout.tableRow)}>
                      <td {...stylex.props(layout.tableCell)}>
                        <code>{run.id.slice(0, 8)}</code>
                      </td>
                      <td {...stylex.props(layout.tableCell)}>
                        {run.platform}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>{run.status}</td>
                      <td {...stylex.props(layout.tableCell)}>
                        {run.lastError ?? '—'}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>
                        <button
                          {...stylex.props(layout.ghostButton)}
                          onClick={() => cancelRun(run.id)}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p {...stylex.props(layout.note)}>No running syncs.</p>
            )}
          </div>
        ) : null}

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

        <div style={{ marginTop: '24px', display: 'grid', gap: '16px' }}>
          <h2 style={{ margin: 0 }}>Meta API health (last 15m)</h2>
          <div style={cardGridStyle}>
            <div style={metricCardStyle}>
              <span {...stylex.props(layout.note)}>Error rate</span>
              <strong>
                {percentFormatter.format(metaMetrics?.overall.errorRate ?? 0)}
              </strong>
            </div>
            <div style={metricCardStyle}>
              <span {...stylex.props(layout.note)}>Total calls</span>
              <strong>
                {numberFormatter.format(metaMetrics?.overall.total ?? 0)}
              </strong>
            </div>
            <div style={metricCardStyle}>
              <span {...stylex.props(layout.note)}>Avg latency</span>
              <strong>
                {metaMetrics?.overall.avgDurationMs
                  ? `${Math.round(metaMetrics.overall.avgDurationMs)} ms`
                  : '—'}
              </strong>
            </div>
          </div>
          <section style={chartWrapStyle}>
            <h3 style={{ marginTop: 0 }}>Top failing ops</h3>
            {metaMetrics?.byOp.length ? (
              <table {...stylex.props(layout.table)}>
                <thead>
                  <tr {...stylex.props(layout.tableRow)}>
                    <th {...stylex.props(layout.tableHead)}>Op</th>
                    <th {...stylex.props(layout.tableHead)}>Errors</th>
                    <th {...stylex.props(layout.tableHead)}>Error rate</th>
                    <th {...stylex.props(layout.tableHead)}>Avg ms</th>
                  </tr>
                </thead>
                <tbody>
                  {metaMetrics.byOp.slice(0, 8).map((row) => (
                    <tr key={row.op} {...stylex.props(layout.tableRow)}>
                      <td {...stylex.props(layout.tableCell)}>{row.op}</td>
                      <td {...stylex.props(layout.tableCell)}>{row.errors}</td>
                      <td {...stylex.props(layout.tableCell)}>
                        {percentFormatter.format(row.errorRate)}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>
                        {row.avgDurationMs
                          ? Math.round(row.avgDurationMs)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p {...stylex.props(layout.note)}>No recent failures.</p>
            )}
          </section>
          <section style={chartWrapStyle}>
            <h3 style={{ marginTop: 0 }}>Meta failures (last 15m)</h3>
            {metaMetrics?.topRoutes.length ? (
              <table {...stylex.props(layout.table)}>
                <thead>
                  <tr {...stylex.props(layout.tableRow)}>
                    <th {...stylex.props(layout.tableHead)}>Route</th>
                    <th {...stylex.props(layout.tableHead)}>Status</th>
                    <th {...stylex.props(layout.tableHead)}>Meta code</th>
                    <th {...stylex.props(layout.tableHead)}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {metaMetrics.topRoutes.slice(0, 8).map((row, index) => (
                    <tr
                      key={`${row.route}-${row.status}-${index}`}
                      {...stylex.props(layout.tableRow)}
                    >
                      <td {...stylex.props(layout.tableCell)}>{row.route}</td>
                      <td {...stylex.props(layout.tableCell)}>{row.status}</td>
                      <td {...stylex.props(layout.tableCell)}>
                        {row.metaErrorCode || '—'}
                        {row.metaErrorSubcode ? `/${row.metaErrorSubcode}` : ''}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p {...stylex.props(layout.note)}>No failures in window.</p>
            )}
          </section>
        </div>

        <div style={{ marginTop: '24px', display: 'grid', gap: '12px' }}>
          <h2 style={{ margin: 0 }}>App errors (last 60m)</h2>
          <div style={chartWrapStyle}>
            <svg
              width="100%"
              height="160"
              viewBox={`0 0 ${errorWidth} ${errorHeight}`}
              role="img"
              aria-label="App errors per minute"
            >
              <rect
                width={errorWidth}
                height={errorHeight}
                fill="#f8f5f2"
                rx="12"
              />
              <g
                transform={`translate(${errorMargin.left}, ${errorMargin.top})`}
              >
                {appErrorPoints.map((point, index) => {
                  const x = errorXScale(point.minute) - errorBarWidth / 2;
                  const y = errorYScale(point.errors);
                  const barHeight = errorInnerHeight - y;
                  return (
                    <rect
                      key={index}
                      x={x}
                      y={y}
                      width={Math.max(1, errorBarWidth - 1)}
                      height={barHeight}
                      fill="#f97316"
                      opacity={0.85}
                      onMouseEnter={(event) =>
                        showErrorTooltip(event, {
                          title: minuteFormatter.format(point.minute),
                          lines: [`${point.errors} errors`],
                        })
                      }
                      onMouseMove={moveErrorTooltip}
                      onMouseLeave={hideErrorTooltip}
                    />
                  );
                })}
                <g
                  ref={errorAxisRef}
                  transform={`translate(0, ${errorInnerHeight})`}
                  style={{ color: '#284b63', fontSize: '11px' }}
                />
              </g>
            </svg>
            <ChartTooltip tooltip={errorTooltip} />
          </div>
          <section style={chartWrapStyle}>
            <h3 style={{ marginTop: 0 }}>Top error keys</h3>
            {errorMetrics?.topKeys.length ? (
              <table {...stylex.props(layout.table)}>
                <thead>
                  <tr {...stylex.props(layout.tableRow)}>
                    <th {...stylex.props(layout.tableHead)}>Error key</th>
                    <th {...stylex.props(layout.tableHead)}>Kind</th>
                    <th {...stylex.props(layout.tableHead)}>Severity</th>
                    <th {...stylex.props(layout.tableHead)}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {errorMetrics.topKeys.map((row) => (
                    <tr
                      key={`${row.errorKey}-${row.kind}`}
                      {...stylex.props(layout.tableRow)}
                    >
                      <td {...stylex.props(layout.tableCell)}>
                        {row.errorKey}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>{row.kind}</td>
                      <td {...stylex.props(layout.tableCell)}>
                        {row.severity}
                      </td>
                      <td {...stylex.props(layout.tableCell)}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p {...stylex.props(layout.note)}>No app errors in window.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
