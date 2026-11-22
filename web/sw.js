/* Service worker : garde l'appli disponible hors ligne.
   Les données (recettes, liste) sont gardées par l'appli elle-même (localStorage). */
var CACHE = 'recettes-v2.6.0';
var FILES = ['./', 'index.html', 'style.css', 'store.js', 'calc.js', 'demo-data.js', 'demo-server.js', 'demo.js', 'api.js', 'app.js',
  'screens-recettes.js', 'screens-semaine.js', 'screens-compte.js', 'screens-admin.js', 'guide.html', 'confidentialite.html', 'qr-appli.svg', 'qr-affiche.svg',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // le Sheet passe en direct
  // Réseau d'abord (pour avoir la dernière version), cache si pas de réseau.
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
