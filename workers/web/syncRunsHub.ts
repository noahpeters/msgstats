export class SyncRunsHub {
  private sockets: Set<WebSocket>;
  private latestByKey: Map<string, string>;

  constructor(private state: DurableObjectState) {
    this.sockets = new Set(state.getWebSockets());
    this.latestByKey = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    console.log('[sync-runs-hub] request', {
      hasWs: Boolean(
        (request as Request & { webSocket?: WebSocket }).webSocket,
      ),
      method: request.method,
      path: new URL(request.url).pathname,
    });
    const url = new URL(request.url);

    if (url.pathname === '/sync/runs/subscribe') {
      if (
        (request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket'
      ) {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      server.accept();
      this.sockets.add(server);

      const sendLatest = () => {
        const messages = getLatestMessages(this.latestByKey);
        for (const message of messages) {
          try {
            server.send(message);
          } catch {
            this.sockets.delete(server);
            break;
          }
        }
      };

      sendLatest();

      server.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string };
          if (payload.type === 'request_latest') sendLatest();
        } catch {
          // ignore
        }
      });

      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));

      console.log('[sync-runs-hub] connected', { sockets: this.sockets.size });

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const payload = (await request.json()) as {
        type?: string;
        run?: Record<string, unknown>;
      };
      const run = payload.run as
        | { pageId?: string; igBusinessId?: string | null; platform?: string }
        | undefined;
      const key = run ? buildSyncRunKey(run) : null;
      if (!key) {
        return new Response('Invalid run payload', { status: 400 });
      }

      const message = JSON.stringify({ type: 'run_updated', run });
      const prior = this.latestByKey.get(key);
      if (prior === message) {
        return new Response(null, { status: 204 });
      }

      this.latestByKey.set(key, message);
      for (const socket of [...this.sockets]) {
        try {
          const doName =
            (this.state as unknown as { id?: { name?: string } }).id?.name ??
            'unknown';

          console.log('[sync-runs-hub] /notify', {
            doName,
            sockets: this.sockets.size,
            keyCount: this.latestByKey.size,
          });
          socket.send(message);
        } catch {
          this.sockets.delete(socket);
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response('Not found', { status: 404 });
  }
}

const buildSyncRunKey = (run: {
  pageId?: string;
  igBusinessId?: string | null;
  platform?: string;
}) => {
  if (!run.pageId || !run.platform) return null;
  const ig = run.igBusinessId ?? 'null';
  return `${run.pageId}::${ig}::${run.platform}`;
};

const getLatestMessages = (latestByKey: Map<string, string>) => {
  const entries = [...latestByKey.values()];
  const sortable = entries.map((json) => {
    try {
      const parsed = JSON.parse(json) as { run?: { startedAt?: string } };
      const startedAt = parsed?.run?.startedAt;
      const parsedTime = startedAt ? Date.parse(startedAt) : 0;
      const timestamp = Number.isNaN(parsedTime) ? 0 : parsedTime;
      return { json, timestamp };
    } catch {
      return { json, timestamp: 0 };
    }
  });
  sortable.sort((a, b) => b.timestamp - a.timestamp);
  return sortable.map((entry) => entry.json);
};
