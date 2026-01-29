import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from '../app/styles';

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
  conversationCount: number;
  messageCount: number;
};

type IgAsset = {
  id: string;
  name: string;
  pageId: string;
  lastSyncedAt: string | null;
  conversationCount: number;
  messageCount: number;
};

type AssetsResponse = {
  pages: PageAsset[];
  igAssets: IgAsset[];
  igEnabled: boolean;
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

const assetGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '12px',
  marginTop: '12px',
};

const assetTileStyle: React.CSSProperties = {
  borderRadius: '16px',
  border: '1px solid #f2f4f8',
  backgroundColor: '#ffffff',
  padding: '16px',
  boxShadow: '0 12px 24px rgba(12, 27, 26, 0.08)',
  display: 'grid',
  gap: '8px',
};

const assetHeadingStyle: React.CSSProperties = {
  fontSize: '20px',
  margin: 0,
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
  const loadedIgAssets = React.useRef(new Set<string>());
  const [loading, setLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [loggingOut, setLoggingOut] = React.useState(false);

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

  const refreshSyncRuns = React.useCallback(
    async (force = false) => {
      const { ok, data } = await fetchJson<SyncRun[]>(
        '/api/sync/runs',
        undefined,
        { force },
      );
      if (!ok) {
        return;
      }
      setSyncRuns(data ?? []);
    },
    [fetchJson],
  );

  React.useEffect(() => {
    void refreshAuth();
    void refreshPermissions();
    void refreshAssets();
    void refreshSyncRuns();
  }, [refreshAssets, refreshAuth, refreshPermissions, refreshSyncRuns]);

  React.useEffect(() => {
    const interval = setInterval(() => {
      void refreshSyncRuns();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshSyncRuns]);

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
      await refreshSyncRuns(true);
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
      await refreshSyncRuns(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Instagram sync failed.',
      );
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setActionError(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setAuth({ authenticated: false });
      setPermissions(null);
      setAssets(null);
      setBusinesses([]);
      setBusinessPages({});
      setClassicPages([]);
      setSyncRuns([]);
      loadedIgAssets.current.clear();
      await Promise.all([
        refreshAuth(true),
        refreshPermissions(true),
        refreshAssets(true),
        refreshSyncRuns(true),
      ]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to log out.',
      );
    } finally {
      setLoggingOut(false);
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
      conversationCount: page.conversationCount,
      messageCount: page.messageCount,
      lastSyncedAt: page.lastSyncedAt,
      run: runByAsset.get(`${page.id}:messenger`),
      onSync: () => handleSyncMessenger(page.id),
    })) ?? []),
    ...(assets?.igAssets.map((asset) => ({
      key: `ig:${asset.id}`,
      name: asset.name || `Instagram ${asset.id}`,
      conversationCount: asset.conversationCount,
      messageCount: asset.messageCount,
      lastSyncedAt: asset.lastSyncedAt,
      run: runByAsset.get(`${asset.pageId}:instagram:${asset.id}`),
      onSync: () => handleSyncInstagram(asset.pageId, asset.id),
    })) ?? []),
  ];

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(layout.card)}>
        <h2>Connect Meta</h2>
        <p {...stylex.props(layout.note)}>
          Sign in with Facebook to load your businesses and messaging assets.
        </p>
        {!auth?.authenticated || permissions?.missing.length ? (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <a href="/api/auth/login">
              <button {...stylex.props(layout.button)}>Connect Meta</button>
            </a>
            {permissions?.missing.length ? (
              <button {...stylex.props(layout.ghostButton)}>Reconnect</button>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <p {...stylex.props(layout.note)}>
              Connected as {auth.name || auth.userId}
            </p>
            <button
              {...stylex.props(layout.ghostButton)}
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        )}
        {permissions?.missing.length ? (
          <p style={{ color: colors.coral }}>
            Missing permissions: {permissions.missing.join(', ')}
          </p>
        ) : null}
        {permissions?.error ? (
          <p style={{ color: colors.coral }}>{permissions.error}</p>
        ) : null}
      </section>

      <section {...stylex.props(layout.card)}>
        <h2>Businesses & Pages</h2>
        <p {...stylex.props(layout.note)}>
          Businesses and pages load automatically. Enable a page to store its
          token securely.
        </p>
        {loading ? (
          <p {...stylex.props(layout.note)}>Loading businesses…</p>
        ) : null}
        {businesses.length === 0 && !loading ? (
          <p {...stylex.props(layout.note)}>
            No businesses loaded yet. Connect Meta to load businesses.
          </p>
        ) : null}
        {businesses.map((business) => (
          <div key={business.id} style={{ marginTop: '12px' }}>
            <strong>{business.name}</strong>
            <div style={{ display: 'grid', gap: '10px', marginTop: '8px' }}>
              {(businessPages[business.id] ?? []).map((page) => {
                const enabled = enabledPages.has(page.id);
                return (
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
                      {enabled ? 'Refresh token' : 'Enable page'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {filteredClassicPages.length ? (
        <section {...stylex.props(layout.card)}>
          <h2>Classic Pages</h2>
          <p {...stylex.props(layout.note)}>
            Pages discovered via /me/accounts (fallback for non-business pages).
          </p>
          <ul>
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

      <section {...stylex.props(layout.card)}>
        <h2>Enabled assets</h2>
        <p {...stylex.props(layout.note)}>
          Sync Messenger and Instagram. Each asset shows its own sync progress.
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
                  <h3 style={assetHeadingStyle}>{asset.name}</h3>
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
                          Last update: {formatRelativeTime(asset.lastSyncedAt)}
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
    </div>
  );
}
