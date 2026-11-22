/* Service worker : l'appli s'ouvre tout de suite depuis le téléphone (cache), puis se met
   à jour en arrière-plan. Les données (recettes, liste) sont gardées par l'appli (localStorage). */
var CACHE = 'recettes-v2.7.0';
var FILES = ['./', 'index.html', 'style.css', 'store.js', 'calc.js', 'api.js', 'app.js',
  'screens-recettes.js', 'screens-semaine.js', 'screens-compte.js', 'screens-admin.js', 'guide.html', 'confidentialite.html',
  'qr-appli.svg', 'qr-affiche.svg', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

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
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // serveur Google et autres sites : en direct
  // Cache d'abord : ouverture instantanée, même avec un réseau lent. Les fichiers d'une version
  // viennent tous du même cache (jamais de mélange ancienne/nouvelle version). Une nouvelle version
  // publiée change CACHE : le téléphone la télécharge en entier, puis l'appli se recharge.
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(function () { return c.match('index.html'); });
    });
  }));
});
