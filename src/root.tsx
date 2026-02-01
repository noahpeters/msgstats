import * as React from 'react';
import stylex from './lib/stylex';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import './styles.css';
import { KofiFloatingChat } from './app/components/KofiFloatingChat';

const styles = stylex.create({
  body: {
    backgroundColor: '#f8f5f2',
    color: '#0c1b1a',
    fontFamily:
      '"IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    margin: 0,
  },
});

export default function Root(): React.ReactElement {
  return (
    <html lang="en">
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {import.meta.env.DEV && (
          <link
            rel="stylesheet"
            href="/virtual:stylex.css"
            suppressHydrationWarning
          />
        )}
        <Meta />
        <Links />
      </head>
      <body className={stylex(styles.body)}>
        <KofiFloatingChat />
        <Outlet />
        <ScrollRestoration
          getKey={(_location, matches) => matches[matches.length - 1]?.id ?? ''}
        />
        <Scripts />
      </body>
    </html>
  );
}
