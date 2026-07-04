import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { isBrowserRuntime } from './runtime';

async function main() {
  // browserMock is for Vite dev mode only (UI prototyping without a server).
  // In standalone server mode, assets are loaded server-side and sent over WebSocket.
  if (isBrowserRuntime && import.meta.env.DEV) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Register the service worker so the standalone (localhost) app is installable
  // as a PWA ("Install app" / app window). Browser + production only — never in
  // the VS Code webview or the Vite dev server.
  if (isBrowserRuntime && !import.meta.env.DEV && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Resolve against the app's base path so it works under a subpath deploy too.
      // Vite guarantees BASE_URL ends with a slash.
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        /* PWA is a progressive enhancement — ignore registration failures */
      });
    });
  }
}

main().catch(console.error);
