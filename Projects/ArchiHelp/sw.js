// Vaastu Planner service worker: the whole app (engine included) works offline once loaded.
// Same-origin app files: stale-while-revalidate. Everything else (analytics, fonts) goes to the network.
const CACHE = 'vaastu-planner-v1';
const ENGINE = ['checker', 'config', 'drawing', 'edits', 'fontmetrics', 'furniture', 'generator', 'geom', 'index', 'io', 'openings', 'plan', 'sectors', 'sheet', 'stair', 'structure', 'windows', 'worker'];
const UI = ['app', 'catalogue', 'dom', 'drawings', 'editor', 'inspector', 'palette', 'store', 'thumbs', 'wizard'];
const ASSETS = ['./planner.html', './manifest.json', './examples/residence-rev9.json',
  ...ENGINE.map((f) => `./engine/${f}.js`), ...UI.map((f) => `./js/${f}.js`)];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('vaastu-planner-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.includes('/Projects/VaastuPlanner/')) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
