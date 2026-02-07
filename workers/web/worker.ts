import { createRequestHandler } from '@react-router/cloudflare';
import { handleApiProxyRequest } from './apiProxy';
import { SyncRunsHub } from './syncRunsHub';
import { InboxHub } from './inboxHub';
import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from '@cloudflare/workers-types';

type Env = {
  ASSETS: { fetch: typeof fetch };
  API?: { fetch: typeof fetch };
  SYNC_RUNS_HUB: DurableObjectNamespace;
  INBOX_HUB: DurableObjectNamespace;
  API_URL?: string;
};

let handlerPromise: Promise<ReturnType<typeof createRequestHandler>> | null =
  null;

async function loadBuild() {
  const virtualSpecifier = ['virtual:react-router/server-build'].join('');
  try {
    return await import(virtualSpecifier);
  } catch {
    // @ts-expect-error build output is generated at runtime
    return await import('../../build/server/index.js');
  }
}

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = loadBuild().then((build) =>
      createRequestHandler({
        build,
        getLoadContext({ request, context }) {
          const cf =
            (request as Request & { cf?: IncomingRequestCfProperties }).cf ??
            {};
          return {
            cloudflare: {
              ...context.cloudflare,
              cf,
            },
          };
        },
      }),
    );
  }
  return await handlerPromise;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    console.log('[web] incoming', {
      method: request.method,
      path: url.pathname,
      upgrade: request.headers.get('Upgrade'),
    });

    if (url.pathname === '/build-info.json') {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (!assetResponse.ok) return assetResponse;
        const headers = new Headers(assetResponse.headers);
        headers.set('cache-control', 'no-store');
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          headers,
        });
      } catch (error) {
        console.error(error);
        return new Response('Not Found', { status: 404 });
      }
    }

    if (url.pathname === '/sync/runs/subscribe') {
      // auth gate only
      const cookie = request.headers.get('cookie') ?? '';
      const whoami = env.API
        ? await env.API.fetch('http://internal/api/auth/whoami', {
            headers: { cookie },
          })
        : await fetch(
            `${env.API_URL ?? 'http://localhost:8787'}/api/auth/whoami`,
            {
              headers: { cookie },
            },
          );

      console.log('[subscribe] whoami', whoami.status);
      if (!whoami.ok) return new Response('Unauthorized', { status: 401 });

      const payload = (await whoami.json()) as { userId?: string };
      if (!payload.userId) return new Response('Unauthorized', { status: 401 });

      const stub = env.SYNC_RUNS_HUB.get(
        env.SYNC_RUNS_HUB.idFromName(payload.userId),
      );

      // Pass the *original* request through unchanged so the DO can do the actual upgrade.
      return stub.fetch(request);
    }

    if (url.pathname === '/inbox/subscribe') {
      const cookie = request.headers.get('cookie') ?? '';
      const whoami = env.API
        ? await env.API.fetch('http://internal/api/auth/whoami', {
            headers: { cookie },
          })
        : await fetch(
            `${env.API_URL ?? 'http://localhost:8787'}/api/auth/whoami`,
            {
              headers: { cookie },
            },
          );
      if (!whoami.ok) return new Response('Unauthorized', { status: 401 });
      const payload = (await whoami.json()) as { userId?: string };
      if (!payload.userId) return new Response('Unauthorized', { status: 401 });
      const flags = env.API
        ? await env.API.fetch('http://internal/api/feature-flags', {
            headers: { cookie },
          })
        : await fetch(
            `${env.API_URL ?? 'http://localhost:8787'}/api/feature-flags`,
            {
              headers: { cookie },
            },
          );
      if (flags.ok) {
        const data = (await flags.json()) as { followupInbox?: boolean };
        if (!data.followupInbox) {
          return new Response('Not Found', { status: 404 });
        }
      }
      const stub = env.INBOX_HUB.get(env.INBOX_HUB.idFromName(payload.userId));
      return stub.fetch(request);
    }

    try {
      const proxyResponse = await handleApiProxyRequest(request, env);
      if (proxyResponse) {
        return proxyResponse;
      }
      const handler = await getHandler();
      const handlerFn = handler as unknown as (context: {
        request: Request;
        env: Env;
        params: Record<string, string>;
        waitUntil: ExecutionContext['waitUntil'];
        passThroughOnException: ExecutionContext['passThroughOnException'];
        next: () => Promise<Response>;
      }) => Promise<Response>;
      return await handlerFn({
        request,
        env,
        params: {},
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException:
          'passThroughOnException' in ctx
            ? (ctx.passThroughOnException as () => void).bind(ctx)
            : () => {},
        next() {
          return Promise.resolve(new Response('Not Found', { status: 404 }));
        },
      });
    } catch (error) {
      console.error(error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

export { SyncRunsHub };
export { InboxHub };
