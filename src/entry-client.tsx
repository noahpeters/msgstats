import * as React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { routes } from './routes';

const router = createBrowserRouter(routes);

hydrateRoot(
  document.getElementById('root') as HTMLElement,
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
