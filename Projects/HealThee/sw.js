const CACHE_NAME = 'healthee-v2';
const STATIC_ASSETS = [
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inconsolata:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/lucide@0.475.0/dist/umd/lucide.js'
];

// CDN assets that should be cached aggressively (rarely change)
const CDN_CACHE = 'healthee-cdn-v2';
const CDN_ORIGINS = ['unpkg.com', 'gstatic.com', 'fonts.gstatic.com'];

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept LLM proxy or Firebase cloud function calls
  if (url.hostname.includes('cloudfunctions.net') ||
      url.hostname.includes('run.app')) {
    return;
  }

  // Never intercept Firebase Auth / Firestore real-time connections
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('apis.google.com') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // Cache-first for versioned CDN assets (lucide, google fonts woff2)
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    e.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Network-only for HTML — always fresh
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for other static assets (manifest, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
      return res;
    }))
  );
});
