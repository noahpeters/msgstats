// app/components/KofiFloatingChat.tsx
import * as React from 'react';

declare global {
  interface Window {
    kofiWidgetOverlay?: {
      draw: (username: string, options: Record<string, string>) => void;
    };
    __kofiOverlayLoaded?: boolean;
    __kofiOverlayDrawn?: boolean;
    __kofiOverlayObserver?: MutationObserver | null;
    __kofiOverlayStyleApplied?: boolean;
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

    const devLog = (...args: unknown[]) => {
      if (import.meta.env.DEV) {
        console.info('[kofi]', ...args);
      }
    };

    const ensureStyleTag = () => {
      if (window.__kofiOverlayStyleApplied) return;
      const existing = document.querySelector('#kofi-style-overrides');
      if (existing) {
        window.__kofiOverlayStyleApplied = true;
        return;
      }
      const style = document.createElement('style');
      style.id = 'kofi-style-overrides';
      style.textContent = `
#kofi-widget-overlay,
#kofi-widget-overlay * {
  background: transparent !important;
}
#kofi-widget-overlay iframe,
iframe[id*="kofi"],
iframe[class*="kofi"] {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  color-scheme: light !important;
}
#kofi-widget-overlay .floatingchat-container,
#kofi-widget-overlay .floatingchat,
#kofi-widget-overlay .floating-chat,
#kofi-widget-overlay .floatingchat-donate-button,
#kofi-widget-overlay .floatingchat-donate-button-container,
#kofi-widget-overlay .floatingchat-donate-button-inner,
#kofi-widget-overlay .floatingchat-container-wrap,
#kofi-widget-overlay .floatingchat-container * {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  filter: none !important;
}
`;
      document.head.appendChild(style);
      window.__kofiOverlayStyleApplied = true;
    };

    const shouldPatch = (el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const bgImage = style.backgroundImage;
      const boxShadow = style.boxShadow;
      const filter = style.filter;
      if (bgImage && bgImage !== 'none') return true;
      if (boxShadow && boxShadow !== 'none') return true;
      if (filter && filter !== 'none') return true;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
        return false;
      }
      return true;
    };

    const patchElement = (el: HTMLElement) => {
      if (!shouldPatch(el)) return;
      el.style.background = 'transparent';
      el.style.backgroundColor = 'transparent';
      el.style.backgroundImage = 'none';
      el.style.boxShadow = 'none';
      el.style.filter = 'none';
    };

    const findOverlayRoot = () => {
      const byId = document.getElementById('kofi-widget-overlay');
      if (byId) return byId;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('[id*="kofi"], [class*="kofi"]'),
      );
      return candidates[0] ?? null;
    };

    const patchOverlay = () => {
      ensureStyleTag();
      const root = findOverlayRoot() ?? document.body;
      const button = root.querySelector<HTMLElement>(
        'a[href*="ko-fi.com"], a[href*="kofi.com"], button, .floatingchat-donate-button',
      );
      if (button) {
        let current: HTMLElement | null = button;
        for (let i = 0; i < 4 && current; i += 1) {
          patchElement(current);
          current = current.parentElement;
        }
      }
      const wrappers = root.querySelectorAll<HTMLElement>(
        '.floatingchat-container, .floatingchat, .floating-chat, .floatingchat-donate-button-container, .floatingchat-container-wrap',
      );
      wrappers.forEach(patchElement);

      const iframes = root.querySelectorAll<HTMLIFrameElement>('iframe');
      for (const frame of iframes) {
        frame.style.setProperty('background', 'transparent', 'important');
        frame.style.setProperty('background-color', 'transparent', 'important');
        frame.style.boxShadow = 'none';
        frame.style.border = 'none';
        frame.style.setProperty('color-scheme', 'light', 'important');
        frame.setAttribute('allowtransparency', 'true');
        try {
          const doc = frame.contentDocument;
          if (!doc) continue;
          const html = doc.documentElement;
          const body = doc.body;
          const head = doc.head;
          if (html) {
            html.style.setProperty('background', 'transparent', 'important');
            html.style.setProperty(
              'background-color',
              'transparent',
              'important',
            );
            html.style.backgroundImage = 'none';
            html.style.setProperty('color-scheme', 'light', 'important');
          }
          if (body) {
            body.style.setProperty('background', 'transparent', 'important');
            body.style.setProperty(
              'background-color',
              'transparent',
              'important',
            );
            body.style.backgroundImage = 'none';
            body.style.boxShadow = 'none';
            body.style.setProperty('color-scheme', 'light', 'important');
          }
          if (head && !head.querySelector('#kofi-iframe-style-overrides')) {
            const style = doc.createElement('style');
            style.id = 'kofi-iframe-style-overrides';
            style.textContent = `
html, body {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  filter: none !important;
  color-scheme: light !important;
}
`;
            head.appendChild(style);
          }
          const innerWrappers = doc.querySelectorAll<HTMLElement>(
            '[id*="kofi"], [class*="kofi"], .floatingchat-container, .floatingchat',
          );
          innerWrappers.forEach((el) => {
            if (el.className.includes('donate')) return;
            patchElement(el);
          });
        } catch {
          // ignore cross-origin iframes
        }
      }
    };

    const ensureObserver = () => {
      if (window.__kofiOverlayObserver) return;
      const observer = new MutationObserver(() => {
        patchOverlay();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
      window.__kofiOverlayObserver = observer;
    };

    ensureStyleTag();
    patchOverlay();
    ensureObserver();

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
      patchOverlay();
      ensureObserver();
      devLog('overlay drawn');
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
