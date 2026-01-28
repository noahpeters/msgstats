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

  const refreshAuth = React.useCallback(async () => {
    const response = await fetch('/api/auth/me');
    if (!response.ok) {
      setAuth({ authenticated: false });
      return;
    }
    setAuth(await response.json());
  }, []);

  const refreshPermissions = React.useCallback(async () => {
    const response = await fetch('/api/meta/permissions');
    if (!response.ok) {
      return;
    }
    setPermissions(await response.json());
  }, []);

  const refreshAssets = React.useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) {
      return;
    }
    setAssets(await response.json());
  }, []);

  const refreshSyncRuns = React.useCallback(async () => {
    const response = await fetch('/api/sync/runs');
    if (!response.ok) {
      return;
    }
    setSyncRuns(await response.json());
  }, []);

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

  const loadBusinesses = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const response = await fetch('/api/meta/businesses');
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Failed to load businesses.');
      }
      const data = (await response.json()) as MetaBusiness[];
      setBusinesses(data);
      const pagesByBusiness: Record<string, MetaPage[]> = {};
      for (const business of data) {
        const pageResponse = await fetch(
          `/api/meta/businesses/${business.id}/pages`,
        );
        if (pageResponse.ok) {
          pagesByBusiness[business.id] =
            (await pageResponse.json()) as MetaPage[];
        }
      }
      setBusinessPages(pagesByBusiness);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to load businesses.',
      );
    } finally {
      setLoading(false);
    }
  };

  const loadClassicPages = async () => {
    try {
      const response = await fetch('/api/meta/accounts');
      if (!response.ok) {
        return;
      }
      setClassicPages(await response.json());
    } catch {
      setClassicPages([]);
    }
  };

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
      await refreshAssets();
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
      await refreshSyncRuns();
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
      await refreshSyncRuns();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Instagram sync failed.',
      );
    }
  };

  const loadIgAssets = React.useCallback(async (pageId: string) => {
    const response = await fetch(`/api/meta/pages/${pageId}/ig-assets`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { igAssets: IgAsset[] };
    setIgAssetsByPage((current) => ({
      ...current,
      [pageId]: data.igAssets,
    }));
  }, []);

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
  }, []);

  const enabledPages = new Map(
    assets?.pages.map((page) => [page.id, page]) ?? [],
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
          <p {...stylex.props(layout.note)}>Connected as {auth.userId}</p>
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
          Load businesses to discover pages. Enable a page to store its token
          securely.
        </p>
        <button
          {...stylex.props(layout.ghostButton)}
          onClick={loadBusinesses}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load businesses'}
        </button>
        {businesses.length === 0 ? (
          <p {...stylex.props(layout.note)}>
            No businesses loaded yet. Connect Meta and load businesses.
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

      <section {...stylex.props(layout.card)}>
        <h2>Classic Pages</h2>
        <p {...stylex.props(layout.note)}>
          Pages discovered via /me/accounts (fallback for non-business pages).
        </p>
        {classicPages.length ? (
          <ul>
            {classicPages.map((page) => (
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
        ) : (
          <p {...stylex.props(layout.note)}>No classic pages found.</p>
        )}
      </section>

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
