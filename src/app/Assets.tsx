import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from './styles';

type PageAsset = {
  id: string;
  name: string;
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

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(layout.card)}>
        <h2>Facebook Pages</h2>
        <ul>
          {assets?.pages.length
            ? assets.pages.map((page) => (
                <li key={page.id}>
                  <strong>{page.name}</strong> <span>({page.id})</span>
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
