import { createRequestHandler } from '@react-router/cloudflare';
import { handleApiProxyRequest } from './apiProxy';
import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from '@cloudflare/workers-types';

type Env = {
  ASSETS: { fetch: typeof fetch };
  API?: { fetch: typeof fetch };
};

let handlerPromise: Promise<ReturnType<typeof createRequestHandler>> | null =
  null;

async function loadBuild() {
  const virtualSpecifier = ['virtual:react-router/server-build'].join('');
  try {
    return await import(virtualSpecifier);
  } catch (error) {
    console.warn(
      'Falling back to build/server/index.js for server build.',
      error,
    );
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
