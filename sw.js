// Only this application's shell and the pinned search dependency belong here.
// Public catalog data is versioned in IndexedDB. API requests are never cached.
var CACHE = 'nccog-library-phase3-v1';
var SEARCH = 'https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js';
var SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'library.js', 'studies.js', 'passages.js', 'install.js', 'search-worker.js', 'manifest.webmanifest', 'data/version.json', 'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL).then(function () {
      // A CDN outage must not prevent the local app shell from installing.
      return c.add(SEARCH).catch(function () {});
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('nccog-library-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  var base = new URL('./', self.location.href);
  var isShell = u.origin === base.origin && SHELL.some(function (path) { return new URL(path, base).pathname === u.pathname; });
  if (u.href !== SEARCH && !isShell) return;
  // The pinned search dependency is immutable and can be served directly from cache.
  if (u.href === SEARCH) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(e.request).then(function (saved) {
        if (saved) return saved;
        return fetch(e.request).then(function (r) {
          if (!r.ok) return r;
          return c.put(e.request, r.clone()).then(function () { return r; }, function () { return r; });
        });
      });
    }));
    return;
  }
  // Check the network on every shell request so published updates arrive on the next online load.
  e.respondWith(caches.open(CACHE).then(function (c) {
    return fetch(e.request, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) {
        return c.match(e.request, { ignoreSearch: true }).then(function (saved) { return saved || r; });
      }
      return c.put(e.request, r.clone()).then(function () { return r; }, function () { return r; });
    }).catch(function () {
      return c.match(e.request, { ignoreSearch: true }).then(function (saved) {
        if (saved) return saved;
        throw new Error('App shell unavailable offline');
      });
    });
  }));
});
