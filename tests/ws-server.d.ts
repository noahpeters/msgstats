declare module 'dev/ws-server.mjs' {
  export function createDevWsServer(options?: { port?: number }): {
    listen(): Promise<{ port: number }>;
    close(): Promise<void>;
  };
}

declare module 'ws' {
  export class WebSocket {
    constructor(url: string);
    once(
      event: 'open' | 'message',
      listener: (...args: unknown[]) => void,
    ): void;
    on(event: 'message', listener: (...args: unknown[]) => void): void;
    off(event: 'message', listener: (...args: unknown[]) => void): void;
    send(data: string): void;
    close(): void;
  }

  export class WebSocketServer {
    constructor(options: { server: unknown });
    on(event: 'connection', listener: (socket: WebSocket) => void): void;
    close(): void;
  }
}
