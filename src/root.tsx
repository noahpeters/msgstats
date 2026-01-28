import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type LinksFunction,
} from 'react-router';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: '/virtual:stylex.css' },
];

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
        <Meta />
        <Links />
      </head>
      <body {...stylex.props(styles.body)}>
        <Outlet />
        <ScrollRestoration
          getKey={(_location, matches) => matches[matches.length - 1]?.id ?? ''}
        />
        <Scripts />
      </body>
    </html>
  );
}
