import http from 'node:http';
import { WebSocketServer } from 'ws';

const defaultPort = Number(process.env.PORT ?? '8789');

const buildSyncRunKey = (run) => {
  const ig = run?.igBusinessId ?? 'null';
  return `${run?.pageId}::${ig}::${run?.platform}`;
};

export function createDevWsServer({ port = defaultPort } = {}) {
  const latestByOrgId = new Map();
  const clientsByOrgId = new Map();
  const socketOrgId = new WeakMap();

  const getLatestMessages = (orgId) => {
    const latest = latestByOrgId.get(orgId);
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

  const sendLatestForOrg = (ws, orgId) => {
    const messages = getLatestMessages(orgId);
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
          const orgId = payload?.orgId;
          const run = payload?.payload?.run;
          if (orgId && run) {
            const key = buildSyncRunKey(run);
            const message = JSON.stringify({ type: 'run_updated', run });
            const latestForOrg = latestByOrgId.get(orgId) ?? new Map();
            const previous = latestForOrg.get(key);
            if (previous !== message) {
              latestForOrg.set(key, message);
              latestByOrgId.set(orgId, latestForOrg);
              const clients = clientsByOrgId.get(orgId);
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
      const orgId = socketOrgId.get(ws);
      if (!orgId) {
        return;
      }
      const set = clientsByOrgId.get(orgId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clientsByOrgId.delete(orgId);
        }
      }
      socketOrgId.delete(ws);
    };

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message?.type === 'subscribe' && message.orgId) {
          const orgId = message.orgId;
          const previous = socketOrgId.get(ws);
          if (previous && previous !== orgId) {
            removeSocket();
          }
          socketOrgId.set(ws, orgId);
          const set = clientsByOrgId.get(orgId) ?? new Set();
          set.add(ws);
          clientsByOrgId.set(orgId, set);
          sendLatestForOrg(ws, orgId);
          return;
        }
        if (message?.type === 'request_latest') {
          const orgId = socketOrgId.get(ws);
          if (!orgId) {
            return;
          }
          sendLatestForOrg(ws, orgId);
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
    latestByOrgId,
    clientsByOrgId,
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
