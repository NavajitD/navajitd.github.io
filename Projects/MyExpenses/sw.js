const CACHE_NAME = 'expense-tracker-v4';
const STATIC_ASSETS = [
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inconsolata:wght@300;400;500;600;700&display=swap'
];

// Listen for skip-waiting message from the app (update prompt)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Don't intercept GAS calls — let browser handle POST + 302 redirect natively
  if (url.hostname.includes('script.google.com')) {
    return;
  }

  // Network-first for API calls (Firebase, Gemini, Chart.js CDN)
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('generativelanguage.googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Network-only for HTML — never cache, always get fresh from server
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).catch(() => {
        return caches.match(e.request);
      })
    );
    return;
  }

  // Cache-first for other static assets (fonts, manifest)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
