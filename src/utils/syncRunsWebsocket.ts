export const buildSyncRunsWsUrl = (
  hostname: string,
  protocol: string,
  host: string,
) => {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://localhost:8789';
  }
  const wsProtocol = protocol === 'https:' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}/sync/runs/subscribe`;
};

export const sendSyncRunsSubscribe = (
  socket: WebSocket,
  userId?: string | null,
) => {
  if (!userId) {
    return;
  }
  socket.send(JSON.stringify({ type: 'subscribe', userId }));
  socket.send(JSON.stringify({ type: 'request_latest' }));
};

export const buildSyncRunKey = (run: {
  pageId?: string | null;
  igBusinessId?: string | null;
  platform?: string | null;
}) => {
  const pageId = run.pageId ?? '';
  const platform = run.platform ?? '';
  const ig = run.igBusinessId ?? '∅';
  return `${pageId}::${ig}::${platform}`;
};
