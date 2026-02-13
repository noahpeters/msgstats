import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { Navigate, useSearchParams } from 'react-router';
import { layout } from '../app/styles';
import { AppFooter } from '../app/components/AppFooter';
import { consumeAuthFragment, setAuthTokens } from '../lib/authClient';

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  name?: string | null;
  email?: string | null;
};

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
    maxWidth: '480px',
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
    display: 'grid',
    gap: '10px',
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
  note: {
    margin: 0,
    fontSize: '12px',
    color: '#4b6478',
  },
  field: {
    display: 'grid',
    gap: '6px',
  },
  input: {
    border: '1px solid rgba(12, 27, 26, 0.2)',
    borderRadius: '10px',
    padding: '10px 12px',
    fontSize: '14px',
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
  const [redirectPath, setRedirectPath] = React.useState<string | null>(null);
  const [metaSetupToken, setMetaSetupToken] = React.useState<string | null>(
    null,
  );
  const [metaError, setMetaError] = React.useState<string | null>(null);
  const [submittingMeta, setSubmittingMeta] = React.useState(false);
  const [metaForm, setMetaForm] = React.useState({
    email: '',
    name: '',
    orgName: '',
  });

  React.useEffect(() => {
    const fragment = consumeAuthFragment();
    if (!fragment) {
      return;
    }
    if ('metaSetupToken' in fragment) {
      setMetaSetupToken(fragment.metaSetupToken ?? null);
      return;
    }
    if (fragment.accessToken && fragment.sessionHandle) {
      void (async () => {
        await setAuthTokens({
          accessToken: fragment.accessToken,
          sessionHandle: fragment.sessionHandle,
        });
        setRedirectPath(fragment.returnTo || next);
      })();
    }
  }, [next]);

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
  }, [redirectPath]);

  const onCompleteMetaSetup = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!metaSetupToken) {
        return;
      }
      setSubmittingMeta(true);
      setMetaError(null);
      try {
        const response = await fetch('/api/auth/meta/setup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: metaSetupToken,
            email: metaForm.email,
            name: metaForm.name,
            org_name: metaForm.orgName,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          access_token?: string;
          session_handle?: string;
          return_to?: string;
          error?: string;
        } | null;
        if (
          !response.ok ||
          !payload?.access_token ||
          !payload?.session_handle
        ) {
          setMetaError(payload?.error ?? 'Could not finish setup.');
          return;
        }
        await setAuthTokens({
          accessToken: payload.access_token,
          sessionHandle: payload.session_handle,
        });
        setRedirectPath(payload.return_to ?? next);
      } catch {
        setMetaError('Could not finish setup.');
      } finally {
        setSubmittingMeta(false);
      }
    },
    [metaForm.email, metaForm.name, metaForm.orgName, metaSetupToken, next],
  );

  if (redirectPath) {
    return <Navigate to={redirectPath} replace />;
  }

  if (auth?.authenticated) {
    return <Navigate to={next} replace />;
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

          {metaSetupToken ? (
            <form
              {...stylex.props(loginStyles.actions)}
              onSubmit={onCompleteMetaSetup}
            >
              <p {...stylex.props(loginStyles.note)}>
                Finish account setup to connect your existing Meta data.
              </p>
              <label {...stylex.props(loginStyles.field)}>
                Email
                <input
                  type="email"
                  required
                  value={metaForm.email}
                  onChange={(event) =>
                    setMetaForm((previous) => ({
                      ...previous,
                      email: event.target.value,
                    }))
                  }
                  {...stylex.props(loginStyles.input)}
                />
              </label>
              <label {...stylex.props(loginStyles.field)}>
                Name
                <input
                  required
                  value={metaForm.name}
                  onChange={(event) =>
                    setMetaForm((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  {...stylex.props(loginStyles.input)}
                />
              </label>
              <label {...stylex.props(loginStyles.field)}>
                Organization name
                <input
                  required
                  value={metaForm.orgName}
                  onChange={(event) =>
                    setMetaForm((previous) => ({
                      ...previous,
                      orgName: event.target.value,
                    }))
                  }
                  {...stylex.props(loginStyles.input)}
                />
              </label>
              {metaError ? (
                <p {...stylex.props(loginStyles.note)}>{metaError}</p>
              ) : null}
              <button
                {...stylex.props(layout.button)}
                disabled={submittingMeta}
              >
                {submittingMeta ? 'Saving...' : 'Complete setup'}
              </button>
            </form>
          ) : (
            <div {...stylex.props(loginStyles.actions)}>
              <a
                href={`/auth/start?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.button)}>Sign in</button>
              </a>
              <a
                href={`/api/auth/login?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Connect Facebook
                </button>
              </a>
              <p {...stylex.props(loginStyles.note)}>
                This app keeps auth credentials only in memory. Closing all tabs
                signs you out.
              </p>
            </div>
          )}
        </section>
      </div>
      <footer {...stylex.props(loginStyles.footerShell)}>
        <AppFooter />
      </footer>
    </div>
  );
}
