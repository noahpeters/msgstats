import * as React from 'react';
import * as d3 from 'd3';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from '../app/styles';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';
import {
  buildSyncRunsWsUrl,
  buildSyncRunKey,
  sendSyncRunsSubscribe,
} from '../utils/syncRunsWebsocket';

type PermissionResponse = {
  hasToken: boolean;
  permissions: { permission: string; status: string }[];
  missing: string[];
  error?: string;
};

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  name?: string | null;
};

type MetaBusiness = {
  id: string;
  name: string;
};

type MetaPage = {
  id: string;
  name: string;
  source?: 'owned_pages' | 'client_pages';
};

type PageAsset = {
  id: string;
  name: string;
  lastSyncedAt: string | null;
  lastSyncFinishedAt: string | null;
  conversationCount: number;
  messageCount: number;
};

type IgAsset = {
  id: string;
  name: string;
  pageId: string;
  lastSyncedAt: string | null;
  lastSyncFinishedAt: string | null;
  conversationCount: number;
  messageCount: number;
};

type AssetsResponse = {
  pages: PageAsset[];
  igAssets: IgAsset[];
  igEnabled: boolean;
};

type FollowupCount = {
  count: number;
};

type SyncRun = {
  id: string;
  pageId: string;
  platform: string;
  igBusinessId?: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  conversations: number;
  messages: number;
};

type FollowupSeriesPoint = {
  t: string;
  events: number;
  revived: number;
  immediate_loss: number;
};

type FollowupSeriesResponse = {
  bucket: 'hour' | 'day' | 'week' | 'month';
  range: '24h' | '7d' | '30d' | '90d';
  series: FollowupSeriesPoint[];
};

const dashboardTokens = {
  dividerColor: 'rgba(12, 27, 26, 0.14)',
} as const;

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

const formatSyncStatus = (status: string) => {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Updating';
  if (status === 'failed') return 'Last sync failed';
  return 'Last sync';
};

const defaultBucketForRange = (range: FollowupSeriesResponse['range']) => {
  if (range === '24h') return 'hour';
  if (range === '90d') return 'week';
  return 'day';
};

function useContainerWidth(defaultWidth = 520) {
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
    return () => observer.disconnect();
  }, [defaultWidth]);

  return { ref, width: Math.max(320, width) };
}

function FollowupBarChart({
  title,
  points,
  keyName,
  bucket,
  yMax,
  onHover,
  onMove,
  onLeave,
}: {
  title: string;
  points: FollowupSeriesPoint[];
  keyName: 'events' | 'revived' | 'immediate_loss';
  bucket: FollowupSeriesResponse['bucket'];
  yMax: number;
  onHover: (
    event: React.MouseEvent<SVGRectElement, MouseEvent>,
    point: FollowupSeriesPoint,
    value: number,
  ) => void;
  onMove: (event: React.MouseEvent<SVGRectElement, MouseEvent>) => void;
  onLeave: () => void;
}) {
  const chart = useContainerWidth(520);
  const xAxisRef = React.useRef<SVGGElement | null>(null);
  const yAxisRef = React.useRef<SVGGElement | null>(null);
  const width = chart.width;
  const height = 190;
  const margin = { top: 10, right: 10, bottom: 28, left: 36 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const parsed = React.useMemo(
    () =>
      points.map((point) => ({
        ...point,
        d: new Date(point.t),
        v: Number(point[keyName] ?? 0),
      })),
    [points, keyName],
  );
  const firstDate = parsed[0]?.d ?? new Date();
  const lastDate = parsed[parsed.length - 1]?.d ?? firstDate;
  const safeMax = Math.max(1, yMax);
  const x = d3
    .scaleTime()
    .domain([firstDate, lastDate])
    .range([0, Math.max(1, innerWidth)]);
  const y = d3
    .scaleLinear()
    .domain([0, safeMax])
    .nice()
    .range([innerHeight, 0]);
  const barWidth = parsed.length ? Math.max(1, innerWidth / parsed.length) : 1;

  React.useEffect(() => {
    if (!parsed.length) {
      return;
    }
    const xTickFormat =
      bucket === 'hour'
        ? d3.timeFormat('%H:%M')
        : bucket === 'month'
          ? d3.timeFormat('%b %Y')
          : d3.timeFormat('%b %d');
    const xAxis = d3
      .axisBottom(x)
      .ticks(Math.max(3, Math.min(6, parsed.length)))
      .tickFormat(xTickFormat as (d: Date) => string);
    const yAxis = d3.axisLeft(y).ticks(4).tickFormat(d3.format('~s'));
    if (xAxisRef.current) {
      d3.select(xAxisRef.current).call(xAxis);
    }
    if (yAxisRef.current) {
      d3.select(yAxisRef.current).call(yAxis);
    }
  }, [bucket, parsed, x, y]);

  return (
    <div style={assetTileStyle}>
      <h3 style={{ margin: 0, fontSize: '14px' }}>{title}</h3>
      <div ref={chart.ref} style={{ width: '100%', minHeight: '170px' }}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {parsed.map((point) => {
              const xPos = x(point.d) - barWidth / 2;
              const yPos = y(point.v);
              const h =
                point.v <= 0 ? 0 : Math.max(1, Math.round(innerHeight - yPos));
              return (
                <rect
                  key={`${keyName}-${point.t}`}
                  x={xPos}
                  y={yPos}
                  width={Math.max(1, barWidth - 1)}
                  height={h}
                  fill="#0f766e"
                  opacity={0.85}
                  onMouseEnter={(event) => onHover(event, point, point.v)}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                />
              );
            })}
            <g
              ref={xAxisRef}
              transform={`translate(0, ${innerHeight})`}
              style={{ color: '#284b63', fontSize: '11px' }}
            />
            <g ref={yAxisRef} style={{ color: '#284b63', fontSize: '11px' }} />
          </g>
        </svg>
      </div>
    </div>
  );
}

const assetGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '12px',
  marginTop: '12px',
};

