type AuthSetMessage = {
  type: 'AUTH_SET';
  access_token: string;
  session_handle: string;
};

type AuthState = {
  accessToken: string | null;
  sessionHandle: string | null;
};

const state: AuthState = {
  accessToken: null,
  sessionHandle: null,
};

let refreshPromise: Promise<string> | null = null;
let fetchWrapped = false;
let requestedSwState = false;

function parseHashParams(hash: string) {
  const content = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(content);
}

async function refreshAccessToken() {
  if (!state.sessionHandle) {
    throw new Error('missing_session_handle');
  }
  const response = await fetch('/auth/refresh', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.sessionHandle}`,
    },
  });
  if (!response.ok) {
    throw new Error('refresh_failed');
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('refresh_missing_access_token');
  }
  state.accessToken = payload.access_token;
  return payload.access_token;
}

function isApiRequest(input: RequestInfo | URL) {
  const url =
    typeof input === 'string'
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url);
  return (
    url.origin === window.location.origin && url.pathname.startsWith('/api/')
  );
}

function wrapFetchIfNeeded() {
  if (fetchWrapped || typeof window === 'undefined') {
    return;
  }
  fetchWrapped = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!isApiRequest(input)) {
      return nativeFetch(input, init);
    }
    const withAuth = (token: string | null) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return nativeFetch(input, { ...init, headers });
    };
    let response = await withAuth(state.accessToken);
    if (response.status !== 401 || !state.sessionHandle) {
      return response;
    }
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    try {
      const token = await refreshPromise;
      response = await withAuth(token);
      return response;
    } catch {
      state.accessToken = null;
      state.sessionHandle = null;
      window.dispatchEvent(new CustomEvent('msgstats-auth-required'));
      return response;
    }
  };
}

export async function registerAuthServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  wrapFetchIfNeeded();
  const registration = await navigator.serviceWorker.register('/auth-sw.js');
  await navigator.serviceWorker.ready;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
      | {
          type?: string;
          access_token?: string | null;
          session_handle?: string | null;
        }
      | undefined;
    if (!data) {
      return;
    }
    if (data.type === 'AUTH_UPDATED') {
      state.accessToken = data.access_token ?? state.accessToken;
      state.sessionHandle = data.session_handle ?? state.sessionHandle;
      return;
    }
    if (data.type === 'AUTH_STATE') {
      state.accessToken = data.access_token ?? null;
      state.sessionHandle = data.session_handle ?? null;
      return;
    }
    if (data.type === 'AUTH_REQUIRED') {
      state.accessToken = null;
      state.sessionHandle = null;
      window.dispatchEvent(new CustomEvent('msgstats-auth-required'));
    }
  });
  if (!requestedSwState) {
    requestedSwState = true;
    const requester =
      navigator.serviceWorker.controller ??
      registration.active ??
      registration.waiting;
    requester?.postMessage({ type: 'AUTH_GET' });
  }
  void registration.update();
}

export function getAccessToken() {
  return state.accessToken;
}

export function getSessionHandle() {
  return state.sessionHandle;
}

export async function setAuthTokens(input: {
  accessToken: string;
  sessionHandle: string;
}) {
  state.accessToken = input.accessToken;
  state.sessionHandle = input.sessionHandle;
  if (navigator.serviceWorker?.controller) {
    const message: AuthSetMessage = {
      type: 'AUTH_SET',
      access_token: input.accessToken,
      session_handle: input.sessionHandle,
    };
    navigator.serviceWorker.controller.postMessage(message);
  } else {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({
      type: 'AUTH_SET',
      access_token: input.accessToken,
      session_handle: input.sessionHandle,
    });
  }
}

export async function clearAuth() {
  const currentSessionHandle = state.sessionHandle;
  state.accessToken = null;
  state.sessionHandle = null;
  await fetch('/auth/logout', {
    method: 'POST',
    headers: currentSessionHandle
      ? { authorization: `Bearer ${currentSessionHandle}` }
      : undefined,
  }).catch(() => null);
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'AUTH_CLEAR' });
  }
}

export async function switchActiveOrganization(orgId: string) {
  if (!state.sessionHandle) {
    throw new Error('missing_session_handle');
  }
  const response = await fetch('/auth/org/switch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${state.sessionHandle}`,
    },
    body: JSON.stringify({ org_id: orgId }),
  });
  if (!response.ok) {
    throw new Error('org_switch_failed');
  }
  const payload = (await response.json()) as {
    access_token?: string;
    org_id?: string;
  };
  if (!payload.access_token || !payload.org_id) {
    throw new Error('org_switch_invalid_response');
  }
  await setAuthTokens({
    accessToken: payload.access_token,
    sessionHandle: state.sessionHandle,
  });
  return payload;
}

export function consumeAuthFragment() {
  if (typeof window === 'undefined' || !window.location.hash) {
    return null;
  }
  const params = parseHashParams(window.location.hash);
  const accessToken = params.get('access_token');
  const sessionHandle = params.get('session_handle');
  const returnTo = params.get('return_to') || '/';
  const metaSetupToken = params.get('meta_setup_token');
  if (metaSetupToken) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    return { metaSetupToken };
  }
  if (!accessToken || !sessionHandle) {
    return null;
  }
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  return {
    accessToken,
    sessionHandle,
    returnTo:
      returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/',
  };
}
