import * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

const activeLink = stylex.create({
  active: {
    color: '#0c1b1a',
    borderBottom: '2px solid #0f766e',
    paddingBottom: '4px',
  },
});

const footerStyles = stylex.create({
  footer: {
    marginTop: '32px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(12, 27, 26, 0.08)',
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '14px',
    color: '#284b63',
  },
  footerLink: {
    textDecoration: 'none',
    color: '#0f766e',
    fontWeight: 600,
  },
});

const bannerStyles = stylex.create({
  banner: {
    marginBottom: '16px',
    padding: '8px 12px',
    borderRadius: '12px',
    backgroundColor: '#fff4d6',
    color: '#7c3e00',
    border: '1px solid rgba(124, 62, 0, 0.2)',
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
    fontSize: '12px',
    letterSpacing: '0.2px',
  },
});

const parseBuildInfo = (raw: string) => {
  const parts = raw
    .split(' ')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [key, ...rest] = segment.split('=');
      return [key, rest.join('=')];
    });
  const map = Object.fromEntries(parts);
  if (!map.env) return null;
  return {
    env: map.env,
    ref: map.ref ?? 'unknown',
    sha: map.sha ?? 'unknown',
    ts: map.ts ?? 'unknown',
  };
};

export default function RootRoute(): React.ReactElement {
  const location = useLocation();
  const isEdgeToEdgeInbox = location.pathname === '/inbox';
  const [flags, setFlags] = React.useState<{
    followupInbox?: boolean;
    opsDashboard?: boolean;
  } | null>(null);
  const buildInfoRaw = import.meta.env.VITE_STAGING_INFO;
  const buildInfo = buildInfoRaw ? parseBuildInfo(buildInfoRaw) : null;
  const showBanner = buildInfo && buildInfo.env !== 'prod';

  React.useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/feature-flags');
        if (!response.ok) return;
        const data = (await response.json()) as {
          followupInbox?: boolean;
          opsDashboard?: boolean;
        };
        setFlags(data);
      } catch {
        setFlags(null);
      }
    })();
  }, []);

  React.useEffect(() => {
    const host = window.location.hostname;
    if (!(host === 'localhost' || host === '127.0.0.1')) return;
    let active = true;
    let lastStamp: string | null = null;
    const check = async () => {
      try {
        const res = await fetch(`/build-info.json?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { ts?: number; builtAt?: string };
        const next = data?.builtAt ?? (data?.ts ? String(data.ts) : null);
        if (!next) return;
        if (lastStamp && lastStamp !== next && active) {
          window.location.reload();
        }
        lastStamp = next;
      } catch {
        // ignore
      }
    };
    const interval = window.setInterval(check, 1000);
    void check();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (isEdgeToEdgeInbox) {
    return (
      <div {...stylex.props(layout.page)}>
        <Outlet />
      </div>
    );
  }

  return (
    <div {...stylex.props(layout.page)}>
      <div {...stylex.props(layout.shell)}>
        {showBanner ? (
          <div {...stylex.props(bannerStyles.banner)}>
            Environment: {buildInfo.env} · ref {buildInfo.ref} · sha{' '}
            {buildInfo.sha} · ts {buildInfo.ts}
          </div>
        ) : null}
        <div {...stylex.props(layout.badge)}>Messaging insights</div>
        <h1 {...stylex.props(layout.title)}>msgstats</h1>
        <p {...stylex.props(layout.subtitle)}>
          Track conversation quality across Messenger and Instagram.
        </p>
        <nav {...stylex.props(layout.nav)}>
          <Link
            to="/"
            {...stylex.props(
              layout.navLink,
              location.pathname === '/' && activeLink.active,
            )}
          >
            Dashboard
          </Link>
          {flags?.followupInbox ? (
            <>
              <Link
                to="/inbox"
                {...stylex.props(
                  layout.navLink,
                  location.pathname.startsWith('/inbox') && activeLink.active,
                )}
              >
                Inbox
              </Link>
            </>
          ) : null}
          <Link
            to="/reports"
            {...stylex.props(
              layout.navLink,
              location.pathname.startsWith('/reports') && activeLink.active,
            )}
          >
            Reports
          </Link>
          {flags?.opsDashboard ? (
            <Link
              to="/ops-dashboard"
              {...stylex.props(
                layout.navLink,
                location.pathname === '/ops-dashboard' && activeLink.active,
              )}
            >
              Ops
            </Link>
          ) : null}
        </nav>
        <Outlet />
        <footer {...stylex.props(footerStyles.footer)}>
          <Link to="/terms" {...stylex.props(footerStyles.footerLink)}>
            Terms of Service
          </Link>
          <Link to="/privacy" {...stylex.props(footerStyles.footerLink)}>
            Privacy Policy
          </Link>
        </footer>
      </div>
    </div>
  );
}
