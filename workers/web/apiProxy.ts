type ApiEnv = {
  API?: { fetch: typeof fetch };
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
  return await env.API.fetch(upstreamRequest);
}
