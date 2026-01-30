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
    const env = {} as Parameters<typeof webWorker.fetch>[1];
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
    globalThis.Response = TestResponse as unknown as typeof Response;
    try {
      const hub = new SyncRunsHub({
        getWebSockets: () => [],
      } as unknown as DurableObjectState);
      const socket = new FakeWebSocket();
      const connectRequest = {
        url: 'https://hub/connect',
        method: 'POST',
        webSocket: socket as unknown as WebSocket,
      } as unknown as Request;
      const connectResponse = await hub.fetch(connectRequest);
      expect(connectResponse.status).toBe(101);
      const notifyRequest = new Request('https://hub/notify', {
        method: 'POST',
        body: JSON.stringify({
          type: 'run_updated',
          run: { id: 'r1', status: 'completed' },
        }),
      });
      await hub.fetch(notifyRequest);
      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0] ?? '')).toEqual({
        type: 'run_updated',
        run: { id: 'r1', status: 'completed' },
      });
    } finally {
      globalThis.Response = originalResponse;
    }
  });

  it('returns 404 when DO connect has no websocket', async () => {
    const hub = new SyncRunsHub({
      getWebSockets: () => [],
    } as unknown as DurableObjectState);
    const response = await hub.fetch(
      new Request('https://hub/connect', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
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
});
