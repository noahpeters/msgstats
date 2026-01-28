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

const formatSyncStatus = (status: string) => {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Syncing';
  if (status === 'failed') return 'Last sync failed';
  return 'Last sync';
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
  const [igAssetsByPage, setIgAssetsByPage] = React.useState<
    Record<string, IgAsset[]>
  >({});
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
      setIgAssetsByPage({});
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
      const { ok, data } = await fetchJson<{ igAssets: IgAsset[] }>(
        `/api/meta/pages/${pageId}/ig-assets`,
        { cache: 'no-store' },
      );
      if (!ok) {
        return;
      }
      setIgAssetsByPage((current) => ({
        ...current,
        [pageId]: data?.igAssets ?? [],
      }));
    },
    [fetchJson],
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
        {assets?.pages.length ? (
          <div style={{ display: 'grid', gap: '16px' }}>
            {assets.pages.map((page) => {
              const run = runByAsset.get(`${page.id}:messenger`);
              return (
                <div
                  key={page.id}
                  style={{
                    borderTop: `1px solid ${colors.cloud}`,
                    paddingTop: '12px',
                  }}
                >
                  <strong>{page.name || `Page ${page.id}`}</strong>
                  <div {...stylex.props(layout.note)}>
                    Conversations: {page.conversationCount} · Messages:{' '}
                    {page.messageCount}
                  </div>
                  <div {...stylex.props(layout.note)}>
                    Last sync:{' '}
                    {page.lastSyncedAt
                      ? new Date(page.lastSyncedAt).toLocaleString()
                      : 'Never'}
                  </div>
                  {run ? (
                    <div {...stylex.props(layout.note)}>
                      {formatSyncStatus(run.status)}
                      {run.status === 'queued' ? null : (
                        <>
                          {' '}
                          · {run.conversations} convos · {run.messages} msgs
                        </>
                      )}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap',
                      marginTop: '8px',
                    }}
                  >
                    <button
                      {...stylex.props(layout.button)}
                      onClick={() => handleSyncMessenger(page.id)}
                    >
                      Sync Messenger
                    </button>
                  </div>
                  {assets.igEnabled ? (
                    <div style={{ marginTop: '8px' }}>
                      <div {...stylex.props(layout.note)}>
                        Instagram accounts
                      </div>
                      {(igAssetsByPage[page.id] ?? []).length ? (
                        <ul>
                          {(igAssetsByPage[page.id] ?? []).map((asset) => {
                            const igRun = runByAsset.get(
                              `${page.id}:instagram:${asset.id}`,
                            );
                            return (
                              <li key={asset.id}>
                                {asset.name} ({asset.id})
                                {igRun ? (
                                  <span
                                    style={{
                                      marginLeft: '8px',
                                      color: colors.slate,
                                    }}
                                  >
                                    {formatSyncStatus(igRun.status)}
                                    {igRun.status === 'queued' ? null : (
                                      <>
                                        {' '}
                                        · {igRun.conversations} convos ·{' '}
                                        {igRun.messages} msgs
                                      </>
                                    )}
                                  </span>
                                ) : null}
                                <button
                                  {...stylex.props(layout.ghostButton)}
                                  style={{ marginLeft: '8px' }}
                                  onClick={() =>
                                    handleSyncInstagram(page.id, asset.id)
                                  }
                                >
                                  Sync Instagram
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p {...stylex.props(layout.note)}>
                          No IG assets found for this page.
                        </p>
                      )}
                    </div>
                  ) : null}
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
