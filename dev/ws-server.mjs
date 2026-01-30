import http from 'node:http';
import { WebSocketServer } from 'ws';

const defaultPort = Number(process.env.PORT ?? '8789');

const buildSyncRunKey = (run) => {
  const ig = run?.igBusinessId ?? 'null';
  return `${run?.pageId}::${ig}::${run?.platform}`;
};

export function createDevWsServer({ port = defaultPort } = {}) {
  const latestByUserId = new Map();
  const clientsByUserId = new Map();
  const socketUserId = new WeakMap();

  const getLatestMessages = (userId) => {
    const latest = latestByUserId.get(userId);
    if (!latest) {
      return [];
    }
    const entries = [...latest.values()];
    const sortable = entries.map((json) => {
      try {
        const parsed = JSON.parse(json);
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

  const sendLatestForUser = (ws, userId) => {
    const messages = getLatestMessages(userId);
    for (const message of messages) {
      ws.send(message);
    }
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/publish') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const userId = payload?.userId;
          const run = payload?.payload?.run;
          if (userId && run) {
            const key = buildSyncRunKey(run);
            const message = JSON.stringify({ type: 'run_updated', run });
            const latestForUser = latestByUserId.get(userId) ?? new Map();
            const previous = latestForUser.get(key);
            if (previous !== message) {
              latestForUser.set(key, message);
              latestByUserId.set(userId, latestForUser);
              const clients = clientsByUserId.get(userId);
              if (clients) {
                for (const socket of clients) {
                  socket.send(message);
                }
              }
            }
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const removeSocket = () => {
      const userId = socketUserId.get(ws);
      if (!userId) {
        return;
      }
      const set = clientsByUserId.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clientsByUserId.delete(userId);
        }
      }
      socketUserId.delete(ws);
    };

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message?.type === 'subscribe' && message.userId) {
          const userId = message.userId;
          const previous = socketUserId.get(ws);
          if (previous && previous !== userId) {
            removeSocket();
          }
          socketUserId.set(ws, userId);
          const set = clientsByUserId.get(userId) ?? new Set();
          set.add(ws);
          clientsByUserId.set(userId, set);
          sendLatestForUser(ws, userId);
          return;
        }
        if (message?.type === 'request_latest') {
          const userId = socketUserId.get(ws);
          if (!userId) {
            return;
          }
          sendLatestForUser(ws, userId);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      removeSocket();
    });

    ws.on('error', () => {
      removeSocket();
    });
  });

  return {
    server,
    wss,
    latestByUserId,
    clientsByUserId,
    async listen() {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      const address = server.address();
      const actualPort =
        typeof address === 'object' && address ? address.port : port;
      return { port: actualPort };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      wss.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = createDevWsServer();
  instance.listen().then(({ port }) => {
    console.log(`[dev-ws] listening on ws://localhost:${port}`);
  });
}