const assetTileStyle: React.CSSProperties = {
  borderRadius: '10px',
  border: `1px solid ${dashboardTokens.dividerColor}`,
  backgroundColor: '#ffffff',
  padding: '14px',
  display: 'grid',
  gap: '8px',
};

const assetHeadingStyle: React.CSSProperties = {
  fontSize: '20px',
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const assetBodyRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
};

const assetFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
};

const updateButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
};

const assetIconStyle: React.CSSProperties = {
  width: '18px',
  height: '18px',
  color: colors.slate,
  flexShrink: 0,
};

const dashboardStyles = stylex.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '16px',
    border: `1px solid ${dashboardTokens.dividerColor}`,
    boxShadow: 'none',
  },
  list: {
    margin: 0,
    paddingLeft: '18px',
    display: 'grid',
    gap: '8px',
  },
  degradedBanner: {
    marginTop: '12px',
    marginBottom: '14px',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #fdba74',
    backgroundColor: '#fff7ed',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  degradedText: {
    color: '#7c2d12',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '14px',
  },
  chartControls: {
    display: 'inline-flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  chartControl: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  select: {
    border: '1px solid rgba(12, 27, 26, 0.2)',
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#0c1b1a',
    fontSize: '12px',
    padding: '4px 8px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
});

const AssetPlatformIcon = ({
  platform,
}: {
  platform: 'facebook' | 'instagram';
}) => {
  if (platform === 'instagram') {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        style={assetIconStyle}
      >
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="5"
          ry="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle
          cx="12"
          cy="12"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="17" cy="7" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={assetIconStyle}
    >
      <path
        fill="currentColor"
        d="M13.5 8.5V7.1c0-.7.5-1.1 1.2-1.1H16V3.6c-.5-.1-1.4-.2-2.5-.2-2.5 0-4.2 1.5-4.2 4.3v1.8H7.5V12h1.8v8.4h3.3V12h2.2l.4-2.5h-2.6z"
      />
    </svg>
  );
};

