let sessionHandle = null;
let accessToken = null;
let refreshPromise = null;

function broadcast(message) {
  self.clients
    .matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage(message);
      }
    });
}

async function refreshAccessToken() {
  if (!sessionHandle) {
    throw new Error('missing_session_handle');
  }
  const response = await fetch('/auth/refresh', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionHandle}`,
    },
  });
  if (!response.ok) {
    throw new Error('refresh_failed');
  }
  const data = await response.json();
  if (!data?.access_token) {
    throw new Error('refresh_missing_token');
  }
  accessToken = data.access_token;
  broadcast({ type: 'AUTH_UPDATED', access_token: accessToken });
  return accessToken;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data ?? {};
  if (data.type === 'AUTH_SET') {
    accessToken =
      typeof data.access_token === 'string' ? data.access_token : null;
    sessionHandle =
      typeof data.session_handle === 'string' ? data.session_handle : null;
    broadcast({
      type: 'AUTH_UPDATED',
      access_token: accessToken,
      session_handle: sessionHandle,
    });
    return;
  }
  if (data.type === 'AUTH_CLEAR') {
    accessToken = null;
    sessionHandle = null;
    refreshPromise = null;
    broadcast({ type: 'AUTH_REQUIRED' });
    return;
  }
  if (data.type === 'AUTH_GET') {
    event.source?.postMessage({
      type: 'AUTH_STATE',
      access_token: accessToken,
      session_handle: sessionHandle,
    });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/api/')
  ) {
    return;
  }
  event.respondWith(
    (async () => {
      const withAuth = async (token) => {
        const headers = new Headers(request.headers);
        if (token) {
          headers.set('authorization', `Bearer ${token}`);
        }
        const reqWithAuth = new Request(request, { headers });
        return await fetch(reqWithAuth);
      };

      let response = await withAuth(accessToken);
      if (response.status !== 401) {
        return response;
      }
      if (!sessionHandle) {
        return response;
      }
      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }
        const nextToken = await refreshPromise;
        response = await withAuth(nextToken);
        return response;
      } catch {
        accessToken = null;
        sessionHandle = null;
        refreshPromise = null;
        broadcast({ type: 'AUTH_REQUIRED' });
        return response;
      }
    })(),
  );
});
