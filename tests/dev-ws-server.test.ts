import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { WebSocket } from 'ws';
import { createDevWsServer } from 'dev/ws-server.mjs';

function waitForMessage(socket: WebSocket) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for message'));
    }, 2000);
    socket.once('message', (data: unknown) => {
      clearTimeout(timeout);
      resolve(String(data));
    });
  });
}

function waitForMessages(socket: WebSocket, count: number) {
  return new Promise<string[]>((resolve, reject) => {
    const messages: string[] = [];
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for messages'));
    }, 2000);
    const handler = (data: unknown) => {
      messages.push(String(data));
      if (messages.length >= count) {
        clearTimeout(timeout);
        socket.off('message', handler);
        resolve(messages);
      }
    };
    socket.on('message', handler);
  });
}

async function canListenOnLoopback() {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      probe.close(() => resolve(false));
    });
    probe.listen(0, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

describe('dev ws server', () => {
  it('sends latest payload immediately on subscribe', async () => {
    const canListen = await canListenOnLoopback();
    if (!canListen) {
      console.warn('Skipping dev ws server test: listen not permitted.');
      return;
    }
    const server = createDevWsServer({ port: 0 });
    const { port } = await server.listen();
    try {
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          payload: { type: 'run_updated', run: { id: 'r1' } },
        }),
      });

      const socket = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) =>
        socket.once('open', () => resolve()),
      );
      socket.send(JSON.stringify({ type: 'subscribe', userId: 'user-1' }));
      const message = await waitForMessage(socket);
      expect(JSON.parse(message)).toEqual({
        type: 'run_updated',
        run: { id: 'r1' },
      });
      socket.close();
    } finally {
      await server.close();
    }
  });

  it('responds to request_latest for subscribed sockets', async () => {
    const canListen = await canListenOnLoopback();
    if (!canListen) {
      console.warn('Skipping dev ws server test: listen not permitted.');
      return;
    }
    const server = createDevWsServer({ port: 0 });
    const { port } = await server.listen();
    try {
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-2',
          payload: { type: 'run_updated', run: { id: 'r2' } },
        }),
      });

      const socket = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) =>
        socket.once('open', () => resolve()),
      );
      socket.send(JSON.stringify({ type: 'subscribe', userId: 'user-2' }));
      await waitForMessage(socket);
      socket.send(JSON.stringify({ type: 'request_latest' }));
      const message = await waitForMessage(socket);
      expect(JSON.parse(message)).toEqual({
        type: 'run_updated',
        run: { id: 'r2' },
      });
      socket.close();
    } finally {
      await server.close();
    }
  });

  it('replays latest updates per composite key', async () => {
    const canListen = await canListenOnLoopback();
    if (!canListen) {
      console.warn('Skipping dev ws server test: listen not permitted.');
      return;
    }
    const server = createDevWsServer({ port: 0 });
    const { port } = await server.listen();
    try {
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-3',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r1',
              pageId: 'p1',
              platform: 'messenger',
              igBusinessId: null,
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      });
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-3',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r2',
              pageId: 'p1',
              platform: 'instagram',
              igBusinessId: null,
              startedAt: '2026-01-02T00:00:00.000Z',
            },
          },
        }),
      });

      const socket = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) =>
        socket.once('open', () => resolve()),
      );
      socket.send(JSON.stringify({ type: 'subscribe', userId: 'user-3' }));
      const messages = await waitForMessages(socket, 2);
      const parsed = messages.map((message) => JSON.parse(message));
      expect(parsed.map((item) => item.run.id)).toEqual(['r2', 'r1']);
      socket.close();
    } finally {
      await server.close();
    }
  });

  it('distinguishes igBusinessId null and non-null', async () => {
    const canListen = await canListenOnLoopback();
    if (!canListen) {
      console.warn('Skipping dev ws server test: listen not permitted.');
      return;
    }
    const server = createDevWsServer({ port: 0 });
    const { port } = await server.listen();
    try {
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-4',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r1',
              pageId: 'p2',
              platform: 'messenger',
              igBusinessId: null,
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      });
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-4',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r2',
              pageId: 'p2',
              platform: 'messenger',
              igBusinessId: 'ig-1',
              startedAt: '2026-01-02T00:00:00.000Z',
            },
          },
        }),
      });

      const socket = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) =>
        socket.once('open', () => resolve()),
      );
      socket.send(JSON.stringify({ type: 'subscribe', userId: 'user-4' }));
      const messages = await waitForMessages(socket, 2);
      const parsed = messages.map((message) => JSON.parse(message));
      expect(parsed.map((item) => item.run.id).sort()).toEqual(['r1', 'r2']);
      socket.close();
    } finally {
      await server.close();
    }
  });

  it('replays only the newest payload per composite key', async () => {
    const canListen = await canListenOnLoopback();
    if (!canListen) {
      console.warn('Skipping dev ws server test: listen not permitted.');
      return;
    }
    const server = createDevWsServer({ port: 0 });
    const { port } = await server.listen();
    try {
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-5',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r1',
              pageId: 'p3',
              platform: 'messenger',
              igBusinessId: null,
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      });
      await fetch(`http://localhost:${port}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-5',
          payload: {
            type: 'run_updated',
            run: {
              id: 'r2',
              pageId: 'p3',
              platform: 'messenger',
              igBusinessId: null,
              startedAt: '2026-01-03T00:00:00.000Z',
            },
          },
        }),
      });

      const socket = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) =>
        socket.once('open', () => resolve()),
      );
      socket.send(JSON.stringify({ type: 'subscribe', userId: 'user-5' }));
      const message = await waitForMessage(socket);
      const parsed = JSON.parse(message);
      expect(parsed.run.id).toBe('r2');
      socket.close();
    } finally {
      await server.close();
    }
  });
});
