// Offline support for the Kernelcade Pocket web player at /play.
//
// What a service worker is: a small script the browser keeps installed next to the
// page. It sits between the page and the network, so it can answer requests from a
// local cache when there's no signal (airplane mode, subway, etc.).
//
// Strategy: "network first, cache as backup".
//   - Online: always ask the server first, so new versions of play.html, the
//     WebAssembly core and the hourly Kernel Drop ROM sync show up right away.
//     Every good answer is also copied into the cache.
//   - Offline (or the server is slow): answer from the cache instead.
// This means the player never gets "stuck" on an old build, which a cache-first
// worker would do.
//
// It lives at the site root (not in assets/play/) because a service worker can only
// control pages at or below its own folder, and the player's address is /play.
// It is registered with scope "/play", so it never touches the rest of the site.

// Bump this when the list below changes; old caches are deleted on activate.
const CACHE = 'kernelcade-play-v5';

// Everything the player needs to boot with no network.
const SHELL = [
  '/play',
  '/assets/play/pocket.js',
  '/assets/play/pocket.wasm',
  '/assets/play/kernel-drop.gb',
  '/assets/play/seed-room.gbc',
  '/assets/play/manifest.webmanifest',
  '/kernelcade-icon.png',
  '/favicon.png',
];

// How long to wait for the network before giving up and using the cache.
// Short enough that a weak signal doesn't feel frozen, long enough for normal 4G.
const NETWORK_TIMEOUT_MS = 4000;

// Safari refuses to show a page from a response that came from a redirect, so if
// the server ever redirects (e.g. /play.html -> /play), store a clean copy instead.
async function cleanResponse(resp) {
  if (!resp.redirected) return resp;
  const body = await resp.blob();
  return new Response(body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
}

// Install: download the whole player into the cache. `cache: 'reload'` skips the
// browser's own HTTP cache so we store fresh copies, not something 10 minutes old.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      const resp = await fetch(new Request(url, { cache: 'reload' }));
      if (!resp.ok) throw new Error('Could not cache ' + url + ' (' + resp.status + ')');
      await cache.put(url, await cleanResponse(resp));
    }));
    // Take over right away instead of waiting for every /play tab to close.
    await self.skipWaiting();
  })());
});

// Activate: delete caches from older versions of this worker.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('kernelcade-play-') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Which cache entry a request should use. Visits to /play, /play.html or
// /play?anything all share the single "/play" page entry.
function cacheKeyFor(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (request.mode === 'navigate') {
    return (url.pathname === '/play' || url.pathname === '/play.html') ? '/play' : null;
  }
  return SHELL.includes(url.pathname) ? url.pathname : null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const key = cacheKeyFor(request);
  if (!key) return; // not ours: let the browser handle it normally

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Start the network request now; keep updating the cache even if we end up
    // answering from the cache because the network was too slow.
    // `cache: 'no-cache'` = "ask the server if it changed" (GitHub Pages answers a
    // tiny 304 when it hasn't), instead of trusting the browser's 10-minute cache.
    const network = fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(async (resp) => {
      if (resp.ok) {
        const clean = await cleanResponse(resp);
        await cache.put(key, clean.clone());
        return clean;
      }
      return resp;
    });
    event.waitUntil(network.catch(() => {}));

    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
    try {
      const fast = await Promise.race([network, timeout]);
      if (fast && fast.ok) return fast;
    } catch {
      // Offline: fall through to the cache.
    }

    const cached = await cache.match(key);
    if (cached) return cached;

    // Nothing cached yet (first visit with a slow connection): wait for the network.
    return network;
  })());
});
