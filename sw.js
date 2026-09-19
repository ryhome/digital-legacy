// Cache-first, version-pinned, and it never takes over on its own.
// A new worker installs and then waits. The user approves it on the update screen, which is the
// only thing that sends skip-waiting. Note the honest limit: a waiting worker's install handler
// could in principle touch IndexedDB, so this buys availability, not integrity — the backup file
// is the defence for that.

const RELEASE = '877239b685564f697f25ce8f84af5fe30cbb19cb1d04419762ae0f1c032fe281';
const CACHE = `dm-${RELEASE}`;

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './vendor/noble.js',
  './js/main.js',
  './js/app.js',
  './js/codec.js',
  './js/db.js',
  './js/deriving.js',
  './js/dom.js',
  './js/early.js',
  './js/held.js',
  './js/i18n.js',
  './js/keys.js',
  './js/keyworker.js',
  './js/phrase-entry.js',
  './js/strings.js',
  './js/ui.js',
  './js/vault.js',
  './js/version.js',
  './js/views-diag.js',
  './js/views-gate.js',
  './js/views-genesis.js',
  './js/views-unlock.js',
  './js/views-vault.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // Each file is fetched under this release's query, a URL no CDN edge has seen before, with the
  // browser's own HTTP cache bypassed too. Lookups ignore the search, so plain paths still hit.
  e.waitUntil(caches.open(CACHE).then((c) =>
    c.addAll(ASSETS.map((a) => new Request(`${a}?r=${RELEASE}`, { cache: 'reload' })))));
  // No skipWaiting here on purpose: the code that holds someone's messages does not change
  // without them saying so.
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.t === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The app imports version.js?probe=<now> to ask the server what the newest release is. That
  // must not be answered from this worker's cache, which by definition knows only itself.
  if (url.searchParams.has('probe')) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch {
      // Offline and not in the cache: hand back the shell so the app still boots.
      return (await caches.match('./index.html')) || Response.error();
    }
  })());
});
