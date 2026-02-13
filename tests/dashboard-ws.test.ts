import { describe, expect, it } from 'vitest';
import {
  buildSyncRunsWsUrl,
  sendSyncRunsSubscribe,
} from '../src/utils/syncRunsWebsocket';

class FakeSocket {
  messages: string[] = [];
  send(message: string) {
    this.messages.push(message);
  }
}

describe('dashboard websocket helpers', () => {
  it('builds local dev websocket URL for localhost', () => {
    const url = buildSyncRunsWsUrl('localhost', 'http:', 'localhost:5173');
    expect(url).toBe('ws://localhost:8789');
  });

  it('builds production websocket URL for non-local hosts', () => {
    const url = buildSyncRunsWsUrl(
      'app.example.com',
      'https:',
      'app.example.com',
    );
    expect(url).toBe('wss://app.example.com/sync/runs/subscribe');
  });

  it('sends subscribe and request_latest on open', () => {
    const socket = new FakeSocket();
    sendSyncRunsSubscribe(socket as unknown as WebSocket, 'org-123');
    expect(socket.messages).toHaveLength(2);
    expect(JSON.parse(socket.messages[0] ?? '')).toEqual({
      type: 'subscribe',
      orgId: 'org-123',
    });
    expect(JSON.parse(socket.messages[1] ?? '')).toEqual({
      type: 'request_latest',
    });
  });
});
