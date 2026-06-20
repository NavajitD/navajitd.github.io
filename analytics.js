/* ──────────────────────────────────────────────────────────────────────────
   Lightweight, self-hosted analytics for navajitd.github.io
   ────────────────────────────────────────────────────────────────────────────
   Design goal: ZERO impact on visitor render latency.
     • No Firebase SDK — events are written straight to the Firestore REST API.
     • All work is deferred to after `load` and run inside requestIdleCallback.
     • Writes use `fetch(..., { keepalive:true })` so they never block the page and
       still complete during tab-close / navigation (the read-end + dwell events).
     • Geo is fetched once per session from a free, no-key IP API, off the render
       path; events sent before it resolves simply omit geo.

   Everything is filterable in the admin Metrics tab by os / device / browser /
   geography. The cost that "grows with traffic" is purely on the admin read side
   (computed only when you open the metrics tab) — visitors are never affected.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var PROJECT = 'recipes-7dc22';
  var API_KEY = 'AIzaSyCM8XiZ9tLn7jtVNcx0D6iZwYOGXBOLdjU';
  var EVENTS_URL =
    'https://firestore.googleapis.com/v1/projects/' + PROJECT +
    '/databases/(default)/documents/analytics_events?key=' + API_KEY;

  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  // ── Identity: persistent visitor id (≈ "individuals") + per-tab session id ──
  var vid, sid;
  try { vid = localStorage.getItem('nv_vid') || (localStorage.setItem('nv_vid', rid()), localStorage.getItem('nv_vid')); }
  catch (e) { vid = rid(); }
  try { sid = sessionStorage.getItem('nv_sid') || (sessionStorage.setItem('nv_sid', rid()), sessionStorage.getItem('nv_sid')); }
  catch (e) { sid = rid(); }

  // ── User-agent → os / device / browser (client-side, free) ──
  function parseUA() {
    var ua = navigator.userAgent || '';
    var os = 'Other', device = 'Desktop', browser = 'Other';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    if (/iPad|Tablet/i.test(ua)) device = 'Tablet';
    else if (/Mobi|Android|iPhone|iPod/i.test(ua)) device = 'Mobile';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    return { os: os, device: device, browser: browser };
  }
  var UA = parseUA();

  // ── Geo: cached once per session, fetched off the render path ──
  function cachedGeo() {
    try { var c = sessionStorage.getItem('nv_geo'); return c ? JSON.parse(c) : null; } catch (e) { return null; }
  }
  var geoPromise = null;
  function ensureGeo() {
    if (geoPromise) return geoPromise;
    var c = cachedGeo();
    if (c) { geoPromise = Promise.resolve(c); return geoPromise; }
    geoPromise = new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 2500);
      fetch('https://ipwho.is/?fields=success,country,country_code,city,region')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (done) return; done = true; clearTimeout(t);
          var geo = (d && d.success !== false && d.country)
            ? { country: d.country, cc: d.country_code, city: d.city, region: d.region } : null;
          if (geo) { try { sessionStorage.setItem('nv_geo', JSON.stringify(geo)); } catch (e) {} }
          resolve(geo);
        })
        .catch(function () { if (done) return; done = true; clearTimeout(t); resolve(null); });
    });
    return geoPromise;
  }

  // ── Firestore REST encoding ──
  function fsVal(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    return { stringValue: String(v) };
  }
  function build(type, extra, geo) {
    var ev = {
      type: type, vid: vid, sid: sid,
      page: PAGE, path: location.pathname,
      ts: new Date().toISOString(),
      os: UA.os, device: UA.device, browser: UA.browser
    };
    try { ev.ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (geo) { ev.country = geo.country; ev.cc = geo.cc; ev.city = geo.city; ev.region = geo.region; }
    if (extra) for (var k in extra) ev[k] = extra[k];
    var fields = {};
    for (var f in ev) if (ev[f] !== undefined && ev[f] !== null && ev[f] !== '') fields[f] = fsVal(ev[f]);
    return JSON.stringify({ fields: fields });
  }
  function post(body) {
    try { fetch(EVENTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, mode: 'cors' }); }
    catch (e) {}
  }
  // Non-urgent: wait for geo so the event is segmentable.
  function track(type, extra) { ensureGeo().then(function (geo) { post(build(type, extra, geo)); }); }
  // Urgent (tab close / hide): never await the network — use whatever geo is cached.
  function trackNow(type, extra) { post(build(type, extra, cachedGeo())); }

  window.nvTrack = track; // exposed so pages can fire custom events (resume, etc.)

  // ── Page type ──
  var p = location.pathname.toLowerCase();
  var PAGE =
    (p === '/' || p === '' || p.endsWith('/index.html')) ? 'home' :
    p.endsWith('/projects.html') ? 'projects' :
    p.endsWith('/blog.html') ? 'blog_list' :
    p.endsWith('/blog-post.html') ? 'blog_post' :
    p.endsWith('/recipes.html') ? 'recipes' : 'other';

  // ── Read-till-end + active-dwell tracking for a blog post ──
  function setupPostTracking(postId) {
    if (!postId) return;
    var readEnd = false;
    var marker = document.getElementById('articleEnd');
    if (marker && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !readEnd) {
          readEnd = true; io.disconnect();
          track('post_read_end', { postId: postId });
        }
      }, { threshold: 0 });
      io.observe(marker);
    }
    var accum = 0, activeStart = Date.now(), flushed = false;
    function pause() { if (activeStart) { accum += Date.now() - activeStart; activeStart = 0; } }
    function flush() {
      if (flushed) return; flushed = true; pause();
      trackNow('post_dwell', { postId: postId, ms: accum, readEnd: readEnd });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  function start() {
    ensureGeo(); // kick off geo lookup early, off the render path

    var extra = {};
    if (PAGE === 'blog_post') extra.postId = new URLSearchParams(location.search).get('id') || '';
    track('page_view', extra);

    // Project-page CTA clicks (captured via delegation — no markup changes needed)
    if (PAGE === 'projects') {
      document.addEventListener('click', function (e) {
        var a = e.target.closest('.project-links a, .project-title a');
        if (!a) return;
        var item = a.closest('.project-item');
        var titleEl = item && item.querySelector('.project-title a');
        track('cta_click', {
          project: (titleEl ? titleEl.textContent : '').trim(),
          label: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          href: a.getAttribute('href') || ''
        });
      }, true);
    }

    // "Clicked on Experience" — works on every page (home anchor or /#experience)
    document.addEventListener('click', function (e) {
      if (e.target.closest('a[href$="#experience"], a[href="#experience"]')) track('experience_click', {});
    }, true);

    // Blog post: read-end + dwell. blog-post.html calls window.__nvPostReady(id)
    // once the article is in the DOM; handle either ordering of script execution.
    if (PAGE === 'blog_post') {
      window.__nvPostReady = setupPostTracking;
      if (window.__nvPostReadyId) setupPostTracking(window.__nvPostReadyId);
    }
  }

  // Defer everything until the page is fully loaded + the browser is idle.
  function deferred() {
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 0);
  }
  if (document.readyState === 'complete') deferred();
  else window.addEventListener('load', deferred);
})();
