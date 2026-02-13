type ApiEnv = {
  API?: { fetch: typeof fetch };
  API_URL?: string;
};

function shouldProxy(pathname: string) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname === '/auth/facebook/deletion'
  );
}

function buildProxyRequest(request: Request, pathname: string) {
  const url = new URL(request.url);
  const upstream = new URL(pathname, 'http://internal');
  upstream.search = url.search;

  const headers = new Headers(request.headers);
  return new Request(upstream.toString(), {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : request.body,
    redirect: 'manual',
  });
}

export async function handleApiProxyRequest(request: Request, env: ApiEnv) {
  const url = new URL(request.url);
  if (!shouldProxy(url.pathname)) {
    return null;
  }
  if (!env.API) {
    return new Response(JSON.stringify({ error: 'api_binding_missing' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
  const upstreamRequest = buildProxyRequest(request, url.pathname);
  try {
    return await env.API.fetch(upstreamRequest);
  } catch {
    const fallbackBase = env.API_URL ?? 'http://localhost:8787';
    const fallbackUrl = new URL(url.pathname, fallbackBase);
    fallbackUrl.search = url.search;
    const fallbackRequest = new Request(fallbackUrl.toString(), {
      method: request.method,
      headers: new Headers(request.headers),
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : request.body,
      redirect: 'manual',
    });
    return await fetch(fallbackRequest);
  }
}
