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
  const [error, setError] = React.useState<string | null>(null);

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
                  </div>
                </li>
              ))
            : 'No pages synced yet.'}
        </ul>
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Instagram messaging</h2>
        {assets?.igEnabled ? (
          <ul>
            {assets.igAssets.map((asset) => (
              <li key={asset.id}>
                <strong>{asset.name}</strong> tied to page {asset.pageId}
              </li>
            ))}
          </ul>
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