export default function Dashboard(): React.ReactElement {
  const inflightRequests = React.useRef(
    new Map<string, Promise<{ ok: boolean; data?: unknown }>>(),
  );
  const lastRequestAt = React.useRef(new Map<string, number>());
  const debounceMs = 500;

  const fetchJson = React.useCallback(
    async <T,>(
      url: string,
      init?: RequestInit,
      options?: { key?: string; force?: boolean },
    ): Promise<{ ok: boolean; data?: T }> => {
      const method = init?.method ?? 'GET';
      const cacheKey = options?.key ?? `${method}:${url}`;
      const isGet = method.toUpperCase() === 'GET';

      if (isGet && !options?.force) {
        const now = Date.now();
        const last = lastRequestAt.current.get(cacheKey) ?? 0;
        const existing = inflightRequests.current.get(cacheKey);
        if (existing && now - last < debounceMs) {
          return (await existing) as { ok: boolean; data?: T };
        }
        lastRequestAt.current.set(cacheKey, now);
        const promise = (async () => {
          const response = await fetch(url, init);
          let data: T | undefined;
          try {
            if (
              response.headers.get('content-type')?.includes('application/json')
            ) {
              data = (await response.json()) as T;
            }
          } catch {
            data = undefined;
          }
          return { ok: response.ok, data };
        })();
        inflightRequests.current.set(cacheKey, promise);
        try {
          return (await promise) as { ok: boolean; data?: T };
        } finally {
          inflightRequests.current.delete(cacheKey);
        }
      }

      const response = await fetch(url, init);
      let data: T | undefined;
      try {
        if (
          response.headers.get('content-type')?.includes('application/json')
        ) {
          data = (await response.json()) as T;
        }
      } catch {
        data = undefined;
      }
      return { ok: response.ok, data };
    },
    [],
  );

  const [auth, setAuth] = React.useState<AuthResponse | null>(null);
  const [permissions, setPermissions] =
    React.useState<PermissionResponse | null>(null);
  const [assets, setAssets] = React.useState<AssetsResponse | null>(null);
  const [businesses, setBusinesses] = React.useState<MetaBusiness[]>([]);
  const [businessPages, setBusinessPages] = React.useState<
    Record<string, MetaPage[]>
  >({});
  const [classicPages, setClassicPages] = React.useState<MetaPage[]>([]);
  const [syncRuns, setSyncRuns] = React.useState<SyncRun[]>([]);
  const syncRunStatuses = React.useRef(new Map<string, string>());
  const loadedIgAssets = React.useRef(new Set<string>());
  const [followupCount, setFollowupCount] =
    React.useState<FollowupCount | null>(null);
  const [followupRange, setFollowupRange] =
    React.useState<FollowupSeriesResponse['range']>('30d');
  const [followupBucket, setFollowupBucket] =
    React.useState<FollowupSeriesResponse['bucket']>('day');
  const [followupSeries, setFollowupSeries] = React.useState<
    FollowupSeriesPoint[]
  >([]);
  const [flags, setFlags] = React.useState<{
    followupInbox?: boolean;
    opsDashboard?: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const {
    tooltip: followupTooltip,
    show: showFollowupTooltip,
    move: moveFollowupTooltip,
    hide: hideFollowupTooltip,
  } = useChartTooltip();

  const refreshAuth = React.useCallback(
    async (force = false) => {
      const { ok, data } = await fetchJson<AuthResponse>(
        '/api/auth/me',
        undefined,
        {
          force,
        },
      );
      if (!ok) {
        setAuth({ authenticated: false });
        return;
      }
      setAuth(data ?? { authenticated: false });
    },
    [fetchJson],
  );

  const refreshPermissions = React.useCallback(
    async (force = false) => {
      const { ok, data } = await fetchJson<PermissionResponse>(
        '/api/meta/permissions',
        undefined,
        { force },
      );
      if (!ok) {
        return;
      }
      setPermissions(data ?? null);
    },
    [fetchJson],
  );

  const refreshAssets = React.useCallback(
    async (force = false) => {
      const { ok, data } = await fetchJson<AssetsResponse>(
        '/api/assets',
        undefined,
        {
          force,
        },
      );
      if (!ok) {
        return;
      }
      setAssets(data ?? null);
    },
    [fetchJson],
  );

  const refreshFollowupCount = React.useCallback(
    async (force = false) => {
      if (!flags?.followupInbox) {
        return;
      }
      const { ok, data } = await fetchJson<FollowupCount>(
        '/api/inbox/conversations/count?needs_followup=true',
        undefined,
        { force },
      );
      if (!ok) {
        return;
      }
      setFollowupCount(data ?? null);
    },
    [fetchJson, flags?.followupInbox],
  );

  const refreshFlags = React.useCallback(async () => {
    const { ok, data } = await fetchJson<{
      followupInbox?: boolean;
      opsDashboard?: boolean;
    }>('/api/feature-flags');
    if (!ok) return;
    setFlags(data ?? null);
  }, [fetchJson]);

  const refreshFollowupSeries = React.useCallback(
    async (force = false) => {
      const params = new URLSearchParams({
        range: followupRange,
        bucket: followupBucket,
      });
      const { ok, data } = await fetchJson<FollowupSeriesResponse>(
        `/api/followup/series?${params.toString()}`,
        undefined,
        {
          force,
          key: `GET:/api/followup/series?${params.toString()}`,
        },
      );
      if (!ok) {
        return;
      }
      setFollowupSeries(data?.series ?? []);
    },
    [fetchJson, followupBucket, followupRange],
  );

  React.useEffect(() => {
    void refreshAuth();
    void refreshPermissions();
    void refreshAssets();
    void refreshFlags();
  }, [refreshAssets, refreshAuth, refreshPermissions, refreshFlags]);

  React.useEffect(() => {
    if (flags?.followupInbox) {
      void refreshFollowupCount(true);
    }
    void refreshFollowupSeries(true);
  }, [flags?.followupInbox, refreshFollowupCount, refreshFollowupSeries]);

  React.useEffect(() => {
    void refreshFollowupSeries();
  }, [refreshFollowupSeries]);

  const mergeRunUpdate = React.useCallback((run: SyncRun) => {
    setSyncRuns((prev) => {
      const next = [...prev];
      const hasKeyFields = Boolean(run.pageId && run.platform);
      const targetKey = hasKeyFields ? buildSyncRunKey(run) : null;
      const index = hasKeyFields
        ? next.findIndex((existing) => buildSyncRunKey(existing) === targetKey)
        : next.findIndex((existing) => existing.id === run.id);
      if (index >= 0) {
        next[index] = { ...next[index], ...run };
      } else {
        next.push(run);
      }
      next.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    let attempts = 0;
    let cancelled = false;

    const connect = () => {
      if (socket) {
        socket.close();
      }
      const wsUrl = buildSyncRunsWsUrl(
        window.location.hostname,
        window.location.protocol,
        window.location.host,
      );
      const currentSocket = new WebSocket(wsUrl);
      socket = currentSocket;
      currentSocket.addEventListener('open', () => {
        attempts = 0;
        sendSyncRunsSubscribe(currentSocket, auth.userId);
      });
      currentSocket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            run?: SyncRun;
          };
          if (payload.type === 'run_updated' && payload.run) {
            mergeRunUpdate(payload.run);
          }
        } catch {
          // Ignore malformed payloads
        }
      });
      currentSocket.addEventListener('close', () => {
        if (cancelled || socket !== currentSocket) {
          return;
        }
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(1000 * 2 ** attempts, 10000) + jitter;
        attempts += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, [auth?.authenticated, auth?.userId, mergeRunUpdate]);

  React.useEffect(() => {
    let shouldRefresh = false;
    for (const run of syncRuns) {
      const prevStatus = syncRunStatuses.current.get(run.id);
      const completedNow =
        run.status === 'completed' && prevStatus !== 'completed';
      const failedNow = run.status === 'failed' && prevStatus !== 'failed';
      if (completedNow || failedNow) {
        shouldRefresh = true;
      }
      syncRunStatuses.current.set(run.id, run.status);
    }
    if (shouldRefresh) {
      void refreshAssets(true);
    }
  }, [refreshAssets, syncRuns]);

  const [businessesLoaded, setBusinessesLoaded] = React.useState(false);

  const loadBusinesses = React.useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const { ok, data } = await fetchJson<MetaBusiness[]>(
        '/api/meta/businesses',
      );
      if (!ok) {
        const errorPayload = data as { error?: string } | undefined;
        throw new Error(errorPayload?.error ?? 'Failed to load businesses.');
      }
      const businessesData = data ?? [];
      setBusinesses(businessesData);
      const pagesByBusiness: Record<string, MetaPage[]> = {};
      for (const business of businessesData) {
        const { ok: pagesOk, data: pagesData } = await fetchJson<MetaPage[]>(
          `/api/meta/businesses/${business.id}/pages`,
        );
        if (pagesOk) {
          pagesByBusiness[business.id] = pagesData ?? [];
        }
      }
      setBusinessPages(pagesByBusiness);
      setBusinessesLoaded(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to load businesses.',
      );
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadClassicPages = React.useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<MetaPage[]>('/api/meta/accounts');
      if (!ok) {
        return;
      }
      setClassicPages(data ?? []);
    } catch {
      setClassicPages([]);
    }
  }, [fetchJson]);

  const handleEnablePage = async (pageId: string, name: string) => {
    setActionError(null);
    try {
      const response = await fetch(`/api/meta/pages/${pageId}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Failed to enable page.');
      }
      await refreshAssets(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Enable page failed.',
      );
    }
  };

  const handleSyncMessenger = async (pageId: string) => {
    setActionError(null);
    try {
      const response = await fetch(`/api/sync/pages/${pageId}/messenger`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Sync failed to start.');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Sync failed.');
    }
  };

  const handleSyncInstagram = async (pageId: string, igId: string) => {
    setActionError(null);
    try {
      const response = await fetch(
        `/api/sync/pages/${pageId}/instagram/${igId}`,
        {
          method: 'POST',
        },
      );
      if (!response.ok) {
        throw new Error('Instagram sync failed.');
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Instagram sync failed.',
      );
    }
  };

  const loadIgAssets = React.useCallback(
    async (pageId: string) => {
      if (loadedIgAssets.current.has(pageId)) {
        return;
      }
      loadedIgAssets.current.add(pageId);
      const { ok } = await fetchJson<{ igAssets: IgAsset[] }>(
        `/api/meta/pages/${pageId}/ig-assets`,
        { cache: 'no-store' },
      );
      if (!ok) {
        loadedIgAssets.current.delete(pageId);
        return;
      }
      await refreshAssets(true);
    },
    [fetchJson, refreshAssets],
  );

  React.useEffect(() => {
    if (!assets?.pages.length) {
      return;
    }
    assets.pages.forEach((page) => {
      void loadIgAssets(page.id);
    });
  }, [assets, loadIgAssets]);

  React.useEffect(() => {
    void loadClassicPages();
  }, [loadClassicPages]);

  React.useEffect(() => {
    if (businessesLoaded) {
      return;
    }
    if (!auth?.authenticated || permissions?.missing?.length) {
      return;
    }
    void loadBusinesses();
  }, [auth?.authenticated, businessesLoaded, loadBusinesses, permissions]);

  const enabledPages = new Map(
    assets?.pages.map((page) => [page.id, page]) ?? [],
  );
  const businessPageIds = new Set(
    businesses.flatMap((business) =>
      (businessPages[business.id] ?? []).map((page) => page.id),
    ),
  );
  const filteredClassicPages = classicPages.filter(
    (page) => !businessPageIds.has(page.id),
  );
  const runByAsset = new Map<string, SyncRun>();
  for (const run of syncRuns) {
    const key =
      run.platform === 'instagram'
        ? `${run.pageId}:${run.platform}:${run.igBusinessId ?? ''}`
        : `${run.pageId}:${run.platform}`;
    if (!runByAsset.has(key)) {
      runByAsset.set(key, run);
    }
  }

  const enabledAssets = [
    ...(assets?.pages.map((page) => ({
      key: `page:${page.id}`,
      name: page.name || `Page ${page.id}`,
      platform: 'facebook' as const,
      conversationCount: page.conversationCount,
      messageCount: page.messageCount,
      lastSyncedAt: page.lastSyncFinishedAt,
      run: runByAsset.get(`${page.id}:messenger`),
      onSync: () => handleSyncMessenger(page.id),
    })) ?? []),
    ...(assets?.igAssets.map((asset) => ({
      key: `ig:${asset.id}`,
      name: asset.name || `Instagram ${asset.id}`,
      platform: 'instagram' as const,
      conversationCount: asset.conversationCount,
      messageCount: asset.messageCount,
      lastSyncedAt: asset.lastSyncFinishedAt,
      run: runByAsset.get(`${asset.pageId}:instagram:${asset.id}`),
      onSync: () => handleSyncInstagram(asset.pageId, asset.id),
    })) ?? []),
  ];

  const businessPagesToShow = businesses
    .map((business) => ({
      business,
      pages: (businessPages[business.id] ?? []).filter(
        (page) => !enabledPages.has(page.id),
      ),
    }))
    .filter((entry) => entry.pages.length > 0);
  const showBusinessesCard = loading || businessPagesToShow.length > 0;
  const availableClassicCount = filteredClassicPages.length;
  const availableBusinessCount = businessPagesToShow.reduce(
    (count, entry) => count + entry.pages.length,
    0,
  );
  const availableEnableCount = availableClassicCount + availableBusinessCount;

  const latestSyncDate = enabledAssets
    .map((asset) =>
      asset.lastSyncedAt && !Number.isNaN(Date.parse(asset.lastSyncedAt))
        ? new Date(asset.lastSyncedAt)
        : null,
    )
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const exactLatestSync = latestSyncDate
    ? latestSyncDate.toLocaleString()
    : 'Never';

  const recentRuns = syncRuns.slice(0, 20);
  const failedRuns = recentRuns.filter((run) => run.status === 'failed').length;
  const runningRuns = recentRuns.filter(
    (run) => run.status === 'running' || run.status === 'queued',
  ).length;
  const errorRateSummary =
    recentRuns.length > 0
      ? `${Math.round((failedRuns / recentRuns.length) * 100)}% (${failedRuns}/${recentRuns.length})`
      : 'No recent runs';

  const hoursSinceSync = latestSyncDate
    ? (Date.now() - latestSyncDate.getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  const hasPermissionIssue =
    Boolean(permissions?.missing.length) || Boolean(permissions?.error);
  const delayedSync =
    enabledAssets.length > 0 &&
    !hasPermissionIssue &&
    failedRuns === 0 &&
    runningRuns === 0 &&
    hoursSinceSync > 24;

  const syncStatus = hasPermissionIssue
    ? 'Error'
    : failedRuns > 0
      ? 'Error'
      : runningRuns > 0
        ? 'Healthy'
        : delayedSync
          ? 'Delayed'
          : 'Healthy';

  const showDegradedBanner =
    hasPermissionIssue || failedRuns > 0 || delayedSync;
  const followupSharedMax = React.useMemo(
    () =>
      Math.max(
        1,
        ...followupSeries.map((point) =>
          Math.max(point.events, point.revived, point.immediate_loss),
        ),
      ),
    [followupSeries],
  );
  const followupBucketFormatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: followupBucket === 'hour' ? 'numeric' : undefined,
  });

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(dashboardStyles.card)}>
        <h2>Status</h2>
        <p {...stylex.props(layout.note)}>
          Current sync health across your enabled messaging assets.
        </p>
        {showDegradedBanner ? (
          <div {...stylex.props(dashboardStyles.degradedBanner)}>
            <span {...stylex.props(dashboardStyles.degradedText)}>
              {hasPermissionIssue
                ? `Permissions need attention${permissions?.missing?.length ? `: ${permissions.missing.join(', ')}` : '.'}`
                : failedRuns > 0
                  ? `${failedRuns} recent sync runs failed.`
                  : 'Sync is delayed beyond 24 hours.'}
            </span>
            {failedRuns > 0 && flags?.opsDashboard ? (
              <a href="/ops-dashboard" title="View errors">
                <button {...stylex.props(layout.button)}>View errors</button>
              </a>
            ) : (
              <button
                {...stylex.props(layout.button)}
                onClick={() => {
                  void Promise.all([
                    refreshPermissions(true),
                    refreshAssets(true),
                    refreshFollowupCount(true),
                    refreshFollowupSeries(true),
                  ]);
                }}
              >
                Refresh status
              </button>
            )}
          </div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
            marginTop: '8px',
          }}
        >
          <div style={assetTileStyle}>
            <div {...stylex.props(layout.note)}>Last sync</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>
              {formatRelativeTime(latestSyncDate?.toISOString() ?? null)}
            </div>
            <div {...stylex.props(layout.note)}>{exactLatestSync}</div>
          </div>
          <div style={assetTileStyle}>
            <div {...stylex.props(layout.note)}>Sync status</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>
              {syncStatus}
            </div>
            <div {...stylex.props(layout.note)}>
              {runningRuns > 0
                ? `${runningRuns} runs in progress`
                : 'No active runs'}
            </div>
          </div>
          <div style={assetTileStyle}>
            <div {...stylex.props(layout.note)}>Error rate</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>
              {errorRateSummary}
            </div>
            <div {...stylex.props(layout.note)}>Based on recent sync runs</div>
          </div>
        </div>
      </section>

      <section {...stylex.props(dashboardStyles.card)}>
        <h2>Activity</h2>
        <p {...stylex.props(layout.note)}>
          Sync activity and volume by asset. Window: Last 24 hours.
        </p>
        {actionError ? (
          <p style={{ color: colors.coral }}>{actionError}</p>
        ) : null}
        {enabledAssets.length ? (
          <div style={assetGridStyle}>
            {enabledAssets.map((asset) => {
              const run = asset.run;
              const isSyncing =
                run?.status === 'queued' || run?.status === 'running';
              const isFailed = run?.status === 'failed';
              return (
                <div key={asset.key} style={assetTileStyle}>
                  <h3 style={assetHeadingStyle}>
                    <AssetPlatformIcon platform={asset.platform} />
                    <span>{asset.name}</span>
                  </h3>
                  <p
                    {...stylex.props(layout.note)}
                    style={{ margin: 0, marginTop: '-2px' }}
                  >
                    Last 24 hours
                  </p>
                  <div style={assetBodyRowStyle}>
                    <span {...stylex.props(layout.note)}>
                      Conversations: {asset.conversationCount}
                    </span>
                    <span {...stylex.props(layout.note)}>
                      Messages: {asset.messageCount}
                    </span>
                  </div>
                  {isSyncing ? (
                    <div {...stylex.props(layout.note)}>
                      {formatSyncStatus(run?.status ?? '')} · Conversations:{' '}
                      {run?.conversations ?? 0}
                    </div>
                  ) : (
                    <>
                      {isFailed ? (
                        <div {...stylex.props(layout.note)}>
                          <span style={{ color: colors.coral }}>
                            Last sync failed
                          </span>
                          {run?.lastError ? `: ${run.lastError}` : null}
                        </div>
                      ) : null}
                      <div style={assetFooterStyle}>
                        <span {...stylex.props(layout.note)}>
                          Last sync: {formatRelativeTime(asset.lastSyncedAt)}
                        </span>
                        <button
                          {...stylex.props(layout.ghostButton)}
                          style={updateButtonStyle}
                          onClick={asset.onSync}
                        >
                          Update
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p {...stylex.props(layout.note)}>No enabled pages yet.</p>
        )}
      </section>

      <section {...stylex.props(dashboardStyles.card)}>
        <h2>Action</h2>
        <p {...stylex.props(layout.note)}>
          Prioritized items that need follow-up or setup work.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
            marginTop: '8px',
          }}
        >
          {flags?.followupInbox ? (
            <div style={assetTileStyle}>
              <div {...stylex.props(layout.note)}>Needs follow-up</div>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>
                {followupCount?.count ?? 0}
              </div>
              <a href="/inbox/follow-up" title="Follow-up inbox">
                <button {...stylex.props(layout.button)}>Open inbox</button>
              </a>
            </div>
          ) : null}
          {availableEnableCount > 0 || showBusinessesCard ? (
            <div style={assetTileStyle}>
              <div {...stylex.props(layout.note)}>Needs setup</div>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>
                {availableEnableCount}
              </div>
              <p {...stylex.props(layout.note)} style={{ margin: 0 }}>
                Pages available to enable and sync.
              </p>
            </div>
          ) : null}
          {failedRuns > 0 && flags?.opsDashboard ? (
            <div style={assetTileStyle}>
              <div {...stylex.props(layout.note)}>Failed syncs</div>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>
                {failedRuns}
              </div>
              <a href="/ops-dashboard" title="Ops dashboard">
                <button {...stylex.props(layout.button)}>
                  Review failures
                </button>
              </a>
            </div>
          ) : null}
        </div>
      </section>

      <section {...stylex.props(dashboardStyles.card)}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Follow-up Analytics</h2>
            <p {...stylex.props(layout.note)} style={{ margin: '6px 0 0 0' }}>
              Follow-up events, revived outcomes, and immediate loss.
            </p>
          </div>
          <div {...stylex.props(dashboardStyles.chartControls)}>
            <label {...stylex.props(dashboardStyles.chartControl)}>
              Range
              <select
                {...stylex.props(dashboardStyles.select)}
                value={followupRange}
                onChange={(event) => {
                  const nextRange = event.target
                    .value as FollowupSeriesResponse['range'];
                  setFollowupRange(nextRange);
                  setFollowupBucket(defaultBucketForRange(nextRange));
                }}
              >
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
                <option value="90d">90d</option>
              </select>
            </label>
            <label {...stylex.props(dashboardStyles.chartControl)}>
              Bucket
              <select
                {...stylex.props(dashboardStyles.select)}
                value={followupBucket}
                onChange={(event) =>
                  setFollowupBucket(
                    event.target.value as FollowupSeriesResponse['bucket'],
                  )
                }
              >
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          </div>
        </div>
        <div style={assetGridStyle}>
          <FollowupBarChart
            title="Follow-up events"
            points={followupSeries}
            keyName="events"
            bucket={followupBucket}
            yMax={followupSharedMax}
            onHover={(event, point, value) =>
              showFollowupTooltip(event, {
                title: followupBucketFormatter.format(new Date(point.t)),
                lines: [`Events: ${value}`, point.t],
              })
            }
            onMove={moveFollowupTooltip}
            onLeave={hideFollowupTooltip}
          />
          <FollowupBarChart
            title="Revived"
            points={followupSeries}
            keyName="revived"
            bucket={followupBucket}
            yMax={followupSharedMax}
            onHover={(event, point, value) =>
              showFollowupTooltip(event, {
                title: followupBucketFormatter.format(new Date(point.t)),
                lines: [`Revived: ${value}`, point.t],
              })
            }
            onMove={moveFollowupTooltip}
            onLeave={hideFollowupTooltip}
          />
          <FollowupBarChart
            title="Immediate loss"
            points={followupSeries}
            keyName="immediate_loss"
            bucket={followupBucket}
            yMax={followupSharedMax}
            onHover={(event, point, value) =>
              showFollowupTooltip(event, {
                title: followupBucketFormatter.format(new Date(point.t)),
                lines: [`Immediate loss: ${value}`, point.t],
              })
            }
            onMove={moveFollowupTooltip}
            onLeave={hideFollowupTooltip}
          />
        </div>
        <ChartTooltip tooltip={followupTooltip} />
      </section>

      {showBusinessesCard ? (
        <section {...stylex.props(dashboardStyles.card)}>
          <h3 style={{ marginTop: 0 }}>Available business pages</h3>
          <p {...stylex.props(layout.note)}>
            Businesses and pages load automatically. Enable a page to store its
            token securely.
          </p>
          {loading ? (
            <p {...stylex.props(layout.note)}>Loading businesses…</p>
          ) : null}
          {businessPagesToShow.map(({ business, pages }) => (
            <div key={business.id} style={{ marginTop: '12px' }}>
              <strong>{business.name}</strong>
              <div style={{ display: 'grid', gap: '10px', marginTop: '8px' }}>
                {pages.map((page) => (
                  <div
                    key={page.id}
                    style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}
                  >
                    <div>
                      {page.name}{' '}
                      <span style={{ color: colors.slate }}>({page.id})</span>
                      {page.source ? (
                        <span
                          {...stylex.props(layout.badge)}
                          style={{ marginLeft: '8px' }}
                        >
                          {page.source.replace('_', ' ')}
                        </span>
                      ) : null}
                    </div>
                    <button
                      {...stylex.props(layout.ghostButton)}
                      onClick={() => handleEnablePage(page.id, page.name)}
                    >
                      Enable page
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {filteredClassicPages.length > 0 ? (
        <section {...stylex.props(dashboardStyles.card)}>
          <h3 style={{ marginTop: 0 }}>Classic pages</h3>
          <p {...stylex.props(layout.note)}>
            Pages discovered via /me/accounts (fallback for non-business pages).
          </p>
          <ul {...stylex.props(dashboardStyles.list)}>
            {filteredClassicPages.map((page) => (
              <li key={page.id}>
                {page.name}{' '}
                <span style={{ color: colors.slate }}>({page.id})</span>
                <button
                  {...stylex.props(layout.ghostButton)}
                  style={{ marginLeft: '8px' }}
                  onClick={() => handleEnablePage(page.id, page.name)}
                >
                  Enable page
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
