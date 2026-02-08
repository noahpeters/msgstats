import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { Navigate, useSearchParams } from 'react-router';
import { layout } from '../app/styles';
import { AppFooter } from '../app/components/AppFooter';

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  name?: string | null;
  email?: string | null;
};

const LOGIN_NEXT_STORAGE_KEY = 'msgstats:auth:next';

const loginStyles = stylex.create({
  page: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateRows: 'minmax(0, 1fr) auto',
    padding: '20px',
    gap: '16px',
  },
  center: {
    width: '100%',
    display: 'grid',
    placeItems: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: '440px',
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    border: '1px solid rgba(12, 27, 26, 0.12)',
    boxShadow: '0 18px 44px rgba(12, 27, 26, 0.08)',
    padding: '28px',
    display: 'grid',
    gap: '14px',
  },
  appName: {
    margin: 0,
    fontSize: '34px',
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    fontSize: '15px',
    color: '#284b63',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  actions: {
    marginTop: '8px',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  buttonLink: {
    textDecoration: 'none',
  },
  footerShell: {
    borderTop: '1px solid rgba(12, 27, 26, 0.12)',
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
  },
});

const sanitizeNext = (value: string | null): string => {
  if (!value || !value.startsWith('/')) {
    return '/';
  }
  if (value.startsWith('//')) {
    return '/';
  }
  return value;
};

export default function LoginRoute(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const next = sanitizeNext(searchParams.get('next'));
  const [auth, setAuth] = React.useState<AuthResponse | null>(null);

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
  }, []);

  React.useEffect(() => {
    if (auth?.authenticated && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(LOGIN_NEXT_STORAGE_KEY);
    }
  }, [auth?.authenticated]);

  if (auth?.authenticated) {
    const storedNext =
      typeof window !== 'undefined'
        ? sanitizeNext(window.sessionStorage.getItem(LOGIN_NEXT_STORAGE_KEY))
        : '/';
    return <Navigate to={next !== '/' ? next : storedNext} replace />;
  }

  return (
    <div {...stylex.props(layout.page, loginStyles.page)}>
      <div {...stylex.props(loginStyles.center)}>
        <section {...stylex.props(loginStyles.panel)}>
          <div {...stylex.props(layout.badge)}>Messaging insights</div>
          <h1 {...stylex.props(loginStyles.appName)}>msgstats</h1>
          <p {...stylex.props(loginStyles.subtitle)}>
            Monitor sync health, conversation quality, and follow-up priorities
            in one place.
          </p>
          <div {...stylex.props(loginStyles.actions)}>
            <a
              href={`/api/auth/login?next=${encodeURIComponent(next)}`}
              {...stylex.props(loginStyles.buttonLink)}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, next);
                }
              }}
            >
              <button {...stylex.props(layout.button)}>Continue</button>
            </a>
          </div>
        </section>
      </div>
      <footer {...stylex.props(loginStyles.footerShell)}>
        <AppFooter />
      </footer>
    </div>
  );
}
