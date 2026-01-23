import * as React from 'react';
import { renderToString } from 'react-dom/server';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from 'react-router-dom/server';
import type { Request } from 'express';
import { routes } from './routes';

export async function render(request: Request) {
  const handler = createStaticHandler(routes);
  const context = await handler.query(
    new Request(`http://localhost${request.originalUrl}`),
  );

  if (context instanceof Response) {
    return {
      status: context.status,
      headers: Object.fromEntries(context.headers.entries()),
      body: await context.text(),
    };
  }

  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(
    <StaticRouterProvider router={router} context={context} />,
  );

  return {
    status: 200,
    headers: {},
    body: html,
  };
}
