export class SyncRunsHub {
  private sockets: Set<WebSocket>;
  private latestByKey: Map<string, string>;

  constructor(private state: DurableObjectState) {
    this.sockets = new Set(state.getWebSockets());
    this.latestByKey = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const webSocket = (request as unknown as { webSocket?: WebSocket })
      .webSocket;
    if (webSocket) {
      console.log('[sync-runs-hub] connect has ws', true);
      webSocket.accept();
      this.sockets.add(webSocket);
      const sendLatest = () => {
        const messages = getLatestMessages(this.latestByKey);
        for (const message of messages) {
          try {
            webSocket.send(message);
          } catch {
            this.sockets.delete(webSocket);
            break;
          }
        }
      };
      sendLatest();
      webSocket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string };
          if (payload.type === 'request_latest') {
            sendLatest();
          }
        } catch {
          // ignore malformed messages
        }
      });
      webSocket.addEventListener('close', () => {
        this.sockets.delete(webSocket);
      });
      webSocket.addEventListener('error', () => {
        this.sockets.delete(webSocket);
      });
      // Response must include webSocket for a successful 101 upgrade.
      return new Response(null, { status: 101, webSocket });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const payload = (await request.json()) as {
        type?: string;
        run?: Record<string, unknown>;
      };
      const body = JSON.stringify(payload);
      const run = payload.run as
        | { pageId?: string; igBusinessId?: string | null; platform?: string }
        | undefined;
      if (run) {
        const key = buildSyncRunKey(run);
        this.latestByKey.set(key, body);
      }
      for (const socket of [...this.sockets]) {
        try {
          socket.send(body);
        } catch {
          this.sockets.delete(socket);
        }
      }
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
}

const buildSyncRunKey = (run: {
  pageId?: string;
  igBusinessId?: string | null;
  platform?: string;
}) => {
  const ig = run.igBusinessId ?? '∅';
  return `${run.pageId ?? ''}::${ig}::${run.platform ?? ''}`;
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
