/* Accès au serveur (Apps Script) avec nouvelles tentatives, et file d'attente
   des modifications faites hors connexion (envoyées dès que le réseau revient). */
(function (root) {
  'use strict';

  var store = root.Store;

  // Serveur par défaut : l'appli installée s'y relie toute seule. Ce n'est pas un secret :
  // sans identifiant ni mot de passe, le serveur ne renvoie aucune donnée.
  var DEFAULT_API = 'AKfycbyEtejqEfaRF6cFAtgQTG1OEi0Jcx1hXFg8i3QKleYewunYO9TErd0g_Nn_o6d-5v8oAQ';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ApiError(message, code, technical) {
    var e = new Error(message); e.code = code || 'ERREUR'; e.technical = technical || ''; return e;
  }
  function apiUrl() {
    var v = store.get('apiUrl', '') || DEFAULT_API;
    if (/^https?:\/\//.test(v)) return v;
    return 'https://script.google.com/macros/s/' + v + '/exec';
  }

  // Erreurs « logiques » renvoyées par le serveur : inutile de réessayer.
  var NO_RETRY = { MDP_FAUX: 1, CODE_FAUX: 1, BLOQUE: 1, NON_AUTORISE: 1, NON_CONNECTE: 1, DOUBLON: 1, VALEUR: 1, INTROUVABLE: 1,
    DECALE: 1, PLEIN: 1, PAS_DE_COMPTE: 1, INSCRIPTION_FERMEE: 1, DRIVE: 1, ACTION: 1, HORS_LIGNE: 1, ONGLET: 1 };
  var NETWORK = { RESEAU: 1, HORS_LIGNE: 1, HTTP: 1, OCCUPE: 1 };

  async function call(action, payload, opts) {
    opts = opts || {};
    if (store.get('demo', false)) {
      try { return await root.Demo.call(action, payload || {}); }
      catch (r) { throw ApiError(r.error || 'Erreur (démo).', r.code || 'SERVEUR', r.code); }
    }
    if (!navigator.onLine) throw ApiError('Pas de connexion internet.', 'HORS_LIGNE');
    var body = Object.assign({ action: action }, payload || {});
    var tries = opts.tries || 3, last;
    for (var i = 0; i < tries; i++) {
      try {
        var res = await fetch(apiUrl(), {
          method: 'POST', redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // évite la requête préalable CORS
          body: JSON.stringify(body)
        });
        if (!res.ok) throw ApiError('Le serveur Google a répondu ' + res.status + '.', 'HTTP', 'HTTP ' + res.status);
        var txt = await res.text(), data;
        try { data = JSON.parse(txt); }
        catch (e) { throw ApiError('Réponse inattendue du serveur Google (autorisation ou déploiement ?).', 'REPONSE', txt.slice(0, 200)); }
        if (!data.ok) throw ApiError(data.error || 'Erreur du serveur.', data.code || 'SERVEUR', data.code);
        return data;
      } catch (e) {
        last = e.code ? e : ApiError('Connexion au serveur impossible.', 'RESEAU', String(e && e.message || e));
        if (NO_RETRY[last.code] || i === tries - 1) break;
        await sleep(800 * Math.pow(2, i));
      }
    }
    throw last;
  }

  /* ---------- File d'attente (hors connexion) ----------
     Chaque modification a une clé : une nouvelle modification de même clé remplace l'ancienne
     (ex. le planning d'une semaine). */
  var Sync = {
    listeners: [],
    queue: function () { return store.get('queue', []); },
    push: function (key, action, payload) {
      var q = Sync.queue().filter(function (x) { return x.key !== key; });
      q.push({ key: key || ('u' + Date.now() + Math.random()), action: action, payload: payload, at: Date.now() });
      store.set('queue', q); Sync.notify(); Sync.flush();
    },
    pending: function (prefix) { return Sync.queue().filter(function (x) { return !prefix || x.key.indexOf(prefix) === 0; }); },
    busy: false,
    flush: async function () {
      if (Sync.busy) return;
      Sync.busy = true;
      try {
        while (true) {
          var q = Sync.queue();
          if (!q.length) break;
          var item = q[0], token = store.get('session', '');
          if (!token) break;
          try {
            await call(item.action, Object.assign({ token: token }, item.payload), { tries: 2 });
            store.set('queue', Sync.queue().filter(function (x) { return !(x.key === item.key && x.at === item.at); }));
          } catch (e) {
            if (NETWORK[e.code] || e.code === 'REPONSE') break; // on réessaiera plus tard
            store.set('queue', Sync.queue().filter(function (x) { return !(x.key === item.key && x.at === item.at); }));
            Sync.listeners.forEach(function (fn) { fn('error', e, item); });
            if (e.code === 'NON_CONNECTE') break;
          }
          Sync.notify();
        }
      } finally { Sync.busy = false; Sync.notify(); }
    },
    notify: function () { Sync.listeners.forEach(function (fn) { fn('change'); }); },
    on: function (fn) { Sync.listeners.push(fn); },
    clear: function () { store.del('queue'); Sync.notify(); }
  };
  root.addEventListener('online', function () { Sync.flush(); });
  setInterval(function () { if (Sync.queue().length && navigator.onLine) Sync.flush(); }, 30000);

  root.Api = { call: call, apiUrl: apiUrl, ApiError: ApiError, Sync: Sync, NETWORK: NETWORK };
})(window);
