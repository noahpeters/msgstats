import 'virtual:stylex:runtime';

import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { registerAuthServiceWorker } from './lib/authClient';

startTransition(() => {
  void registerAuthServiceWorker();
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
