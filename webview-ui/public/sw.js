// Minimal service worker for Pixel Office PWA installability.
// It intentionally does NOT cache app assets: the app is served by a local
// server and streams live data over WebSocket, so a network passthrough avoids
// stale-asset problems while still satisfying the PWA install criteria.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: let the browser handle the request normally (network passthrough).
  // Having a fetch handler registered is what enables the install prompt.
});
