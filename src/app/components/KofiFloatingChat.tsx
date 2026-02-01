// app/components/KofiFloatingChat.tsx
import * as React from 'react';

declare global {
  interface Window {
    kofiWidgetOverlay?: {
      draw: (username: string, options: Record<string, string>) => void;
    };
    __kofiOverlayLoaded?: boolean;
    __kofiOverlayDrawn?: boolean;
  }
}

type Props = {
  username?: string; // default: "fromtrees"
};

export function KofiFloatingChat({ username = 'fromtrees' }: Props) {
  React.useEffect(() => {
    // SSR / non-browser guard
    if (typeof window === 'undefined' || typeof document === 'undefined')
      return;

    // Avoid duplicate draws (React StrictMode, route transitions, etc.)
    if (window.__kofiOverlayDrawn) return;

    const src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';

    const draw = () => {
      if (window.__kofiOverlayDrawn) return;
      if (!window.kofiWidgetOverlay?.draw) return;

      window.kofiWidgetOverlay.draw(username, {
        type: 'floating-chat',
        'floating-chat.donateButton.text': 'Support me',
        'floating-chat.donateButton.background-color': '#5cb85c',
        'floating-chat.donateButton.text-color': '#fff',
      });

      window.__kofiOverlayDrawn = true;
    };

    // If script already present/loaded, just draw.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      // If it’s already loaded, draw immediately; otherwise wait for load.
      if (window.__kofiOverlayLoaded) draw();
      else existing.addEventListener('load', draw, { once: true });
      return;
    }

    // Otherwise inject it.
    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    script.addEventListener(
      'load',
      () => {
        window.__kofiOverlayLoaded = true;
        draw();
      },
      { once: true },
    );

    script.addEventListener(
      'error',
      () => {
        // Leave a breadcrumb in case CSP/network blocks it.
        console.warn('Ko-fi overlay widget failed to load:', src);
      },
      { once: true },
    );

    document.body.appendChild(script);

    // No reliable “destroy” API from Ko-fi; we intentionally keep it for the session.
  }, [username]);

  return null;
}
