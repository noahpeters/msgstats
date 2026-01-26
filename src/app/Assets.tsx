import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from './styles';

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

export default function Assets(): React.ReactElement {
  const [assets, setAssets] = React.useState<AssetsResponse | null>(null);
  const [syncingPageId, setSyncingPageId] = React.useState<string | null>(null);
  const [deletingPageId, setDeletingPageId] = React.useState<string | null>(
    null,
  );
  const [syncingIgId, setSyncingIgId] = React.useState<string | null>(null);
  const [igAssetsByPage, setIgAssetsByPage] = React.useState<
    Record<string, IgAsset[]>
  >({});
  const [error, setError] = React.useState<string | null>(null);

  const refreshAssets = React.useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as AssetsResponse;
    setAssets(data);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const response = await fetch('/api/assets');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as AssetsResponse;
      if (mounted) {
        setAssets(data);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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

  const handleSync = async (pageId: string) => {
    setSyncingPageId(pageId);
    setError(null);
    try {
      const response = await fetch(`/api/sync/pages/${pageId}/messenger`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Sync failed to start.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncingPageId(null);
    }
  };

  const handleDelete = async (pageId: string, pageName: string) => {
    const confirmed = window.confirm(
      `Delete ${pageName || pageId} and all related data? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setDeletingPageId(pageId);
    setError(null);
    try {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Delete failed.');
      }
      await refreshAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeletingPageId(null);
    }
  };

  const handleIgSync = async (pageId: string, igId: string) => {
    setSyncingIgId(igId);
    setError(null);
    try {
      const response = await fetch(
        `/api/sync/pages/${pageId}/instagram/${igId}`,
        {
          method: 'POST',
        },
      );
      if (!response.ok) {
        throw new Error('Instagram sync failed to start.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Instagram sync failed.');
    } finally {
      setSyncingIgId(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(layout.card)}>
        <h2>Enabled Pages</h2>
        <p {...stylex.props(layout.note)}>
          These pages have stored page tokens and are ready for Messenger sync.
        </p>
        {error ? <p style={{ color: colors.coral }}>{error}</p> : null}
        <ul>
          {assets?.pages.length
            ? assets.pages.map((page) => (
                <li key={page.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>{page.name || `Page ${page.id}`}</strong>{' '}
                      <span>({page.id})</span>
                      <div {...stylex.props(layout.note)}>
                        Last sync:{' '}
                        {page.lastSyncedAt
                          ? new Date(page.lastSyncedAt).toLocaleString()
                          : 'Never'}
                      </div>
                      <div {...stylex.props(layout.note)}>
                        Conversations: {page.conversationCount} · Messages:{' '}
                        {page.messageCount}
                      </div>
                    </div>
                    <button
                      {...stylex.props(layout.ghostButton)}
                      onClick={() => handleSync(page.id)}
                      disabled={syncingPageId === page.id}
                    >
                      {syncingPageId === page.id
                        ? 'Syncing…'
                        : 'Sync Messenger'}
                    </button>
                    <button
                      {...stylex.props(layout.ghostButton)}
                      onClick={() =>
                        handleDelete(page.id, page.name || `Page ${page.id}`)
                      }
                      disabled={deletingPageId === page.id}
                    >
                      {deletingPageId === page.id ? 'Deleting…' : 'Delete page'}
                    </button>
                  </div>
                </li>
              ))
            : 'No pages synced yet.'}
        </ul>
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Instagram messaging</h2>
        {assets?.igEnabled ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {assets.pages.map((page) => {
              const igAssets = igAssetsByPage[page.id] ?? [];
              return (
                <div key={page.id}>
                  <strong>{page.name || `Page ${page.id}`}</strong>
                  {igAssets.length ? (
                    <ul>
                      {igAssets.map((asset) => (
                        <li key={asset.id}>
                          <div
                            style={{
                              display: 'flex',
                              gap: '12px',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span>
                              {asset.name} ({asset.id})
                            </span>
                            <button
                              {...stylex.props(layout.ghostButton)}
                              onClick={() => handleIgSync(page.id, asset.id)}
                              disabled={syncingIgId === asset.id}
                            >
                              {syncingIgId === asset.id
                                ? 'Syncing…'
                                : 'Sync Instagram'}
                            </button>
                          </div>
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
            })}
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
