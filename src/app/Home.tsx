import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from './styles';

type SyncStatus = {
  running: boolean;
  pageId?: string;
  platform?: string;
  conversationsProcessed: number;
  conversationsTotalEstimate?: number;
  messagesProcessed: number;
  startedAt?: string;
  lastUpdatedAt?: string;
  error?: string;
};

type PermissionResponse = {
  hasToken: boolean;
  permissions: { permission: string; status: string }[];
  missing: string[];
  error?: string;
};

type MetaBusiness = {
  id: string;
  name: string;
};

type MetaPage = {
  id: string;
  name: string;
  source: 'owned_pages' | 'client_pages';
};

type AssetsResponse = {
  pages: { id: string; name: string }[];
  igAssets: { id: string; name: string; pageId: string }[];
  igEnabled: boolean;
};

type IgAsset = {
  id: string;
  name: string;
  pageId: string;
};

function useSyncStatus(): [SyncStatus | null, () => Promise<void>] {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);

  const refresh = React.useCallback(async () => {
    const response = await fetch('/api/sync/status');
    if (!response.ok) {
      return;
    }
    setStatus(await response.json());
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  return [status, refresh];
}

export default function Home(): React.ReactElement {
  const [status, refresh] = useSyncStatus();
  const [permissions, setPermissions] =
    React.useState<PermissionResponse | null>(null);
  const [assets, setAssets] = React.useState<AssetsResponse | null>(null);
  const [businesses, setBusinesses] = React.useState<MetaBusiness[]>([]);
  const [pages, setPages] = React.useState<MetaPage[]>([]);
  const [selectedBusiness, setSelectedBusiness] = React.useState<string>('');
  const [loadingBusinesses, setLoadingBusinesses] = React.useState(false);
  const [loadingPages, setLoadingPages] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [syncingPageId, setSyncingPageId] = React.useState<string | null>(null);
  const [enablingPageId, setEnablingPageId] = React.useState<string | null>(
    null,
  );
  const [igAssetsByPage, setIgAssetsByPage] = React.useState<
    Record<string, IgAsset[]>
  >({});

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

  React.useEffect(() => {
    void refreshPermissions();
    void refreshAssets();
  }, [refreshAssets, refreshPermissions]);

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
    if (!assets?.igEnabled || !assets.pages.length) {
      return;
    }
    assets.pages.forEach((page) => {
      void loadIgAssets(page.id);
    });
  }, [assets, loadIgAssets]);

  const loadBusinesses = async () => {
    setLoadingBusinesses(true);
    setActionError(null);
    try {
      const response = await fetch('/api/meta/businesses');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error ?? 'Failed to load businesses.');
      }
      const data = (await response.json()) as MetaBusiness[];
      setBusinesses(data);
      if (data.length === 1) {
        setSelectedBusiness(data[0]?.id ?? '');
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to load businesses.',
      );
    } finally {
      setLoadingBusinesses(false);
    }
  };

  const loadPages = async (businessId: string) => {
    if (!businessId) {
      setPages([]);
      return;
    }
    setLoadingPages(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/meta/businesses/${businessId}/pages`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error ?? 'Failed to load pages.');
      }
      const data = (await response.json()) as MetaPage[];
      setPages(data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to load pages.',
      );
    } finally {
      setLoadingPages(false);
    }
  };

  const enablePage = async (pageId: string, name: string) => {
    setEnablingPageId(pageId);
    setActionError(null);
    try {
      if (name?.trim()) {
        await fetch(`/api/meta/pages/${pageId}/name`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });
      }
      const response = await fetch(
        `/api/meta/pages/${pageId}/token?name=${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error ?? 'Failed to enable page.');
      }
      await refreshAssets();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to enable page.',
      );
    } finally {
      setEnablingPageId(null);
    }
  };

  const startSync = async (pageId: string) => {
    setSyncingPageId(pageId);
    setActionError(null);
    try {
      const response = await fetch(`/api/sync/pages/${pageId}/messenger`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Sync failed to start.');
      }
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncingPageId(null);
    }
  };

  React.useEffect(() => {
    if (selectedBusiness) {
      void loadPages(selectedBusiness);
    }
  }, [selectedBusiness]);

  const enabledPageIds = new Set(assets?.pages.map((page) => page.id) ?? []);
  const pagesSource = pages[0]?.source ?? null;

  return (
    <div {...stylex.props(layout.grid)}>
      <section {...stylex.props(layout.card)}>
        <h2>Connect Meta</h2>
        <p {...stylex.props(layout.note)}>
          Securely connect your Meta account to sync messaging insights.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a href="/auth/meta/start">
            <button {...stylex.props(layout.button)}>Connect Meta</button>
          </a>
        </div>
        {permissions?.hasToken ? (
          <div style={{ marginTop: '12px' }}>
            <p {...stylex.props(layout.note)}>
              {permissions.missing.length
                ? 'Missing permissions detected.'
                : 'All required permissions granted.'}
            </p>
            {permissions.missing.length ? (
              <p style={{ color: colors.coral }}>
                Missing: {permissions.missing.join(', ')}
              </p>
            ) : null}
            {permissions.error ? (
              <p style={{ color: colors.coral }}>{permissions.error}</p>
            ) : null}
            {permissions.missing.length ? (
              <a href="/auth/meta/start">
                <button {...stylex.props(layout.ghostButton)}>
                  Reconnect Meta
                </button>
              </a>
            ) : null}
          </div>
        ) : (
          <p {...stylex.props(layout.note)}>
            No Meta token detected yet. Connect to continue.
          </p>
        )}
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Select business</h2>
        <p {...stylex.props(layout.note)}>
          We discover Pages via your Meta Business portfolio (owned pages first,
          then client pages).
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={loadBusinesses}
            disabled={loadingBusinesses}
          >
            {loadingBusinesses ? 'Loading…' : 'Load businesses'}
          </button>
          <select
            value={selectedBusiness}
            onChange={(event) => setSelectedBusiness(event.target.value)}
          >
            <option value="">Select a business</option>
            {businesses.map((biz) => (
              <option key={biz.id} value={biz.id}>
                {biz.name}
              </option>
            ))}
          </select>
        </div>
        {!loadingBusinesses && businesses.length === 0 ? (
          <p {...stylex.props(layout.note)}>
            No businesses found. Ensure your account is an admin of a Business
            portfolio.
          </p>
        ) : null}
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Select pages</h2>
        <p {...stylex.props(layout.note)}>
          Load pages for the selected business, then enable a page to store its
          token securely.
        </p>
        {pagesSource ? (
          <span {...stylex.props(layout.badge)}>
            Source: {pagesSource.replace('_', ' ')}
          </span>
        ) : null}
        {loadingPages ? (
          <p {...stylex.props(layout.note)}>Loading pages…</p>
        ) : pages.length ? (
          <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
            {pages.map((page) => {
              const enabled = enabledPageIds.has(page.id);
              return (
                <div
                  key={page.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{page.name}</strong>{' '}
                    <span style={{ color: colors.slate }}>({page.id})</span>
                    {enabled ? (
                      <span
                        {...stylex.props(layout.badge)}
                        style={{ marginLeft: '8px' }}
                      >
                        Enabled
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      {...stylex.props(layout.ghostButton)}
                      onClick={() => enablePage(page.id, page.name)}
                      disabled={enablingPageId === page.id}
                    >
                      {enablingPageId === page.id
                        ? 'Saving…'
                        : enabled
                          ? 'Refresh token'
                          : 'Enable page'}
                    </button>
                    <button
                      {...stylex.props(layout.button)}
                      onClick={() => startSync(page.id)}
                      disabled={!enabled || syncingPageId === page.id}
                    >
                      {syncingPageId === page.id
                        ? 'Syncing…'
                        : 'Sync Messenger'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p {...stylex.props(layout.note)}>
            {selectedBusiness
              ? 'No pages found for this business.'
              : 'Select a business to view pages.'}
          </p>
        )}
        {actionError ? (
          <p style={{ color: colors.coral }}>{actionError}</p>
        ) : null}
        {pages.length && pagesSource === 'client_pages' ? (
          <p {...stylex.props(layout.note)}>
            Pages were found via client pages because owned pages were empty.
          </p>
        ) : null}
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Sync status</h2>
        <p {...stylex.props(layout.note)}>
          {status?.running
            ? 'Sync in progress.'
            : status?.error
              ? 'Last sync failed.'
              : 'No sync running.'}
        </p>
        <div {...stylex.props(layout.note)}>
          <p>Page: {status?.pageId ?? '—'}</p>
          <p>Platform: {status?.platform ?? '—'}</p>
          <p>Conversations: {status?.conversationsProcessed ?? 0}</p>
          <p>Messages: {status?.messagesProcessed ?? 0}</p>
        </div>
        {status?.error ? (
          <p style={{ color: colors.coral }}>{status.error}</p>
        ) : null}
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Instagram assets</h2>
        {assets?.igEnabled ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {assets.pages.length ? (
              assets.pages.map((page) => {
                const igAssets = igAssetsByPage[page.id] ?? [];
                return (
                  <div key={page.id}>
                    <strong>{page.name || `Page ${page.id}`}</strong>
                    {igAssets.length ? (
                      <ul>
                        {igAssets.map((asset) => (
                          <li key={asset.id}>
                            <span>
                              {asset.name} ({asset.id})
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p {...stylex.props(layout.note)}>
                        No IG assets found for this page.
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <p {...stylex.props(layout.note)}>
                Enable a page to see connected Instagram assets.
              </p>
            )}
          </div>
        ) : (
          <p {...stylex.props(layout.note)}>
            Instagram messaging sync is behind a feature flag. TODO: enable once
            permissions and assets are ready.
          </p>
        )}
        {!assets?.igEnabled ? (
          <p style={{ color: colors.sea }}>Feature flag: IG_DISABLED</p>
        ) : null}
      </section>
    </div>
  );
}
