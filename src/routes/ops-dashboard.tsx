import * as React from 'react';
import * as d3 from 'd3';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';
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
  userId: string;
  pageId: string;
  platform: string;
  igBusinessId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

type AiRunSummary = {
  id: string;
  userId: string;
  pageId: string;
  platform: string;
  igBusinessId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  stats: {
    attempted: number;
    succeeded: number;
    failed: number;
    skippedTop: { reason: string; count: number } | null;
    results: { handoff_true: number; deferred_true: number };
  } | null;
};

type AiRunDetail = {
  id: string;
  userId: string;
  pageId: string;
  platform: string;
  igBusinessId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  aiStats: Record<string, unknown> | null;
  aiConfig: Record<string, unknown> | null;
};

type OpsUser = {
  userId: string;
  assets: {
    pages: string[];
    igAssets: string[];
  };
  featureFlags: Record<string, unknown>;
};

type ParticipantBackfillResult = {
  ok: boolean;
  userId: string;
  scanned: number;
  updated: number;
  skippedNoToken: number;
  skippedNoParticipant: number;
  failed: number;
  queuedRecompute: boolean;
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

const opsStyles = stylex.create({
  page: {
    display: 'grid',
    gap: '16px',
  },
  pageHeader: {
    display: 'grid',
    gap: '4px',
  },
  title: {
    margin: 0,
    fontSize: '30px',
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    color: '#0c1b1a',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontWeight: 700,
  },
  subtitle: {
    margin: 0,
    fontSize: '13px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  statusLine: {
    margin: 0,
    fontSize: '12px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  section: {
    display: 'grid',
    gap: '10px',
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    padding: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '17px',
    color: '#0c1b1a',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontWeight: 700,
  },
  sectionActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  autoPill: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '999px',
    padding: '4px 9px',
    fontSize: '11px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
    gap: '10px',
    '@media (min-width: 740px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (min-width: 1100px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    },
  },
  healthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
    gap: '10px',
    '@media (min-width: 740px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
  },
  metricCard: {
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    padding: '12px',
    display: 'grid',
    gap: '4px',
  },
  metricLabel: {
    fontSize: '12px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  metricValue: {
    fontSize: '26px',
    lineHeight: 1.1,
    fontWeight: 700,
    color: '#0c1b1a',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  metricSubtext: {
    fontSize: '12px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  tableWrap: {
    overflowX: 'auto',
    width: '100%',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
    minWidth: '760px',
  },
  tableHead: {
    textAlign: 'left',
    borderBottom: '1px solid rgba(12, 27, 26, 0.14)',
    paddingBottom: '8px',
    color: '#284b63',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  tableRow: {
    borderBottom: '1px solid rgba(12, 27, 26, 0.08)',
  },
  tableCell: {
    padding: '10px 0',
    color: '#0c1b1a',
    verticalAlign: 'top',
  },
  chartSurface: {
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    padding: '10px',
    display: 'grid',
    gap: '6px',
  },
  chartHost: {
    width: '100%',
    minHeight: '170px',
  },
  panelGrid: {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns: 'minmax(0, 1fr)',
    '@media (min-width: 1200px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  panel: {
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    padding: '10px',
    display: 'grid',
    gap: '8px',
  },
  panelTitle: {
    margin: 0,
    fontSize: '14px',
    color: '#0c1b1a',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontWeight: 700,
  },
  note: {
    margin: 0,
    fontSize: '12px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  errorBanner: {
    border: '1px solid #fca5a5',
    backgroundColor: '#fef2f2',
    color: '#7f1d1d',
    borderRadius: '10px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    fontSize: '13px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  detailBlock: {
    margin: 0,
    padding: '8px',
    borderRadius: '8px',
    border: '1px solid rgba(12, 27, 26, 0.14)',
    backgroundColor: '#f8fafc',
    whiteSpace: 'pre-wrap',
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
    fontSize: '11px',
    lineHeight: 1.45,
    maxHeight: '220px',
    overflow: 'auto',
  },
});

function useContainerWidth(defaultWidth = 720) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(defaultWidth);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(
        entries[0]?.contentRect.width ?? defaultWidth,
      );
      if (nextWidth > 0) {
        setWidth(nextWidth);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [defaultWidth]);

  return { ref, width: Math.max(320, width) };
}

function MetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string | number;
  subtext?: string;
}) {
  return (
    <div {...stylex.props(opsStyles.metricCard)}>
      <span {...stylex.props(opsStyles.metricLabel)}>{label}</span>
      <strong {...stylex.props(opsStyles.metricValue)}>{value}</strong>
      {subtext ? (
        <span {...stylex.props(opsStyles.metricSubtext)}>{subtext}</span>
      ) : null}
    </div>
  );
}

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
  const [runsError, setRunsError] = React.useState<string | null>(null);
  const [aiRuns, setAiRuns] = React.useState<AiRunSummary[]>([]);
  const [aiRunsError, setAiRunsError] = React.useState<string | null>(null);
  const [aiRunDetail, setAiRunDetail] = React.useState<AiRunDetail | null>(
    null,
  );
  const [opsUsers, setOpsUsers] = React.useState<OpsUser[]>([]);
  const [opsUsersError, setOpsUsersError] = React.useState<string | null>(null);
  const [opsUsersUpdating, setOpsUsersUpdating] = React.useState<string | null>(
    null,
  );
  const [opsUsersBackfilling, setOpsUsersBackfilling] = React.useState<
    string | null
  >(null);
  const [backfillByUser, setBackfillByUser] = React.useState<
    Record<string, ParticipantBackfillResult>
  >({});
  const [auditExporting, setAuditExporting] = React.useState(false);
  const [auditExportStatus, setAuditExportStatus] = React.useState<
    string | null
  >(null);
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
  const messagesChart = useContainerWidth(720);
  const appErrorsChart = useContainerWidth(720);

  const loadSyncRuns = React.useCallback(async () => {
    setRunsError(null);
    const runsRes = await fetch('/api/ops/sync-runs?status=active&limit=25', {
      cache: 'no-store',
    });
    if (runsRes.ok) {
      const runsData = (await runsRes.json()) as { runs: SyncRun[] };
      setSyncRuns(runsData.runs ?? []);
    } else {
      setRunsError('Failed to load sync runs.');
      setSyncRuns([]);
    }
  }, []);

  const loadAiRuns = React.useCallback(async () => {
    setAiRunsError(null);
    const runsRes = await fetch('/api/ops/ai/runs?limit=20', {
      cache: 'no-store',
    });
    if (runsRes.ok) {
      const runsData = (await runsRes.json()) as { runs: AiRunSummary[] };
      setAiRuns(runsData.runs ?? []);
    } else {
      setAiRunsError('Failed to load AI runs.');
      setAiRuns([]);
    }
  }, []);

  const loadOpsUsers = React.useCallback(async () => {
    setOpsUsersError(null);
    const usersRes = await fetch('/api/ops/users?limit=50', {
      cache: 'no-store',
    });
    if (usersRes.ok) {
      const usersData = (await usersRes.json()) as { users: OpsUser[] };
      setOpsUsers(usersData.users ?? []);
    } else {
      setOpsUsersError('Failed to load users.');
      setOpsUsers([]);
    }
  }, []);

  const loadOverview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, pointsRes, metaRes, errorsRes] = await Promise.all([
        fetch('/api/ops/summary', { cache: 'no-store' }),
        fetch('/api/ops/messages-per-hour?hours=168', { cache: 'no-store' }),
        fetch('/api/ops/metrics/meta?window=15m', { cache: 'no-store' }),
        fetch('/api/ops/metrics/errors?window=60m', { cache: 'no-store' }),
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
      setSummary(summaryData);
      setPoints(pointsData.points ?? []);
      setMetaMetrics(metaData);
      setErrorMetrics(errorsData);
      await Promise.all([loadSyncRuns(), loadAiRuns(), loadOpsUsers()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ops.');
    } finally {
      setLoading(false);
    }
  }, [loadAiRuns, loadOpsUsers, loadSyncRuns]);

  const updateUserFlag = React.useCallback(
    async (userId: string, flag: string, value: boolean | null) => {
      setOpsUsersUpdating(userId);
      try {
        const res = await fetch(`/api/ops/users/${userId}/feature-flags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flag,
            value,
          }),
        });
        if (!res.ok) {
          throw new Error('Failed to update.');
        }
        await loadOpsUsers();
      } catch (err) {
        setOpsUsersError(
          err instanceof Error ? err.message : 'Failed to update user.',
        );
      } finally {
        setOpsUsersUpdating(null);
      }
    },
    [loadOpsUsers],
  );

  const backfillParticipants = React.useCallback(
    async (targetUserId: string) => {
      setOpsUsersBackfilling(targetUserId);
      setOpsUsersError(null);
      try {
        const response = await fetch(
          `/api/ops/users/${targetUserId}/backfill-participants`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 300 }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? 'Backfill request failed.');
        }
        const payload = (await response.json()) as ParticipantBackfillResult;
        setBackfillByUser((prev) => ({
          ...prev,
          [targetUserId]: payload,
        }));
        await loadOpsUsers();
      } catch (err) {
        setOpsUsersError(
          err instanceof Error
            ? err.message
            : 'Failed to backfill participants.',
        );
      } finally {
        setOpsUsersBackfilling(null);
      }
    },
    [loadOpsUsers],
  );

  const exportAndClearAudit = React.useCallback(async () => {
    const confirmed = window.confirm(
      'Export all audit rows to a file and then delete them from the database?',
    );
    if (!confirmed) {
      return;
    }
    setAuditExporting(true);
    setAuditExportStatus(null);
    try {
      const response = await fetch('/api/ops/audit/export-and-clear', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Failed to export audit data.');
      }

      const contentDisposition = response.headers.get('content-disposition');
      const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `msgstats-audit-export-${Date.now()}.json`;
      const text = await response.text();
      const blob = new Blob([text], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      const parsed = JSON.parse(text) as {
        counts?: { audit?: number; feedback?: number };
      };
      const auditCount = Number(parsed?.counts?.audit ?? 0);
      const feedbackCount = Number(parsed?.counts?.feedback ?? 0);
      setAuditExportStatus(
        `Exported ${auditCount} audit rows and ${feedbackCount} feedback rows, then cleared both tables.`,
      );
    } catch (error) {
      setAuditExportStatus(
        error instanceof Error ? error.message : 'Export failed.',
      );
    } finally {
      setAuditExporting(false);
    }
  }, []);

  React.useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void loadSyncRuns();
      void loadAiRuns();
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadAiRuns, loadSyncRuns]);

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

  const handleAiRunSelect = async (runId: string) => {
    const response = await fetch(`/api/ops/ai/runs/${runId}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      setAiRunsError('Failed to load AI run details.');
      setAiRunDetail(null);
      return;
    }
    const data = (await response.json()) as { run: AiRunDetail };
    setAiRunDetail(data.run ?? null);
  };

  const messagesChartHeight = 220;
  const messagesMargin = { top: 10, right: 12, bottom: 28, left: 44 };
  const messagesWidth = messagesChart.width;
  const messagesInnerWidth =
    messagesWidth - messagesMargin.left - messagesMargin.right;
  const messagesInnerHeight =
    messagesChartHeight - messagesMargin.top - messagesMargin.bottom;

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
    .range([0, Math.max(1, messagesInnerWidth)]);
  const yScale = d3
    .scaleLog()
    .domain([1, maxCount])
    .nice()
    .range([messagesInnerHeight, 0]);
  const gridTicks = yScale.ticks(4);
  const barWidth = parsedPoints.length
    ? Math.max(1, messagesInnerWidth / parsedPoints.length)
    : messagesInnerWidth;

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

  const appErrorsHeight = 165;
  const errorMargin = { top: 10, right: 12, bottom: 24, left: 44 };
  const errorWidth = appErrorsChart.width;
  const errorInnerWidth = errorWidth - errorMargin.left - errorMargin.right;
  const errorInnerHeight =
    appErrorsHeight - errorMargin.top - errorMargin.bottom;
  const errorMax = Math.max(1, ...appErrorPoints.map((point) => point.errors));
  const errorXScale = d3
    .scaleTime()
    .domain(
      appErrorPoints.length
        ? [appErrorPoints[0]?.minute ?? new Date(), new Date()]
        : [new Date(), new Date()],
    )
    .range([0, Math.max(1, errorInnerWidth)]);
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
      messagesInnerWidth < 560
        ? d3.timeFormat('%b %d')
        : hours <= 48
          ? d3.timeFormat('%I %p')
          : d3.timeFormat('%b %d');
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickInterval)
      .tickFormat(tickFormat as (d: Date) => string);
    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('~s'));
    if (xAxisRef.current) {
      d3.select(xAxisRef.current).call(xAxis);
    }
    if (yAxisRef.current) {
      d3.select(yAxisRef.current).call(yAxis);
    }
  }, [messagesInnerWidth, parsedPoints, xScale, yScale]);

  React.useEffect(() => {
    if (!appErrorPoints.length) {
      return;
    }
    const tickFormat =
      errorInnerWidth < 560
        ? d3.timeFormat('%H:%M')
        : d3.timeFormat('%I:%M %p');
    const tickCount = Math.max(
      3,
      Math.min(8, Math.floor(errorInnerWidth / 100)),
    );
    const xAxis = d3
      .axisBottom(errorXScale)
      .ticks(tickCount)
      .tickFormat(tickFormat as (d: Date) => string);
    if (errorAxisRef.current) {
      d3.select(errorAxisRef.current).call(xAxis);
    }
  }, [appErrorPoints, errorInnerWidth, errorXScale]);

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
  const formatAssets = (assets: OpsUser['assets']) => {
    const parts: string[] = [];
    if (assets.pages.length) {
      parts.push(`Pages: ${assets.pages.join(', ')}`);
    }
    if (assets.igAssets.length) {
      parts.push(`IG: ${assets.igAssets.join(', ')}`);
    }
    return parts.join(' • ') || '—';
  };
  const readFlagValue = (flags: Record<string, unknown>, key: string) => {
    const value = flags?.[key];
    if (value === true || value === false) {
      return value ? 'enabled' : 'disabled';
    }
    return 'inherit';
  };

  return (
    <div {...stylex.props(opsStyles.page)}>
      <section {...stylex.props(opsStyles.pageHeader)}>
        <h1 {...stylex.props(opsStyles.title)}>Ops</h1>
        <p {...stylex.props(opsStyles.subtitle)}>
          Operational counters and ingestion throughput.
        </p>
        <p {...stylex.props(opsStyles.statusLine)}>
          Last updated: {formatRelativeTime(summary?.updatedAt ?? null)}
        </p>
      </section>

      {error ? (
        <section {...stylex.props(opsStyles.errorBanner)}>
          <span>{error}</span>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={() => void loadOverview()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <p {...stylex.props(opsStyles.note)}>Loading metrics…</p>
      ) : null}

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>Core counters</h2>
        </div>
        <div {...stylex.props(opsStyles.metricGrid)}>
          <MetricCard label="Users" value={summary?.usersTotal ?? 0} />
          <MetricCard label="Assets" value={summary?.assetsTotal ?? 0} />
          <MetricCard
            label="Conversations"
            value={summary?.conversationsTotal ?? 0}
          />
          <MetricCard label="Messages" value={summary?.messagesTotal ?? 0} />
        </div>
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>Running syncs</h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <span {...stylex.props(opsStyles.autoPill)}>Auto: 15s</span>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void loadSyncRuns()}
            >
              Refresh
            </button>
          </div>
        </div>
        {runsError ? (
          <p {...stylex.props(opsStyles.errorBanner)}>{runsError}</p>
        ) : null}
        {syncRuns.length ? (
          <div {...stylex.props(opsStyles.tableWrap)}>
            <table {...stylex.props(opsStyles.table)}>
              <thead>
                <tr {...stylex.props(opsStyles.tableRow)}>
                  <th {...stylex.props(opsStyles.tableHead)}>Run ID</th>
                  <th {...stylex.props(opsStyles.tableHead)}>User</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Platform</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Started</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Status</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Last error</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.map((run) => (
                  <tr key={run.id} {...stylex.props(opsStyles.tableRow)}>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <code>{run.id.slice(0, 8)}</code>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <code>{run.userId.slice(0, 8)}</code>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.platform}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>{run.status}</td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.lastError ?? '—'}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <button
                        {...stylex.props(layout.ghostButton)}
                        onClick={() => void cancelRun(run.id)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p {...stylex.props(opsStyles.note)}>No running syncs.</p>
        )}
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>AI runs</h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <span {...stylex.props(opsStyles.autoPill)}>Auto: 15s</span>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void loadAiRuns()}
            >
              Refresh
            </button>
          </div>
        </div>
        {aiRunsError ? (
          <p {...stylex.props(opsStyles.errorBanner)}>{aiRunsError}</p>
        ) : null}
        {aiRuns.length ? (
          <div {...stylex.props(opsStyles.tableWrap)}>
            <table {...stylex.props(opsStyles.table)}>
              <thead>
                <tr {...stylex.props(opsStyles.tableRow)}>
                  <th {...stylex.props(opsStyles.tableHead)}>Run ID</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Started</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Duration</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Attempted</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Succeeded</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Failed</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Top skip</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Handoff</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Deferred</th>
                </tr>
              </thead>
              <tbody>
                {aiRuns.map((run) => (
                  <tr
                    key={run.id}
                    {...stylex.props(opsStyles.tableRow)}
                    onClick={() => void handleAiRunSelect(run.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <code>{run.id.slice(0, 8)}</code>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.durationMs != null
                        ? `${Math.round(run.durationMs / 1000)}s`
                        : '—'}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.attempted ?? 0}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.succeeded ?? 0}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.failed ?? 0}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.skippedTop
                        ? `${run.stats.skippedTop.reason} (${run.stats.skippedTop.count})`
                        : '—'}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.results.handoff_true ?? 0}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {run.stats?.results.deferred_true ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p {...stylex.props(opsStyles.note)}>No AI runs yet.</p>
        )}

        {aiRunDetail ? (
          <div {...stylex.props(opsStyles.panel)}>
            <div {...stylex.props(opsStyles.sectionHeader)}>
              <h3 {...stylex.props(opsStyles.panelTitle)}>
                AI run {aiRunDetail.id.slice(0, 8)}
              </h3>
              <button
                {...stylex.props(layout.ghostButton)}
                onClick={() => setAiRunDetail(null)}
              >
                Close
              </button>
            </div>
            <p {...stylex.props(opsStyles.note)}>
              Status: {aiRunDetail.status} • Started:{' '}
              {new Date(aiRunDetail.startedAt).toLocaleString()} • Duration:{' '}
              {aiRunDetail.durationMs != null
                ? `${Math.round(aiRunDetail.durationMs / 1000)}s`
                : '—'}
            </p>
            <div {...stylex.props(opsStyles.panelGrid)}>
              <div {...stylex.props(opsStyles.panel)}>
                <h4 {...stylex.props(opsStyles.panelTitle)}>AI config</h4>
                <pre {...stylex.props(opsStyles.detailBlock)}>
                  {JSON.stringify(aiRunDetail.aiConfig ?? {}, null, 2)}
                </pre>
              </div>
              <div {...stylex.props(opsStyles.panel)}>
                <h4 {...stylex.props(opsStyles.panelTitle)}>AI stats</h4>
                <pre {...stylex.props(opsStyles.detailBlock)}>
                  {JSON.stringify(aiRunDetail.aiStats ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>Messages per hour</h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <span {...stylex.props(opsStyles.autoPill)}>
              Updated {formatRelativeTime(summary?.updatedAt ?? null)}
            </span>
          </div>
        </div>
        <div {...stylex.props(opsStyles.chartSurface)}>
          <div ref={messagesChart.ref} {...stylex.props(opsStyles.chartHost)}>
            <svg
              width="100%"
              height="220"
              viewBox={`0 0 ${messagesWidth} ${messagesChartHeight}`}
              role="img"
              aria-label="Messages per hour"
            >
              <g
                transform={`translate(${messagesMargin.left}, ${messagesMargin.top})`}
              >
                {gridTicks.map((tick) => {
                  const y = yScale(tick);
                  return (
                    <line
                      key={`grid-${tick}`}
                      x1={0}
                      x2={messagesInnerWidth}
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
                    point.count <= 0 ? 0 : Math.max(1, messagesInnerHeight - y);
                  return (
                    <rect
                      key={point.hour}
                      x={x}
                      y={y}
                      width={Math.max(1, barWidth - 1)}
                      height={barHeight}
                      fill="#0f766e"
                      opacity={0.85}
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
                  transform={`translate(0, ${messagesInnerHeight})`}
                  style={{ color: '#284b63', fontSize: '11px' }}
                />
                <g
                  ref={yAxisRef}
                  style={{ color: '#284b63', fontSize: '11px' }}
                />
              </g>
            </svg>
          </div>
          <ChartTooltip tooltip={tooltip} />
        </div>
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>
            Meta API health (last 15m)
          </h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void loadOverview()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div {...stylex.props(opsStyles.healthGrid)}>
          <MetricCard
            label="Error rate"
            value={percentFormatter.format(metaMetrics?.overall.errorRate ?? 0)}
          />
          <MetricCard
            label="Total calls"
            value={numberFormatter.format(metaMetrics?.overall.total ?? 0)}
          />
          <MetricCard
            label="Avg latency"
            value={
              metaMetrics?.overall.avgDurationMs
                ? `${Math.round(metaMetrics.overall.avgDurationMs)} ms`
                : '—'
            }
          />
        </div>

        <div {...stylex.props(opsStyles.panelGrid)}>
          <section {...stylex.props(opsStyles.panel)}>
            <h3 {...stylex.props(opsStyles.panelTitle)}>Top failing ops</h3>
            {metaMetrics?.byOp.length ? (
              <div {...stylex.props(opsStyles.tableWrap)}>
                <table {...stylex.props(opsStyles.table)}>
                  <thead>
                    <tr {...stylex.props(opsStyles.tableRow)}>
                      <th {...stylex.props(opsStyles.tableHead)}>Op</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Errors</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Error rate</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Avg ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metaMetrics.byOp.slice(0, 8).map((row) => (
                      <tr key={row.op} {...stylex.props(opsStyles.tableRow)}>
                        <td {...stylex.props(opsStyles.tableCell)}>{row.op}</td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.errors}
                        </td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {percentFormatter.format(row.errorRate)}
                        </td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.avgDurationMs
                            ? Math.round(row.avgDurationMs)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p {...stylex.props(opsStyles.note)}>No recent failures.</p>
            )}
          </section>

          <section {...stylex.props(opsStyles.panel)}>
            <h3 {...stylex.props(opsStyles.panelTitle)}>Meta failures</h3>
            {metaMetrics?.topRoutes.length ? (
              <div {...stylex.props(opsStyles.tableWrap)}>
                <table {...stylex.props(opsStyles.table)}>
                  <thead>
                    <tr {...stylex.props(opsStyles.tableRow)}>
                      <th {...stylex.props(opsStyles.tableHead)}>Route</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Status</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Meta code</th>
                      <th {...stylex.props(opsStyles.tableHead)}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metaMetrics.topRoutes.slice(0, 8).map((row, index) => (
                      <tr
                        key={`${row.route}-${row.status}-${index}`}
                        {...stylex.props(opsStyles.tableRow)}
                      >
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.route}
                        </td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.status}
                        </td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.metaErrorCode || '—'}
                          {row.metaErrorSubcode
                            ? `/${row.metaErrorSubcode}`
                            : ''}
                        </td>
                        <td {...stylex.props(opsStyles.tableCell)}>
                          {row.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p {...stylex.props(opsStyles.note)}>No failures in window.</p>
            )}
          </section>
        </div>
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>
            App errors (last 60m)
          </h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void loadOverview()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div {...stylex.props(opsStyles.chartSurface)}>
          <div ref={appErrorsChart.ref} {...stylex.props(opsStyles.chartHost)}>
            <svg
              width="100%"
              height="165"
              viewBox={`0 0 ${errorWidth} ${appErrorsHeight}`}
              role="img"
              aria-label="App errors per minute"
            >
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
          </div>
          <ChartTooltip tooltip={errorTooltip} />
        </div>

        <section {...stylex.props(opsStyles.panel)}>
          <h3 {...stylex.props(opsStyles.panelTitle)}>Top error keys</h3>
          {errorMetrics?.topKeys.length ? (
            <div {...stylex.props(opsStyles.tableWrap)}>
              <table {...stylex.props(opsStyles.table)}>
                <thead>
                  <tr {...stylex.props(opsStyles.tableRow)}>
                    <th {...stylex.props(opsStyles.tableHead)}>Error key</th>
                    <th {...stylex.props(opsStyles.tableHead)}>Kind</th>
                    <th {...stylex.props(opsStyles.tableHead)}>Severity</th>
                    <th {...stylex.props(opsStyles.tableHead)}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {errorMetrics.topKeys.map((row) => (
                    <tr
                      key={`${row.errorKey}-${row.kind}`}
                      {...stylex.props(opsStyles.tableRow)}
                    >
                      <td {...stylex.props(opsStyles.tableCell)}>
                        {row.errorKey}
                      </td>
                      <td {...stylex.props(opsStyles.tableCell)}>{row.kind}</td>
                      <td {...stylex.props(opsStyles.tableCell)}>
                        {row.severity}
                      </td>
                      <td {...stylex.props(opsStyles.tableCell)}>
                        {row.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p {...stylex.props(opsStyles.note)}>No app errors in window.</p>
          )}
        </section>
      </section>

      <section {...stylex.props(opsStyles.section)}>
        <div {...stylex.props(opsStyles.sectionHeader)}>
          <h2 {...stylex.props(opsStyles.sectionTitle)}>User feature flags</h2>
          <div {...stylex.props(opsStyles.sectionActions)}>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void exportAndClearAudit()}
              disabled={auditExporting}
            >
              {auditExporting ? 'Exporting…' : 'Export + clear audit'}
            </button>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={() => void loadOpsUsers()}
            >
              Refresh
            </button>
          </div>
        </div>
        {auditExportStatus ? (
          <p {...stylex.props(opsStyles.note)}>{auditExportStatus}</p>
        ) : null}
        {opsUsersError ? (
          <p {...stylex.props(opsStyles.errorBanner)}>{opsUsersError}</p>
        ) : null}
        {opsUsers.length ? (
          <div {...stylex.props(opsStyles.tableWrap)}>
            <table {...stylex.props(opsStyles.table)}>
              <thead>
                <tr {...stylex.props(opsStyles.tableRow)}>
                  <th {...stylex.props(opsStyles.tableHead)}>User</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Assets</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Followup inbox</th>
                  <th {...stylex.props(opsStyles.tableHead)}>Ops dashboard</th>
                  <th {...stylex.props(opsStyles.tableHead)}>
                    Audit conversations
                  </th>
                  <th {...stylex.props(opsStyles.tableHead)}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {opsUsers.map((user) => (
                  <tr key={user.userId} {...stylex.props(opsStyles.tableRow)}>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <code>{user.userId.slice(0, 8)}</code>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {formatAssets(user.assets)}
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <select
                        value={readFlagValue(
                          user.featureFlags,
                          'FEATURE_FOLLOWUP_INBOX',
                        )}
                        onChange={(event) => {
                          const next = event.target.value;
                          void updateUserFlag(
                            user.userId,
                            'FEATURE_FOLLOWUP_INBOX',
                            next === 'inherit' ? null : next === 'enabled',
                          );
                        }}
                        disabled={opsUsersUpdating === user.userId}
                      >
                        <option value="inherit">Inherit</option>
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <select
                        value={readFlagValue(
                          user.featureFlags,
                          'FEATURE_OPS_DASHBOARD',
                        )}
                        onChange={(event) => {
                          const next = event.target.value;
                          void updateUserFlag(
                            user.userId,
                            'FEATURE_OPS_DASHBOARD',
                            next === 'inherit' ? null : next === 'enabled',
                          );
                        }}
                        disabled={opsUsersUpdating === user.userId}
                      >
                        <option value="inherit">Inherit</option>
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      <select
                        value={readFlagValue(
                          user.featureFlags,
                          'FEATURE_AUDIT_CONVERSATIONS',
                        )}
                        onChange={(event) => {
                          const next = event.target.value;
                          void updateUserFlag(
                            user.userId,
                            'FEATURE_AUDIT_CONVERSATIONS',
                            next === 'inherit' ? null : next === 'enabled',
                          );
                        }}
                        disabled={opsUsersUpdating === user.userId}
                      >
                        <option value="inherit">Inherit</option>
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td {...stylex.props(opsStyles.tableCell)}>
                      {(() => {
                        const backfillResult = backfillByUser[user.userId];
                        return (
                          <>
                            <button
                              {...stylex.props(layout.ghostButton)}
                              disabled={opsUsersBackfilling === user.userId}
                              onClick={() => {
                                void backfillParticipants(user.userId);
                              }}
                            >
                              {opsUsersBackfilling === user.userId
                                ? 'Backfilling…'
                                : 'Backfill participant IDs'}
                            </button>
                            {backfillResult ? (
                              <p {...stylex.props(opsStyles.note)}>
                                Updated {backfillResult.updated}/
                                {backfillResult.scanned} · skipped(no ID){' '}
                                {backfillResult.skippedNoParticipant} · errors{' '}
                                {backfillResult.failed}
                              </p>
                            ) : null}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p {...stylex.props(opsStyles.note)}>No users yet.</p>
        )}
      </section>
    </div>
  );
}
