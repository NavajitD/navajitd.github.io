const CACHE_NAME = 'expense-tracker-v7';

// App shell + critical SDKs precached for offline boot.
// stale-while-revalidate keeps these fresh in the background.
const STATIC_ASSETS = [
  './expenses.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inconsolata:wght@300;400;500;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
];

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Tolerant precache: one failure shouldn't block install.
    await Promise.all(STATIC_ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(err =>
        console.warn('[SW] precache miss', url, err && err.message)
      )
    ));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== 'share-incoming-v1').map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate: serve cached immediately, refresh in background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(resp => {
    if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
      cache.put(request, resp.clone()).catch(() => { });
    }
    return resp;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('Offline', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Share Target: intercept POST from OS share sheet ──
  if (e.request.method === 'POST' && url.pathname.endsWith('expenses.html')) {
    e.respondWith((async () => {
      const formData = await e.request.formData();
      const cache = await caches.open('share-incoming-v1');

      const image = formData.get('share_image');
      if (image && image.size > 0) {
        await cache.put('shared-image', new Response(image, { headers: { 'Content-Type': image.type } }));
        await cache.delete('shared-text');
      } else {
        const parts = [
          formData.get('share_title'),
          formData.get('share_text'),
          formData.get('share_url')
        ].filter(Boolean).join(' ').trim();
        if (parts) {
          await cache.put('shared-text', new Response(parts));
        }
        await cache.delete('shared-image');
      }

      return Response.redirect('./expenses.html?incoming-share=1', 303);
    })());
    return;
  }

  // Don't intercept GAS calls — let browser handle POST + 302 redirect natively
  if (url.hostname.includes('script.google.com')) {
    return;
  }

  // Firestore / Auth / Gemini API: never cache via SW.
  // Firestore SDK uses its own IndexedDB persistence for offline; intercepting
  // here can corrupt long-poll/gRPC-Web streams.
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('generativelanguage.googleapis.com')) {
    return; // let browser handle; SDK manages offline state itself
  }

  // HTML navigation: stale-while-revalidate so app boots offline.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(staleWhileRevalidate(new Request('./expenses.html', { cache: 'reload' })));
    return;
  }

  // Firebase SDK + Chart.js CDN + Google Fonts: stale-while-revalidate.
  if (url.hostname.includes('gstatic.com') ||
      url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // Other googleapis (storage, etc.): network-first with cache fallback.
  if (url.hostname.includes('googleapis.com')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Default: cache-first for any other same-origin static asset.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
