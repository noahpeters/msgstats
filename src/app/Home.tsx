import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from './styles';

type SyncStatus = {
  status: 'idle' | 'running' | 'completed' | 'error';
  lastRunId?: string;
  progress?: {
    pages: number;
    conversations: number;
    messages: number;
  };
  lastError?: string | null;
};

function useSyncStatus(): [SyncStatus | null, () => Promise<void>] {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);

  const refresh = React.useCallback(async () => {
    const response = await fetch('/api/sync/status');
    if (!response.ok) {
      return;
    }
    setStatus(await response.json());
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  return [status, refresh];
}

export default function Home(): React.ReactElement {
  const [status, refresh] = useSyncStatus();
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Sync failed to start.');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div {...stylex.props(layout.grid)}>
      <section {...stylex.props(layout.card)}>
        <h2>Connect Meta</h2>
        <p {...stylex.props(layout.note)}>
          Securely connect your Meta account to sync messaging insights.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a href="/auth/meta/start">
            <button {...stylex.props(layout.button)}>Connect Meta</button>
          </a>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Start Sync'}
          </button>
        </div>
        {error ? <p style={{ color: colors.coral }}>{error}</p> : null}
      </section>
      <section {...stylex.props(layout.card)}>
        <h2>Sync status</h2>
        <p {...stylex.props(layout.note)}>
          {status?.status === 'running'
            ? 'Sync in progress.'
            : status?.status === 'completed'
              ? 'Latest sync completed.'
              : status?.status === 'error'
                ? 'Last sync failed.'
                : 'No sync running.'}
        </p>
        <div {...stylex.props(layout.note)}>
          <p>Pages: {status?.progress?.pages ?? 0}</p>
          <p>Conversations: {status?.progress?.conversations ?? 0}</p>
          <p>Messages: {status?.progress?.messages ?? 0}</p>
        </div>
        {status?.lastError ? (
          <p style={{ color: colors.coral }}>{status.lastError}</p>
        ) : null}
      </section>
    </div>
  );
}
