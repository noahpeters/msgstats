import * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';
import { AppFooter } from '../app/components/AppFooter';
import { FromTreesIcon } from '../components/FromTreesIcon';
import { clearAuth, switchActiveOrganization } from '../lib/authClient';

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  orgId?: string;
  role?: string;
  name?: string | null;
  email?: string | null;
};

type OrgMembership = {
  orgId: string;
  orgName: string;
  role: string;
};

export type AppShellOutletContext = {
  setToolbarContent: React.Dispatch<React.SetStateAction<React.ReactNode>>;
};

const shellLayoutVars = {
  footerHeight: '84px',
  dividerColor: 'rgba(12, 27, 26, 0.14)',
};

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

const headerStyles = stylex.create({
  brandLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    color: 'inherit',
  },
  accountName: {
    fontSize: '13px',
    color: '#284b63',
    fontWeight: 600,
  },
  toolbarHint: {
    fontSize: '12px',
    color: '#284b63',
    whiteSpace: 'nowrap',
  },
});

const shellStyles = stylex.create({
  root: {
    display: 'grid',
    gridTemplateRows: `auto minmax(0, 1fr) ${shellLayoutVars.footerHeight}`,
    minHeight: '100vh',
    backgroundColor: '#ffffff',
    color: '#0c1b1a',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  header: {
    borderBottom: `1px solid ${shellLayoutVars.dividerColor}`,
    padding: '12px 16px',
    display: 'grid',
    gap: '10px',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    position: 'sticky',
    top: 0,
    zIndex: 20,
  },
  headerTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '12px',
    paddingBottom: '6px',
  },
  pageTabs: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    overflowX: 'auto',
    paddingBottom: '2px',
  },
  pageTab: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    padding: '7px 12px',
    borderRadius: '999px',
    border: `1px solid ${shellLayoutVars.dividerColor}`,
    color: '#0f766e',
    backgroundColor: '#ffffff',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    ':focus-visible': {
      outline: '2px solid #0f766e',
      outlineOffset: '2px',
    },
  },
  pageTabActive: {
    color: '#0c1b1a',
    backgroundColor: 'rgba(15, 118, 110, 0.14)',
    borderColor: '#0f766e',
  },
  controlsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  orgSelect: {
    border: `1px solid ${shellLayoutVars.dividerColor}`,
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#0c1b1a',
    fontSize: '12px',
    padding: '6px 8px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    maxWidth: '240px',
  },
  horizontalDivider: {
    height: '1px',
    width: '100%',
    backgroundColor: shellLayoutVars.dividerColor,
  },
  toolbarRow: {
    display: 'block',
    paddingTop: '6px',
    paddingBottom: '8px',
    minHeight: '60px',
  },
  main: {
    minHeight: 0,
    overflow: 'auto',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: shellLayoutVars.dividerColor,
    backgroundColor: '#ffffff',
    padding: '16px',
  },
  footer: {
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: shellLayoutVars.dividerColor,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: shellLayoutVars.dividerColor,
    backgroundColor: '#ffffff',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#284b63',
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

const sanitizeNext = (value: string | null): string => {
  if (!value || !value.startsWith('/')) {
    return '/';
  }
  if (value.startsWith('//')) {
    return '/';
  }
  return value;
};

export default function RootRoute(): React.ReactElement {
  const location = useLocation();
  const isEdgeToEdgeInbox = location.pathname === '/inbox';
  const showToolbar =
    location.pathname !== '/' && location.pathname !== '/ops-dashboard';
  const [flags, setFlags] = React.useState<{
    followupInbox?: boolean;
    opsDashboard?: boolean;
  } | null>(null);
  const [auth, setAuth] = React.useState<AuthResponse | null>(null);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [switchingOrg, setSwitchingOrg] = React.useState(false);
  const [orgMemberships, setOrgMemberships] = React.useState<OrgMembership[]>(
    [],
  );
  const [toolbarContent, setToolbarContent] =
    React.useState<React.ReactNode>(null);
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
  }, [auth?.authenticated, auth?.orgId]);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) {
          if (active) {
            setAuth({ authenticated: false });
          }
          return;
        }
        const data = (await response.json()) as AuthResponse;
        if (active) {
          setAuth(data ?? { authenticated: false });
        }
      } catch {
        if (active) {
          setAuth({ authenticated: false });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [location.key]);

  React.useEffect(() => {
    if (!auth?.authenticated) {
      setOrgMemberships([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/orgs', { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          orgs?: OrgMembership[];
          active_org_id?: string;
        };
        if (!active) {
          return;
        }
        setOrgMemberships(payload.orgs ?? []);
      } catch {
        if (!active) {
          return;
        }
        setOrgMemberships([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [auth?.authenticated, auth?.orgId]);

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

  React.useEffect(() => {
    const onRequired = () => {
      setAuth({ authenticated: false });
    };
    window.addEventListener(
      'msgstats-auth-required',
      onRequired as EventListener,
    );
    return () => {
      window.removeEventListener(
        'msgstats-auth-required',
        onRequired as EventListener,
      );
    };
  }, []);

  const handleLogout = React.useCallback(async () => {
    setLoggingOut(true);
    try {
      await clearAuth();
    } finally {
      setAuth({ authenticated: false });
      setLoggingOut(false);
    }
  }, []);

  const handleOrgSwitch = React.useCallback(
    async (nextOrgId: string) => {
      if (!auth?.orgId || nextOrgId === auth.orgId) {
        return;
      }
      setSwitchingOrg(true);
      try {
        await switchActiveOrganization(nextOrgId);
        const me = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!me.ok) {
          setAuth({ authenticated: false });
          return;
        }
        const data = (await me.json()) as AuthResponse;
        setAuth(data);
      } finally {
        setSwitchingOrg(false);
      }
    },
    [auth?.orgId],
  );

  if (!auth) {
    return (
      <div {...stylex.props(shellStyles.root)}>
        <main {...stylex.props(shellStyles.main)}>
          <section
            style={{
              border: `1px solid ${shellLayoutVars.dividerColor}`,
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <p {...stylex.props(layout.note)}>Checking session…</p>
          </section>
        </main>
        <footer {...stylex.props(shellStyles.footer)}>
          <AppFooter />
        </footer>
      </div>
    );
  }

  if (!auth.authenticated) {
    const requestedPath = `${location.pathname}${location.search}`;
    const next = sanitizeNext(requestedPath);
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (isEdgeToEdgeInbox) {
    return (
      <div {...stylex.props(layout.page)}>
        <Outlet />
      </div>
    );
  }

  const accountLabel = auth.name || auth.email || auth.userId || 'Account';

  return (
    <div {...stylex.props(shellStyles.root)}>
      <header {...stylex.props(shellStyles.header)}>
        {showBanner ? (
          <div {...stylex.props(bannerStyles.banner)}>
            Environment: {buildInfo.env} · ref {buildInfo.ref} · sha{' '}
            {buildInfo.sha} · ts {buildInfo.ts}
          </div>
        ) : null}

        <div {...stylex.props(shellStyles.headerTopRow)}>
          <Link to="/" {...stylex.props(headerStyles.brandLink)}>
            <FromTreesIcon size={32} />
          </Link>
          <nav {...stylex.props(shellStyles.pageTabs)} aria-label="Primary">
            <Link
              to="/"
              {...stylex.props(
                shellStyles.pageTab,
                location.pathname === '/' && shellStyles.pageTabActive,
              )}
            >
              Dashboard
            </Link>
            {flags?.followupInbox ? (
              <Link
                to="/inbox"
                {...stylex.props(
                  shellStyles.pageTab,
                  location.pathname.startsWith('/inbox') &&
                    shellStyles.pageTabActive,
                )}
              >
                Inbox
              </Link>
            ) : null}
            <Link
              to="/reports"
              {...stylex.props(
                shellStyles.pageTab,
                location.pathname.startsWith('/reports') &&
                  shellStyles.pageTabActive,
              )}
            >
              Reports
            </Link>
            {flags?.opsDashboard ? (
              <Link
                to="/ops-dashboard"
                {...stylex.props(
                  shellStyles.pageTab,
                  location.pathname === '/ops-dashboard' &&
                    shellStyles.pageTabActive,
                )}
              >
                Ops
              </Link>
            ) : null}
            {auth.role === 'owner' ? (
              <Link
                to="/org-settings"
                {...stylex.props(
                  shellStyles.pageTab,
                  location.pathname === '/org-settings' &&
                    shellStyles.pageTabActive,
                )}
              >
                Org
              </Link>
            ) : null}
            {flags?.opsDashboard ? (
              <Link
                to="/admin"
                {...stylex.props(
                  shellStyles.pageTab,
                  location.pathname === '/admin' && shellStyles.pageTabActive,
                )}
              >
                Admin
              </Link>
            ) : null}
          </nav>
          <div {...stylex.props(shellStyles.controlsGroup)}>
            <span {...stylex.props(headerStyles.accountName)}>
              {accountLabel}
            </span>
            {orgMemberships.length > 1 ? (
              <select
                {...stylex.props(shellStyles.orgSelect)}
                value={auth.orgId ?? ''}
                disabled={switchingOrg}
                onChange={(event) => {
                  void handleOrgSwitch(event.target.value);
                }}
              >
                {orgMemberships.map((org) => (
                  <option key={org.orgId} value={org.orgId}>
                    {org.orgName} ({org.role})
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              {...stylex.props(layout.ghostButton)}
              disabled={loggingOut}
              onClick={handleLogout}
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        </div>
        {showToolbar ? (
          <>
            <div {...stylex.props(shellStyles.horizontalDivider)} />
            <div {...stylex.props(shellStyles.toolbarRow)}>
              {toolbarContent ?? (
                <span {...stylex.props(headerStyles.toolbarHint)}>
                  Track conversation quality across Messenger and Instagram.
                </span>
              )}
            </div>
          </>
        ) : null}
      </header>

      <main {...stylex.props(shellStyles.main)}>
        <Outlet context={{ setToolbarContent }} />
      </main>
      <footer {...stylex.props(shellStyles.footer)}>
        <AppFooter />
      </footer>
    </div>
  );
}
