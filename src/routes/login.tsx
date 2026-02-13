import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { Navigate, useSearchParams } from 'react-router';
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { layout } from '../app/styles';
import { AppFooter } from '../app/components/AppFooter';
import {
  consumeAuthFragment,
  getAccessToken,
  setAuthTokens,
} from '../lib/authClient';

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  name?: string | null;
  email?: string | null;
  needsCredentialSetup?: boolean;
  bootstrap?: boolean;
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
    maxWidth: '560px',
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

const ERROR_MESSAGES: Record<string, string> = {
  use_your_login:
    'Use your msgstats login (password, passkey, Apple, or Google).',
  oauth_tx_expired: 'Sign-in timed out. Please try again.',
  oauth_token_failed: 'Sign-in could not be completed. Please try again.',
  oauth_missing_code: 'Sign-in response was incomplete. Please try again.',
  apple_email_required_for_first_login:
    'Apple did not provide email for first login. Use another sign-in method.',
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

  const [passwordForm, setPasswordForm] = React.useState({
    email: '',
    password: '',
  });
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = React.useState(false);

  const [setupPassword, setSetupPassword] = React.useState('');
  const [setupError, setSetupError] = React.useState<string | null>(null);
  const [setupLoading, setSetupLoading] = React.useState(false);

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
      })();
    }
  }, []);

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

  React.useEffect(() => {
    if (auth?.authenticated && !auth.needsCredentialSetup && !metaSetupToken) {
      setRedirectPath(next);
    }
  }, [auth, metaSetupToken, next]);

  const onPasswordLogin = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPasswordError(null);
      setPasswordLoading(true);
      try {
        const response = await fetch('/api/auth/password/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(passwordForm),
        });
        const payload = (await response.json().catch(() => null)) as {
          access_token?: string;
          session_handle?: string;
          error?: string;
        } | null;
        if (
          !response.ok ||
          !payload?.access_token ||
          !payload?.session_handle
        ) {
          setPasswordError(payload?.error ?? 'Login failed.');
          return;
        }
        await setAuthTokens({
          accessToken: payload.access_token,
          sessionHandle: payload.session_handle,
        });
        setRedirectPath(next);
      } catch {
        setPasswordError('Login failed.');
      } finally {
        setPasswordLoading(false);
      }
    },
    [next, passwordForm],
  );

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
        setMetaSetupToken(null);
        setAuth((prev) => ({
          ...(prev ?? { authenticated: true }),
          authenticated: true,
          needsCredentialSetup: true,
          bootstrap: true,
        }));
      } catch {
        setMetaError('Could not finish setup.');
      } finally {
        setSubmittingMeta(false);
      }
    },
    [metaForm.email, metaForm.name, metaForm.orgName, metaSetupToken],
  );

  const onSetPassword = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSetupError(null);
      setSetupLoading(true);
      try {
        const accessToken = getAccessToken();
        if (!accessToken) {
          setSetupError('You are not authenticated for credential setup.');
          return;
        }
        const response = await fetch('/api/auth/password/set', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ password: setupPassword }),
        });
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          access_token?: string;
          session_handle?: string;
          error?: string;
        } | null;
        if (
          !response.ok ||
          !payload?.access_token ||
          !payload?.session_handle
        ) {
          setSetupError(payload?.error ?? 'Could not set password.');
          return;
        }
        await setAuthTokens({
          accessToken: payload.access_token,
          sessionHandle: payload.session_handle,
        });
        setAuth((prev) => ({
          ...(prev ?? { authenticated: true }),
          authenticated: true,
          needsCredentialSetup: false,
          bootstrap: false,
        }));
        setRedirectPath(next);
      } catch {
        setSetupError('Could not set password.');
      } finally {
        setSetupLoading(false);
      }
    },
    [next, setupPassword],
  );

  const onPasskeyLogin = React.useCallback(async () => {
    setPasswordError(null);
    const response = await fetch('/api/auth/passkey/login/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setPasswordError(payload?.error ?? 'Passkey login unavailable.');
      return;
    }
    const payload = (await response.json()) as {
      challenge_token?: string;
      options?: unknown;
      error?: string;
    };
    if (!payload.challenge_token || !payload.options) {
      setPasswordError(payload.error ?? 'Passkey login unavailable.');
      return;
    }
    try {
      const assertion = await startAuthentication({
        optionsJSON: payload.options as Parameters<
          typeof startAuthentication
        >[0]['optionsJSON'],
      });
      const finishResponse = await fetch('/api/auth/passkey/login/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challenge_token: payload.challenge_token,
          response: assertion,
        }),
      });
      const finishPayload = (await finishResponse.json().catch(() => null)) as {
        access_token?: string;
        session_handle?: string;
        error?: string;
      } | null;
      if (
        !finishResponse.ok ||
        !finishPayload?.access_token ||
        !finishPayload?.session_handle
      ) {
        setPasswordError(finishPayload?.error ?? 'Passkey login failed.');
        return;
      }
      await setAuthTokens({
        accessToken: finishPayload.access_token,
        sessionHandle: finishPayload.session_handle,
      });
      setRedirectPath(next);
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : 'Passkey login failed.',
      );
    }
  }, [next]);

  const onCreatePasskey = React.useCallback(async () => {
    setSetupError(null);
    setSetupLoading(true);
    try {
      const accessToken = getAccessToken();
      if (!accessToken) {
        setSetupError('You are not authenticated for passkey setup.');
        return;
      }
      const startResponse = await fetch('/api/auth/passkey/register/start', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const startPayload = (await startResponse.json().catch(() => null)) as {
        challenge_token?: string;
        options?: unknown;
        error?: string;
      } | null;
      if (
        !startResponse.ok ||
        !startPayload?.challenge_token ||
        !startPayload?.options
      ) {
        setSetupError(
          startPayload?.error ?? 'Could not start passkey registration.',
        );
        return;
      }
      const credential = await startRegistration({
        optionsJSON: startPayload.options as Parameters<
          typeof startRegistration
        >[0]['optionsJSON'],
      });
      const finishResponse = await fetch('/api/auth/passkey/register/finish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          challenge_token: startPayload.challenge_token,
          response: credential,
        }),
      });
      const finishPayload = (await finishResponse.json().catch(() => null)) as {
        ok?: boolean;
        access_token?: string;
        session_handle?: string;
        error?: string;
      } | null;
      if (
        !finishResponse.ok ||
        !finishPayload?.access_token ||
        !finishPayload?.session_handle
      ) {
        setSetupError(
          finishPayload?.error ?? 'Could not complete passkey setup.',
        );
        return;
      }
      await setAuthTokens({
        accessToken: finishPayload.access_token,
        sessionHandle: finishPayload.session_handle,
      });
      setAuth((prev) => ({
        ...(prev ?? { authenticated: true }),
        authenticated: true,
        needsCredentialSetup: false,
        bootstrap: false,
      }));
      setRedirectPath(next);
    } catch (error) {
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Could not complete passkey setup.',
      );
    } finally {
      setSetupLoading(false);
    }
  }, [next]);

  const errorKey = searchParams.get('error');
  const inlineError = errorKey ? ERROR_MESSAGES[errorKey] ?? errorKey : null;

  if (redirectPath) {
    return <Navigate to={redirectPath} replace />;
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

          {inlineError ? (
            <p {...stylex.props(loginStyles.note)}>{inlineError}</p>
          ) : null}

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
          ) : auth?.authenticated && auth.needsCredentialSetup ? (
            <div {...stylex.props(loginStyles.actions)}>
              <p {...stylex.props(loginStyles.note)}>
                Create your login to finish setup. Meta bootstrap access is
                temporary.
              </p>
              <form
                onSubmit={onSetPassword}
                {...stylex.props(loginStyles.actions)}
              >
                <label {...stylex.props(loginStyles.field)}>
                  Set password
                  <input
                    type="password"
                    required
                    minLength={10}
                    value={setupPassword}
                    onChange={(event) => {
                      setSetupPassword(event.target.value);
                    }}
                    {...stylex.props(loginStyles.input)}
                  />
                </label>
                {setupError ? (
                  <p {...stylex.props(loginStyles.note)}>{setupError}</p>
                ) : null}
                <button
                  {...stylex.props(layout.button)}
                  disabled={setupLoading}
                >
                  {setupLoading ? 'Saving...' : 'Set password'}
                </button>
              </form>
              <button
                {...stylex.props(layout.button)}
                onClick={() => {
                  void onCreatePasskey();
                }}
                disabled={setupLoading}
              >
                {setupLoading ? 'Working...' : 'Create passkey'}
              </button>
              <a
                href={`/auth/oauth/start/google?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Link Google
                </button>
              </a>
              <a
                href={`/auth/oauth/start/apple?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Link Apple
                </button>
              </a>
            </div>
          ) : (
            <div {...stylex.props(loginStyles.actions)}>
              <form
                onSubmit={onPasswordLogin}
                {...stylex.props(loginStyles.actions)}
              >
                <label {...stylex.props(loginStyles.field)}>
                  Email
                  <input
                    type="email"
                    required
                    value={passwordForm.email}
                    onChange={(event) =>
                      setPasswordForm((previous) => ({
                        ...previous,
                        email: event.target.value,
                      }))
                    }
                    {...stylex.props(loginStyles.input)}
                  />
                </label>
                <label {...stylex.props(loginStyles.field)}>
                  Password
                  <input
                    type="password"
                    required
                    value={passwordForm.password}
                    onChange={(event) =>
                      setPasswordForm((previous) => ({
                        ...previous,
                        password: event.target.value,
                      }))
                    }
                    {...stylex.props(loginStyles.input)}
                  />
                </label>
                {passwordError ? (
                  <p {...stylex.props(loginStyles.note)}>{passwordError}</p>
                ) : null}
                <button
                  {...stylex.props(layout.button)}
                  disabled={passwordLoading}
                >
                  {passwordLoading ? 'Signing in...' : 'Sign in with password'}
                </button>
              </form>

              <button
                {...stylex.props(layout.ghostButton)}
                onClick={onPasskeyLogin}
              >
                Sign in with passkey
              </button>
              <a
                href={`/auth/oauth/start/google?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Continue with Google
                </button>
              </a>
              <a
                href={`/auth/oauth/start/apple?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Continue with Apple
                </button>
              </a>
              <a
                href={`/api/auth/login?return_to=${encodeURIComponent(next)}`}
                {...stylex.props(loginStyles.buttonLink)}
              >
                <button {...stylex.props(layout.ghostButton)}>
                  Connect Facebook to migrate
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
