import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app';

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

async function start() {
  const { app } = createApp();

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res) => {
      try {
        const url = req.originalUrl;
        const template = fs.readFileSync(path.resolve('index.html'), 'utf-8');
        const transformed = await vite.transformIndexHtml(url, template);
        const { render } = await vite.ssrLoadModule('/src/entry-server.tsx');
        const result = await render(req);
        const html = transformed
          .replace('<!--app-html-->', result.body)
          .replace('<!--app-head-->', '');
        res.status(result.status).set(result.headers).send(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        res.status(500).send('SSR render failed');
      }
    });
  } else {
    app.use(
      express.static(path.resolve('dist/client'), {
        index: false,
      }),
    );
    app.use('*', async (req, res) => {
      const template = fs.readFileSync(
        path.resolve('dist/client/index.html'),
        'utf-8',
      );
      const { render } = await import(
        path.resolve('dist/server/entry-server.js')
      );
      const result = await render(req);
      const html = template
        .replace('<!--app-html-->', result.body)
        .replace('<!--app-head-->', '');
      res.status(result.status).set(result.headers).send(html);
    });
  }

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`msgstats running at ${url}`);
  });
}

void start();
