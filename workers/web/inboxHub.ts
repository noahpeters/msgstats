export class InboxHub {
  private sockets: Set<WebSocket>;
  private latestByConversation: Map<string, string>;

  constructor(private state: DurableObjectState) {
    this.sockets = new Set(state.getWebSockets());
    this.latestByConversation = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/inbox/subscribe') {
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
        const messages = getLatestMessages(this.latestByConversation);
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

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const payload = (await request.json()) as {
        conversationId?: string;
        updatedAt?: string;
      };
      if (!payload.conversationId) {
        return new Response('Invalid payload', { status: 400 });
      }
      const message = JSON.stringify(payload);
      const prior = this.latestByConversation.get(payload.conversationId);
      if (prior === message) {
        return new Response(null, { status: 204 });
      }
      this.latestByConversation.set(payload.conversationId, message);
      for (const socket of [...this.sockets]) {
        try {
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

const getLatestMessages = (latest: Map<string, string>) => {
  const entries = [...latest.values()];
  const sortable = entries.map((json) => {
    try {
      const parsed = JSON.parse(json) as { updatedAt?: string };
      const timestamp = parsed.updatedAt ? Date.parse(parsed.updatedAt) : 0;
      return { json, timestamp: Number.isNaN(timestamp) ? 0 : timestamp };
    } catch {
      return { json, timestamp: 0 };
    }
  });
  sortable.sort((a, b) => b.timestamp - a.timestamp);
  return sortable.map((entry) => entry.json);
};
