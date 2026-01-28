import { ServerRouter, type EntryContext } from 'react-router';
import type * as ReactDomServer from 'react-dom/server';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  const serverRuntime = (await import(
    'react-dom/server'
  )) as typeof ReactDomServer;

  let didError = false;
  const onError = (error: unknown) => {
    didError = true;
    console.error(error);
  };

  if (typeof serverRuntime.renderToReadableStream === 'function') {
    const stream = await serverRuntime.renderToReadableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      { onError },
    );
    responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(stream, {
      status: didError ? 500 : responseStatusCode,
      headers: responseHeaders,
    });
  }

  const { PassThrough, Readable } = await import('node:stream');
  const renderToPipeableStream = serverRuntime.renderToPipeableStream;
  if (typeof renderToPipeableStream !== 'function') {
    throw new Error('react-dom/server does not provide a streaming renderer.');
  }

  return await new Promise<Response>((resolve, reject) => {
    let passThrough: InstanceType<typeof PassThrough> | null = null;
    const stream = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        onAllReady() {
          passThrough = new PassThrough();
          stream.pipe(passThrough);
          const body = Readable.toWeb(passThrough) as ReadableStream;
          responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
          resolve(
            new Response(body, {
              status: didError ? 500 : responseStatusCode,
              headers: responseHeaders,
            }),
          );
        },
        onError,
      },
    );

    request.signal.addEventListener('abort', () => {
      stream.abort();
      passThrough?.destroy();
      reject(request.signal.reason);
    });
  });
}
