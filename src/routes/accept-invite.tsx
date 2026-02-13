import * as React from 'react';
import { Navigate, useSearchParams } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

const styles = stylex.create({
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '460px',
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '14px',
    padding: '18px',
    backgroundColor: '#ffffff',
    display: 'grid',
    gap: '10px',
  },
});

export default function AcceptInviteRoute(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [redirectToLogin, setRedirectToLogin] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setError('Missing invite token.');
      return;
    }
    let active = true;
    void (async () => {
      const response = await fetch('/auth/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!active) {
        return;
      }
      if (response.status === 401) {
        setRedirectToLogin(true);
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? 'Could not accept invite.');
        return;
      }
      setDone(true);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (redirectToLogin) {
    const next = encodeURIComponent(`/accept-invite?token=${token ?? ''}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (done) {
    return <Navigate to="/" replace />;
  }

  return (
    <main {...stylex.props(styles.shell)}>
      <section {...stylex.props(styles.card)}>
        <h1 {...stylex.props(layout.title)}>Accept invite</h1>
        <p {...stylex.props(layout.note)}>
          {error ? error : 'Processing your invite...'}
        </p>
      </section>
    </main>
  );
}
