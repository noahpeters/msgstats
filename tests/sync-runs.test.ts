import { describe, expect, it } from 'vitest';
import webWorker from '../workers/web/worker';
import { SyncRunsHub } from '../workers/web/syncRunsHub';

class FakeWebSocket {
  accepted = false;
  messages: string[] = [];
  listeners = new Map<string, Array<() => void>>();

  accept() {
    this.accepted = true;
  }

  send(message: string) {
    this.messages.push(message);
  }

  addEventListener(type: string, callback: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
}

const OriginalResponse = globalThis.Response;

class TestResponse {
  status: number;
  headers: Headers;
  private body: BodyInit | null;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers);
    this.body = body ?? null;
  }

  async json() {
    return JSON.parse(this.body ? String(this.body) : 'null');
  }

  async text() {
    return this.body ? String(this.body) : '';
  }
}

describe('sync runs websocket', () => {
  it('rejects non-websocket upgrades', async () => {
    const request = new Request('https://app.test/sync/runs/subscribe', {
      headers: { Upgrade: 'h2c' },
    });
    const env = {
      API: {
        fetch: async () =>
          new Response(JSON.stringify({ userId: 'user-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
      SYNC_RUNS_HUB: {
        idFromName(name: string) {
          return name;
        },
        get() {
          return {
            fetch: async () =>
              new Response('Expected WebSocket', { status: 426 }),
          };
        },
      },
    } as unknown as Parameters<typeof webWorker.fetch>[1];
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    };
    const response = await webWorker.fetch(
      request,
      env,
      ctx as unknown as Parameters<typeof webWorker.fetch>[2],
    );
    expect(response.status).toBe(426);
  });

  it('rejects unauthorized websocket connect', async () => {
    const request = new Request('https://app.test/sync/runs/subscribe', {
      headers: { Upgrade: 'websocket' },
    });
    const env = {
      API: {
        fetch: async () => new Response('unauthorized', { status: 401 }),
      },
      SYNC_RUNS_HUB: {
        get() {
          throw new Error('DO should not be called');
        },
      },
    } as unknown as Parameters<typeof webWorker.fetch>[1];
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    };
    const response = await webWorker.fetch(
      request,
      env,
      ctx as unknown as Parameters<typeof webWorker.fetch>[2],
    );
    expect(response.status).toBe(401);
  });

  it('broadcasts run updates to connected sockets', async () => {
    const originalResponse = globalThis.Response;
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown })
      .WebSocketPair;
    globalThis.Response = TestResponse as unknown as typeof Response;
    let lastPair: { client: FakeWebSocket; server: FakeWebSocket } | null =
      null;
    class TestWebSocketPair {
      0: FakeWebSocket;
      1: FakeWebSocket;
      constructor() {
        const client = new FakeWebSocket();
        const server = new FakeWebSocket();
        this[0] = client;
        this[1] = server;
        lastPair = { client, server };
      }
    }
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
      TestWebSocketPair;
    try {
      const hub = new SyncRunsHub({
        getWebSockets: () => [],
      } as unknown as DurableObjectState);
      const subscribeRequest = new Request('https://hub/sync/runs/subscribe', {
        headers: { Upgrade: 'websocket' },
      });
      const subscribeResponse = await hub.fetch(subscribeRequest);
      const pair = lastPair as {
        client: FakeWebSocket;
        server: FakeWebSocket;
      } | null;
      expect(subscribeResponse.status).toBe(101);
      expect(pair?.server.accepted).toBe(true);
      const notifyRequest = new Request('https://hub/notify', {
        method: 'POST',
        body: JSON.stringify({
          type: 'run_updated',
          run: {
            id: 'r1',
            status: 'completed',
            pageId: 'p1',
            igBusinessId: null,
            platform: 'ig',
          },
        }),
      });
      await hub.fetch(notifyRequest);
      expect(pair?.server.messages).toHaveLength(1);
      expect(JSON.parse(pair?.server.messages[0] ?? '')).toEqual({
        type: 'run_updated',
        run: {
          id: 'r1',
          status: 'completed',
          pageId: 'p1',
          igBusinessId: null,
          platform: 'ig',
        },
      });
    } finally {
      globalThis.Response = originalResponse;
      (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
        originalWebSocketPair;
    }
  });

  it('returns DO status when handoff fails', async () => {
    const request = new Request('https://app.test/sync/runs/subscribe', {
      headers: { Upgrade: 'websocket' },
    });
    const env = {
      API: {
        fetch: async () =>
          new Response(JSON.stringify({ userId: 'user-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
      SYNC_RUNS_HUB: {
        idFromName(name: string) {
          return name;
        },
        get() {
          return {
            fetch: async () => new Response('fail', { status: 500 }),
          };
        },
      },
    } as unknown as Parameters<typeof webWorker.fetch>[1];
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    };
    const response = await webWorker.fetch(
      request,
      env,
      ctx as unknown as Parameters<typeof webWorker.fetch>[2],
    );
    expect(response.status).toBe(500);
  });

  it('uses userId from whoami only', async () => {
    const originalResponse = globalThis.Response;
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      let requestedUserId = '';
      const env = {
        API: {
          fetch: async () =>
            new OriginalResponse(JSON.stringify({ userId: 'from_whoami' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        },
        SYNC_RUNS_HUB: {
          idFromName(name: string) {
            requestedUserId = name;
            return name;
          },
          get() {
            return {
              fetch: async () =>
                new TestResponse(null, {
                  status: 101,
                }) as unknown as Response,
            };
          },
        },
      } as unknown as Parameters<typeof webWorker.fetch>[1];

      const request = new Request(
        'https://app.test/sync/runs/subscribe?userId=evil',
        { headers: { Upgrade: 'websocket' } },
      );
      const ctx = {
        waitUntil() {},
        passThroughOnException() {},
      };
      const response = await webWorker.fetch(
        request,
        env,
        ctx as unknown as Parameters<typeof webWorker.fetch>[2],
      );
      expect(response.status).toBe(101);
      expect(requestedUserId).toBe('from_whoami');
    } finally {
      globalThis.Response = originalResponse;
    }
  });

  it('forwards the original request to the DO', async () => {
    const originalResponse = globalThis.Response;
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      let capturedRequest: Request | undefined;
      const env = {
        API: {
          fetch: async () =>
            new OriginalResponse(JSON.stringify({ userId: 'user-1' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        },
        SYNC_RUNS_HUB: {
          idFromName(name: string) {
            return name;
          },
          get() {
            return {
              fetch: async (req: Request) => {
                capturedRequest = req;
                return new TestResponse(null, {
                  status: 101,
                }) as unknown as Response;
              },
            };
          },
        },
      } as unknown as Parameters<typeof webWorker.fetch>[1];

      const request = new Request('https://app.test/sync/runs/subscribe', {
        headers: { Upgrade: 'websocket' },
      });
      const ctx = {
        waitUntil() {},
        passThroughOnException() {},
      };
      const response = await webWorker.fetch(
        request,
        env,
        ctx as unknown as Parameters<typeof webWorker.fetch>[2],
      );
      expect(response.status).toBe(101);
      expect(capturedRequest).toBe(request);
    } finally {
      globalThis.Response = originalResponse;
    }
  });

  it('dedupes identical run updates by key', async () => {
    const originalResponse = globalThis.Response;
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown })
      .WebSocketPair;
    let lastPair: { client: FakeWebSocket; server: FakeWebSocket } | null =
      null;
    class TestWebSocketPair {
      0: FakeWebSocket;
      1: FakeWebSocket;
      constructor() {
        const client = new FakeWebSocket();
        const server = new FakeWebSocket();
        this[0] = client;
        this[1] = server;
        lastPair = { client, server };
      }
    }
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
      TestWebSocketPair;
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      const hub = new SyncRunsHub({
        getWebSockets: () => [],
      } as unknown as DurableObjectState);
      await hub.fetch(
        new Request('https://hub/sync/runs/subscribe', {
          headers: { Upgrade: 'websocket' },
        }),
      );
      const run = {
        id: 'r1',
        status: 'completed',
        pageId: 'p1',
        igBusinessId: null,
        platform: 'ig',
      };
      const notify = async () =>
        hub.fetch(
          new Request('https://hub/notify', {
            method: 'POST',
            body: JSON.stringify({ type: 'run_updated', run }),
          }),
        );
      await notify();
      const response = await notify();
      const pair = lastPair as {
        client: FakeWebSocket;
        server: FakeWebSocket;
      } | null;
      expect(response.status).toBe(204);
      expect(pair?.server.messages).toHaveLength(1);
    } finally {
      globalThis.Response = originalResponse;
      (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
        originalWebSocketPair;
    }
  });

  it('broadcasts when same key changes run fields', async () => {
    const originalResponse = globalThis.Response;
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown })
      .WebSocketPair;
    let lastPair: { client: FakeWebSocket; server: FakeWebSocket } | null =
      null;
    class TestWebSocketPair {
      0: FakeWebSocket;
      1: FakeWebSocket;
      constructor() {
        const client = new FakeWebSocket();
        const server = new FakeWebSocket();
        this[0] = client;
        this[1] = server;
        lastPair = { client, server };
      }
    }
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
      TestWebSocketPair;
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      const hub = new SyncRunsHub({
        getWebSockets: () => [],
      } as unknown as DurableObjectState);
      await hub.fetch(
        new Request('https://hub/sync/runs/subscribe', {
          headers: { Upgrade: 'websocket' },
        }),
      );
      const baseRun = {
        id: 'r1',
        pageId: 'p1',
        igBusinessId: null,
        platform: 'ig',
      };
      await hub.fetch(
        new Request('https://hub/notify', {
          method: 'POST',
          body: JSON.stringify({
            type: 'run_updated',
            run: { ...baseRun, status: 'queued' },
          }),
        }),
      );
      await hub.fetch(
        new Request('https://hub/notify', {
          method: 'POST',
          body: JSON.stringify({
            type: 'run_updated',
            run: { ...baseRun, status: 'completed' },
          }),
        }),
      );
      const pair = lastPair as {
        client: FakeWebSocket;
        server: FakeWebSocket;
      } | null;
      expect(pair?.server.messages).toHaveLength(2);
    } finally {
      globalThis.Response = originalResponse;
      (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
        originalWebSocketPair;
    }
  });

  it('sends latest per key on connect', async () => {
    const originalResponse = globalThis.Response;
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown })
      .WebSocketPair;
    let lastPair: { client: FakeWebSocket; server: FakeWebSocket } | null =
      null;
    class TestWebSocketPair {
      0: FakeWebSocket;
      1: FakeWebSocket;
      constructor() {
        const client = new FakeWebSocket();
        const server = new FakeWebSocket();
        this[0] = client;
        this[1] = server;
        lastPair = { client, server };
      }
    }
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
      TestWebSocketPair;
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      const hub = new SyncRunsHub({
        getWebSockets: () => [],
      } as unknown as DurableObjectState);
      await hub.fetch(
        new Request('https://hub/notify', {
          method: 'POST',
          body: JSON.stringify({
            type: 'run_updated',
            run: {
              id: 'r1',
              status: 'completed',
              pageId: 'p1',
              igBusinessId: null,
              platform: 'ig',
              startedAt: '2024-01-02T00:00:00Z',
            },
          }),
        }),
      );
      await hub.fetch(
        new Request('https://hub/notify', {
          method: 'POST',
          body: JSON.stringify({
            type: 'run_updated',
            run: {
              id: 'r2',
              status: 'completed',
              pageId: 'p2',
              igBusinessId: 'ig-2',
              platform: 'ig',
              startedAt: '2024-01-01T00:00:00Z',
            },
          }),
        }),
      );
      await hub.fetch(
        new Request('https://hub/sync/runs/subscribe', {
          headers: { Upgrade: 'websocket' },
        }),
      );
      const pair = lastPair as {
        client: FakeWebSocket;
        server: FakeWebSocket;
      } | null;
      const messages = (pair?.server.messages ?? []).map((msg) =>
        JSON.parse(msg),
      );
      expect(messages).toHaveLength(2);
      const runIds = new Set(messages.map((msg) => msg.run?.id));
      expect(runIds).toEqual(new Set(['r1', 'r2']));
    } finally {
      globalThis.Response = originalResponse;
      (globalThis as { WebSocketPair?: unknown }).WebSocketPair =
        originalWebSocketPair;
    }
  });
});
