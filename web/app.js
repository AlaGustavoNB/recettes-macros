/* Appli recettes & macros — cœur : état, connexion, synchronisation, navigation.
   Les écrans sont dans screens-*.js (ils s'enregistrent avec App.route). */
(function () {
  'use strict';
  var VERSION = '2.7.0';
  var C = window.Calc, Store = window.Store, Api = window.Api, Sync = Api.Sync;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    data: Store.get('data', null), idx: null,
    token: Store.get('session', ''), me: Store.get('me', null),
    lastAction: 'ouverture', lastError: null, timers: {}, wakeLock: null, loading: false, photos: {}
  };

  /* ================= Utilitaires ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 });
  }
  function euro(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function g(n) { return fmt(Math.round(n)) + ' g'; }
  function dateFr(iso) {
    if (!iso) return 'jamais';
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function dayFr(s) { var d = C.parseDay(s); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : (s || ''); }
  function enc(s) { return encodeURIComponent(s); }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  function field(label, input, hint) {
    return '<label class="field"><span>' + label + '</span>' + input + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }
  function numIn(id, val, extra) {
    return '<input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(val === null || val === undefined ? '' : String(val).replace('.', ',')) + '"' + (extra || '') + '>';
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3400);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallbackCopy(t); });
    }
    return Promise.resolve(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }
  function stars(n, max) {
    n = Math.round(n || 0); var s = '';
    for (var i = 1; i <= (max || 5); i++) s += i <= n ? '★' : '☆';
    return s;
  }

  /* ================= Session et rôles ================= */
  function isAdminAccount() { return !!(S.token && S.me && S.me.role === 'admin'); }
  function isAdmin() { return isAdminAccount() && Store.get('adminView', true) !== false; }
  function demo() { return !!Store.get('demo', false); }
  function setSession(token, me) {
    S.token = token || ''; S.me = me || null;
    if (S.token) { Store.set('session', S.token); Store.set('me', S.me); } else { Store.del('session'); Store.del('me'); }
  }
  // Déconnexion : la copie des données et les modifications non envoyées de ce téléphone sont effacées.
  function logout(msg) {
    setSession('', null); setData(null); Sync.clear();
    ['fw', 'list'].forEach(function (k) { Store.del(k); });
    if (msg) toast(msg);
    go('#/login');
  }

  /* ================= Données ================= */
  function setData(d) {
    S.data = d;
    S.idx = C.index(d ? d.ingredients : []);
    Store.set('data', d);
  }
  if (S.data) S.idx = C.index(S.data.ingredients);
  function saveData() { Store.set('data', S.data); }

  // Les modifications encore en attente d'envoi priment sur ce que renvoie le serveur.
  function reapplyPending(d) {
    Sync.pending().forEach(function (x) {
      if (x.action === 'savePlan') {
        d.plan = (d.plan || []).filter(function (r) { return r.week !== x.payload.week; })
          .concat(x.payload.rows.map(function (r) { return Object.assign({ week: x.payload.week, by: S.me && S.me.id }, r); }));
      } else if (x.action === 'saveChecks') {
        d.checks = d.checks || {}; d.checks[x.payload.week] = Object.assign({}, d.checks[x.payload.week], { checked: x.payload.checked });
      }
    });
    return d;
  }
  async function loadData() {
    var d = await Api.call('data', { token: S.token });
    delete d.ok;
    // Le serveur renouvelle la connexion de temps en temps : on garde le nouveau jeton.
    if (d.token || d.me) { setSession(d.token || S.token, d.me || S.me); delete d.me; delete d.token; }
    setData(reapplyPending(d));
  }
  // Demande au téléphone de ne pas effacer les données de l'appli (connexion, copie hors ligne).
  function keepStorage() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }
  async function refresh(silent) {
    if (S.loading || !S.token) { render(); return; }
    S.loading = true; status();
    try {
      S.lastAction = 'lecture du Sheet';
      await Sync.flush();
      await loadData();
      S.fw = {};
      if (!isFormScreen()) render(); else status();
      if (!silent) toast('Données à jour');
    } catch (err) {
      if (err.code === 'NON_CONNECTE') { logout('Connexion expirée : reconnecte-toi.'); return; }
      if (!Api.NETWORK[err.code] || !S.data) showError(err, function () { refresh(); });
    } finally { S.loading = false; status(); }
  }
  async function refreshStrict() { await loadData(); S.fw = {}; render(); }
  function isFormScreen() { return /^#\/(ingredient|nouvelle-recette|proposer|modifier-recette|profil|connexion|cuisine|login|inscription|oubli|compte|comptes|poids|foyer)/.test(location.hash); }

  Sync.on(function (ev, err, item) {
    if (ev === 'error') {
      if (err.code === 'NON_CONNECTE') { logout('Connexion expirée : reconnecte-toi.'); return; }
      if (item && item.action === 'ticket') { toast('Le ticket n’a pas pu être envoyé : ' + err.message); return; }
      showError(Object.assign(err, { message: 'Modification non enregistrée (' + (item && item.action) + ') : ' + err.message }));
    }
    // Mise à jour automatique : dès que toutes les modifications sont envoyées, on relit les données
    // (pour voir aussi celles du foyer et de l'admin).
    var n = Sync.queue().length;
    if (n) S.hadPending = true;
    else if (S.hadPending && !Sync.busy && S.token) {
      S.hadPending = false;
      clearTimeout(S.autoT); S.autoT = setTimeout(function () { refresh(true); }, 1200);
    }
    status();
  });
  // Relecture automatique quand on revient sur l'appli (plus d'une minute après la dernière lecture).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !S.token || !S.data) return;
    if (Date.now() - new Date(S.data.fetchedAt).getTime() > 60000) refresh(true);
  });

  /* ---------- Profil, cibles ---------- */
  function prof() { return S.data && S.data.profile; }
  function perMeal(p) {
    p = p || prof();
    var repas = (p && C.num(p.repas)) || 3;
    return {
      kcal: p && C.num(p.kcal) ? Math.round(C.num(p.kcal) / repas / 10) * 10 : null,
      prot: p && C.num(p.prot) ? C.num(p.prot) / repas : null,
      margin: ((p && C.num(p.marge)) || 10) / 100
    };
  }
  function recipeByName(n) { return ((S.data && S.data.recipes) || []).filter(function (r) { return r.name === n; })[0]; }
  function pk(k) { return k + '.' + (S.me ? S.me.id : ''); }
  function chosenKcal(r) {
    var m = Store.get(pk('kcal'), {});
    if (m[r.name]) return m[r.name];
    var pm = perMeal();
    if (pm.kcal) return pm.kcal;
    return Math.round(C.recipeTotals(r, S.idx).portion.kcal);
  }
  function setChosenKcal(r, k) {
    var m = Store.get(pk('kcal'), {}); m[r.name] = k; Store.set(pk('kcal'), m);
    var v = Store.get(pk('variant'), {});
    if (v[r.name] && v[r.name].kcal !== k) { delete v[r.name]; Store.set(pk('variant'), v); }
  }
  function variantOf(r, kcal) { var v = Store.get(pk('variant'), {})[r.name]; return v && v.kcal === kcal ? v : null; }
  function setVariant(r, kcal, label, items) {
    var v = Store.get(pk('variant'), {});
    if (items) v[r.name] = { kcal: kcal, label: label, items: items.map(function (it) { return { name: it.name, qty: it.qty, qty0: it.qty0 || 0 }; }) };
    else delete v[r.name];
    Store.set(pk('variant'), v);
  }
  function adjusted(r, kcal) {
    var pm = perMeal();
    var a = C.adjust(r, S.idx, { kcal: kcal, protRef: pm.prot, margin: pm.margin });
    var v = variantOf(r, kcal);
    if (v) {
      var items = v.items.map(function (it) {
        var ing = C.find(S.idx, it.name);
        return { name: it.name, ing: ing, role: ing ? C.roleOf(ing) : 'autre', qty0: it.qty0, qty: it.qty, fixed: true };
      });
      a = Object.assign({}, a, { items: items, totals: C.totals(items, S.idx), status: 'variant', messages: ['Version modifiée : ' + v.label + '.'] });
      a.protStatus = C.protStatus(a.totals.p, pm.prot, pm.margin);
    }
    return a;
  }
  function excluded(r) { return C.excludedBy(r, S.idx, prof()); }
  function avisOf(name) { return ((S.data && S.data.avis) || {})[name] || null; }
  function myAvis(name) { return ((S.data && S.data.myAvis) || {})[name] || {}; }

  /* ---------- Semaines et planning ---------- */
  function weekKey(offset) { var m = C.mondayOf(new Date()); m.setDate(m.getDate() + 7 * (offset || 0)); return C.isoDay(m); }
  function weekLabel(w) {
    var d = C.parseDay(w), e = new Date(d.getTime() + 6 * 864e5);
    var f = function (x) { return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };
    return (w === weekKey(0) ? 'Cette semaine' : (w === weekKey(1) ? 'Semaine prochaine' : 'Semaine')) + ' · ' + f(d) + ' → ' + f(e);
  }
  function curWeek() { var w = Store.get('week', weekKey(0)); return w < weekKey(0) ? weekKey(0) : w; }
  function myRows(week) {
    return ((S.data && S.data.plan) || []).filter(function (r) { return r.week === week; });
  }
  function setMyRows(week, rows) {
    S.data.plan = (S.data.plan || []).filter(function (r) { return r.week !== week; })
      .concat(rows.map(function (r) { return Object.assign({}, r, { week: week, by: S.me.id }); }));
    saveData();
    Sync.push('plan:' + week, 'savePlan', { week: week, rows: rows.map(function (r) {
      return { id: r.id, recipe: r.recipe, day: r.day || '', slot: r.slot || '', kcal: r.kcal, cooked: !!r.cooked, reste: !!r.reste, version: r.version || null };
    }) });
    if (S.fw) delete S.fw[week];
  }
  function newRow(recipeName, extra) {
    var r = recipeByName(recipeName), k = chosenKcal(r), v = variantOf(r, k);
    return Object.assign({ id: uid(), recipe: recipeName, day: '', slot: '', kcal: k, cooked: false, reste: false,
      version: v ? v.items.map(function (it) { return { name: it.name, qty: it.qty }; }) : null }, extra || {});
  }
  // Mes repas calculés ici (toujours à jour, même hors ligne).
  function myMeals(week) {
    var p = prof();
    return myRows(week).map(function (row) {
      var rec = recipeByName(row.recipe);
      if (!rec) return null;
      var m = C.mealItems(row, rec, S.idx, p);
      return { id: row.id, by: S.me.id, byName: S.me.name, recipe: row.recipe, day: row.day, slot: row.slot,
        cooked: row.cooked, reste: row.reste, items: m.items, status: m.status, mine: true };
    }).filter(Boolean);
  }
  // Repas du foyer : ceux des autres membres viennent du serveur (dernière copie), les miens d'ici.
  function foyerMeals(week) {
    var fw = (S.fw && S.fw[week]) || Store.get('fw.' + week, null);
    var others = fw ? fw.meals.filter(function (m) { return !S.me || m.by !== S.me.id; }) : [];
    return { meals: myMeals(week).concat(others), fetchedAt: fw && fw.fetchedAt, members: fw ? fw.members : [], warnings: fw ? fw.warnings : [] };
  }
  async function fetchFoyerWeek(week) {
    S.fw = S.fw || {};
    var r = await Api.call('foyerWeek', { token: S.token, week: week });
    r.fetchedAt = new Date().toISOString();
    S.fw[week] = r; Store.set('fw.' + week, r);
    return r;
  }
  function stockMap() {
    var m = {};
    ((S.data && S.data.stock) || []).forEach(function (s) { m[s.ing] = (m[s.ing] || 0) + (C.num(s.qty) || 0); });
    return m;
  }
  function addLocalStock(ing, delta) {
    var st = S.data.stock = S.data.stock || [];
    var row = st.filter(function (s) { return s.ing === ing; })[0];
    if (row) row.qty = Math.max(0, (C.num(row.qty) || 0) + delta);
    else if (delta > 0) st.push({ ing: ing, qty: delta, date: C.isoDay(new Date()) });
    saveData();
  }

  /* ================= Photos ================= */
  // Réduit une photo (largeur max, poids max en base64).
  function shrink(file, max, quality, maxChars) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, (max || 1600) / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var q = quality || 0.85, b64 = c.toDataURL('image/jpeg', q).split(',')[1];
        while (maxChars && b64.length > maxChars && q > 0.3) { q -= 0.1; b64 = c.toDataURL('image/jpeg', q).split(',')[1]; }
        if (maxChars && b64.length > maxChars) { reject(Api.ApiError('Photo trop lourde même réduite. Essaie une autre photo.', 'PHOTO')); return; }
        resolve({ b64: b64 });
      };
      img.onerror = function () { reject(Api.ApiError('Photo illisible. Réessaie.', 'PHOTO')); };
      img.src = url;
    });
  }
  function photoOf(name) {
    if (S.photos[name]) return S.photos[name];
    var p = Store.get('photo.' + name, null);
    if (p) S.photos[name] = p;
    return p;
  }
  var photoQueue = {}, photoTimer = null;
  // Charge en arrière-plan les photos qui manquent, puis met l'écran à jour.
  function wantPhotos(names) {
    var has = {}; ((S.data && S.data.photos) || []).forEach(function (n) { has[n] = 1; });
    names.forEach(function (n) { if (has[n] && !photoOf(n)) photoQueue[n] = 1; });
    if (!Object.keys(photoQueue).length || photoTimer || !navigator.onLine) return;
    photoTimer = setTimeout(async function () {
      var list = Object.keys(photoQueue).slice(0, 20); photoQueue = {};
      try {
        var r = await Api.call('photos', { token: S.token, names: list }, { tries: 1 });
        Object.keys(r.photos || {}).forEach(function (n) { S.photos[n] = r.photos[n]; Store.set('photo.' + n, r.photos[n]); });
        $$('[data-photo]').forEach(function (img) { var p = photoOf(img.getAttribute('data-photo')); if (p) { img.src = 'data:image/jpeg;base64,' + p; img.hidden = false; } });
      } catch (e) { /* les photos sont facultatives */ }
      photoTimer = null;
    }, 200);
  }
  function photoImg(name, cls) {
    var p = photoOf(name);
    return '<img class="' + (cls || 'photo') + '" data-photo="' + esc(name) + '" alt=""' + (p ? ' src="data:image/jpeg;base64,' + p + '"' : ' hidden') + '>';
  }

  /* ================= Erreurs ================= */
  var ADVICE = {
    HORS_LIGNE: 'Tu es hors ligne. Recettes, planning et liste restent utilisables ; les modifications seront envoyées au retour du réseau.',
    RESEAU: 'Vérifie ta connexion (wifi ou 4G) puis réessaie. Si ça continue, copie le rapport.',
    HTTP: 'Le serveur Google a un souci passager. Réessaie dans une minute.',
    OCCUPE: 'Plusieurs personnes écrivent en même temps. Réessaie dans quelques secondes.',
    REPONSE: 'Le script Google n’est peut-être pas déployé en accès « Tout le monde », ou pas à jour. Voir INSTALLATION.md, étape 4.',
    CONFIG: 'Va dans Connexion > Paramètres de connexion.',
    NON_AUTORISE: 'Cette action est réservée à l’admin.',
    NON_CONNECTE: 'Reconnecte-toi avec ton identifiant et ton mot de passe.',
    MDP_FAUX: 'Vérifie l’identifiant (ou l’e-mail) et le mot de passe, majuscules comprises. Après 5 erreurs, attente de 15 minutes. Oublié : « Mot de passe oublié ».',
    CODE_FAUX: 'Vérifie le code reçu par e-mail (valable 15 minutes) ou redemande un code.',
    PAS_DE_COMPTE: 'Dans le Sheet : menu Appli recettes > 2. Créer ou réinitialiser mon compte admin.',
    INSCRIPTION_FERMEE: 'Demande à l’admin de te créer un compte ou de rouvrir les inscriptions.',
    BLOQUE: 'Patiente un peu avant de réessayer.',
    DECALE: 'Touche « Actualiser » (Plus) puis recommence.',
    DOUBLON: 'Utilise l’élément existant ou choisis un autre nom.',
    DRIVE: 'Dans Apps Script : Services > + > Drive API > Ajouter, puis redéploie. Tu peux aussi saisir les valeurs à la main.',
    ONGLET: 'Dans le Sheet : menu Appli recettes > 1. Installer / vérifier.',
    PLEIN: 'Dans le Sheet, recopie la dernière ligne de formules vers le bas pour ajouter des lignes.',
    OFF: 'La base gratuite Open Food Facts est parfois surchargée. Réessaie dans un instant (le code est gardé), prends en photo le tableau nutritionnel, ou saisis les valeurs à la main.',
    CAMERA: 'Utilise « Prends une photo du code-barres » juste en dessous, ou tape les chiffres.'
  };
  function scrub(s) {
    return String(s == null ? '' : s)
      .replace(/AKfy[\w-]{10,}/g, '[id-api]')
      .replace(/[\w.@-]+\|\d{13}\|[\w-]{1,8}\|[\w-]+={0,2}/g, '[jeton]')
      .replace(/script\.google\.com\/macros\/s\/[\w-]+/g, 'script.google.com/macros/s/[id-api]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
      .replace(/"(token|code|password|oldPassword|newPassword)"\s*:\s*"[^"]*"/g, '"$1":"[masqué]"');
  }
  function report(err) {
    return scrub([
      'Rapport d’erreur — La Juste Assiette v' + VERSION,
      'Heure : ' + new Date().toLocaleString('fr-FR'),
      'Écran : ' + (location.hash || '#/'),
      'Ce que je faisais : ' + S.lastAction,
      'Code : ' + (err.code || '—'),
      'Message : ' + (err.message || err),
      'Détail technique : ' + (err.technical || (err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : '—')),
      'Rôle : ' + (S.me ? S.me.role : '—') + ' — En attente d’envoi : ' + Sync.queue().length,
      'En ligne : ' + (navigator.onLine ? 'oui' : 'non') + ' — Mode démo : ' + (demo() ? 'oui' : 'non'),
      'Navigateur : ' + navigator.userAgent
    ].join('\n'));
  }
  function showError(err, retry) {
    S.lastError = err;
    var box = $('#errorbox');
    // Erreur « attendue » (saisie, réseau, mot de passe…) : on explique quoi faire.
    // Erreur inattendue (bug) : message simple + ticket, sauf pour l'admin qui voit le détail.
    var bug = !USER_ERRORS[err.code];
    var simple = bug && !isAdminAccount();
    box.innerHTML = '<div class="err-card" role="alert">' +
      (simple ? '<p class="err-title">Oups, un problème est survenu.</p>' +
        '<p class="err-advice">Ce n’est pas de ta faute. Envoie un ticket : l’admin reçoit le détail et corrigera.</p>' +
        '<textarea id="tk-com" rows="2" maxlength="500" placeholder="Que faisais-tu ? (facultatif)" aria-label="Ce que tu faisais"></textarea>'
        : '<p class="err-title">' + esc(err.message || 'Une erreur est survenue.') + '</p>' +
        '<p class="err-advice">' + esc(ADVICE[err.code] || 'Réessaie. Si ça recommence, copie le rapport et colle-le dans Claude Code.') + '</p>') +
      '<div class="row wrap">' +
      (simple ? '<button class="btn primary" data-x="ticket">Envoyer un ticket</button>' : '') +
      (retry ? '<button class="btn" data-x="retry">Réessayer</button>' : '') +
      (isAdminAccount() ? '<button class="btn ghost" data-x="copy">Copier le rapport d’erreur</button>' : '') +
      '<button class="btn ghost" data-x="close">Fermer</button></div>' +
      (!simple && !isAdminAccount() ? '<button class="linkbtn small" data-x="ticket">Ce message te semble anormal ? Envoyer un ticket</button>' : '') + '</div>';
    box.hidden = false;
    box.onclick = function (e) {
      var x = e.target.getAttribute('data-x');
      if (x === 'close') box.hidden = true;
      if (x === 'retry') { box.hidden = true; retry(); }
      if (x === 'copy') copyText(report(err)).then(function (ok) { toast(ok ? 'Rapport copié. Colle-le dans Claude Code.' : 'Copie impossible : fais une capture d’écran.'); });
      if (x === 'ticket') { var c = $('#tk-com'); sendTicket(err, c ? c.value : ''); box.hidden = true; }
    };
  }
  // Erreurs qui ne sont pas des bugs : pas de ticket proposé d'office.
  var USER_ERRORS = { HORS_LIGNE: 1, RESEAU: 1, OCCUPE: 1, MDP_FAUX: 1, CODE_FAUX: 1, DOUBLON: 1, VALEUR: 1, BLOQUE: 1,
    INSCRIPTION_FERMEE: 1, NON_AUTORISE: 1, NON_CONNECTE: 1, PAS_DE_COMPTE: 1, DECALE: 1, CAMERA: 1, PHOTO: 1, OFF: 1, INTROUVABLE: 1 };
  // Ticket : envoyé tout de suite, ou dès que le réseau revient (file d'attente).
  function sendTicket(err, comment) {
    var payload = { ticket: { screen: location.hash || '#/', message: (err.code ? err.code + ' : ' : '') + scrub(err.message || String(err)),
      report: report(err), comment: scrub(comment || '') } };
    if (S.token) Sync.push(null, 'ticket', payload);
    else Api.call('ticket', payload, { tries: 2 }).catch(function () {});
    toast('Ticket envoyé, merci ! L’admin est prévenu.');
  }
  window.addEventListener('error', function (e) { var err = e.error || new Error(e.message); if (!err.code) err.code = 'JS'; showError(err); });
  window.addEventListener('unhandledrejection', function (e) {
    var err = e.reason instanceof Error ? e.reason : new Error(String(e.reason)); if (!err.code) err.code = 'JS'; showError(err);
  });
  async function act(label, fn, retryable) {
    S.lastAction = label;
    try { return await fn(); }
    catch (err) { showError(err, retryable === false ? null : function () { act(label, fn, retryable); }); return undefined; }
  }

  /* ================= Barre d'état et navigation ================= */
  function status() {
    var el = $('#status');
    var off = !navigator.onLine, q = Sync.queue().length;
    var txt = S.loading ? 'Mise à jour…' : (S.data ? 'Màj ' + dateFr(S.data.fetchedAt).replace(' à ', ' ') : '');
    el.innerHTML = (off ? '<span class="badge warn">Hors ligne</span> ' : '') +
      (q ? '<span class="badge warn" title="Modifications en attente d’envoi">⟳ ' + q + '</span> ' : '') +
      (demo() ? '<span class="badge">Démo</span> ' : '') +
      (isAdmin() ? '<span class="badge ok">Admin</span> ' : '') + '<span class="upd">' + esc(txt) + '</span>';
  }
  window.addEventListener('online', function () { status(); refresh(true); });
  window.addEventListener('offline', status);

  var routes = [];
  function route(re, fn) { routes.push([re, fn]); }
  var OPEN = /^#\/(login|inscription|oubli|connexion|confidentialite)/;
  function render() {
    status();
    var h = location.hash || '#/';
    var main = $('#main');
    if (!S.token && !OPEN.test(h)) h = '#/login';
    else if (S.token && /^#\/(login|inscription|oubli)/.test(h)) h = '#/recettes';
    if (S.token && !S.data && !OPEN.test(h)) { main.innerHTML = screenLoading(); bindLoading(); nav(''); return; }
    if (S.token && S.data && !prof() && !/^#\/(profil|connexion|compte|confidentialite)/.test(h)) h = '#/profil';
    for (var i = 0; i < routes.length; i++) {
      var m = h.match(routes[i][0]);
      if (m) {
        var out = routes[i][1].apply(null, m.slice(1).map(decodeURIComponent));
        if (!out) return;
        main.innerHTML = out.html;
        nav(out.tab || '');
        if (out.bind) out.bind(main);
        $('#main').focus({ preventScroll: true });
        return;
      }
    }
    go('#/recettes');
  }
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  function nav(tab) {
    $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    $('#nav').hidden = !S.token || !S.data || !prof();
    var badge = $('#nav [data-tab="plus"] .dot');
    var n = isAdmin() && S.data ? (S.data.pending || 0) + (S.data.tickets || 0) : 0;
    if (badge) { badge.textContent = n; badge.hidden = !n; }
  }
  function redirect(h) { setTimeout(function () { go(h); }); return { html: '' }; }

  function screenLoading() {
    return '<section class="screen"><h1>Chargement</h1><p>Lecture des recettes en cours…</p>' +
      '<button class="btn primary big" id="w-retry">Réessayer</button><button class="btn ghost big" id="w-out">Se déconnecter</button></section>';
  }
  function bindLoading() { $('#w-retry').onclick = function () { refresh(); }; $('#w-out').onclick = function () { logout(); }; }

  /* ================= Connexion, inscription, mot de passe oublié ================= */
  async function afterLogin(r, msg) {
    setSession(r.token, r.me);
    keepStorage();
    Store.set('adminView', true);
    await loadData();
    toast(msg || ('Bonjour ' + r.me.name));
    go(prof() ? '#/recettes' : '#/profil');
  }

  route(/^#\/login$/, function () {
    return { html: '<section class="screen"><h1>Connexion</h1>' +
      (demo() ? '<p class="notice">Mode démo : <b>admin</b> ou <b>client</b>, mot de passe <b>demo1234</b>.</p>' : '') +
      '<form id="l-form">' +
      field('Identifiant ou e-mail', '<input id="l-id" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>') +
      field('Mot de passe', '<input id="l-pw" type="password" autocomplete="current-password" required>') +
      '<button class="btn primary big" type="submit">Se connecter</button></form>' +
      '<a class="btn ghost big" href="#/oubli">Mot de passe oublié</a>' +
      '<hr><p>Pas encore de compte ?</p><a class="btn big" href="#/inscription">Créer mon compte</a>' +
      '<hr><button class="btn ghost big" id="l-demo">' + (demo() ? 'Quitter le mode démo' : 'Essayer avec des données de démo') + '</button>' +
      '<a class="btn ghost big" href="#/connexion">Paramètres de connexion</a>' +
      '<footer class="legal"><a href="confidentialite.html">Confidentialité et données personnelles</a><span>v' + VERSION + '</span></footer></section>',
      bind: function () {
        $('#l-form').onsubmit = function (e) {
          e.preventDefault();
          var id = $('#l-id').value.trim(), pw = $('#l-pw').value;
          if (!id || !pw) return;
          act('connexion', async function () { await afterLogin(await Api.call('login', { id: id, password: pw }, { tries: 2 })); }, false);
        };
        $('#l-demo').onclick = function () { Store.set('demo', !demo()); Api.loadDemo().then(function () { Demo.reset(); render(); }, function () { render(); }); };
      } };
  });

  route(/^#\/inscription$/, function () {
    return { html: '<section class="screen"><a class="back" href="#/login">‹ Connexion</a><h1>Créer mon compte</h1>' +
      '<p class="muted">Tu auras accès aux recettes, à ton planning, à ta liste de courses et au calcul des quantités selon tes objectifs.</p>' +
      '<form id="s-form">' +
      field('Prénom', '<input id="s-name" autocomplete="given-name" maxlength="40" required>', 'Affiché à ton foyer et sur tes commentaires. S’il est déjà pris, ajoute une initiale (ex. Marie L.).') +
      field('E-mail', '<input id="s-email" type="email" autocomplete="email" autocapitalize="none" required>', 'Sert uniquement à recevoir un code si tu oublies ton mot de passe.') +
      field('Identifiant', '<input id="s-id" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>', '3 à 30 lettres ou chiffres, sans espace ni accent (ex. marie.l).') +
      field('Mot de passe', '<input id="s-pw" type="password" autocomplete="new-password" minlength="8" required>', '8 caractères minimum.') +
      field('Mot de passe (encore)', '<input id="s-pw2" type="password" autocomplete="new-password" required>') +
      '<label class="toggle"><input type="checkbox" id="s-ok" required> J’ai lu la <a href="confidentialite.html" target="_blank" rel="noopener">page de confidentialité</a> et je l’accepte.</label>' +
      '<button class="btn primary big" type="submit">Créer mon compte</button></form></section>',
      bind: function () {
        $('#s-form').onsubmit = function (e) {
          e.preventDefault();
          var a = { name: $('#s-name').value.trim(), email: $('#s-email').value.trim(), id: $('#s-id').value.trim().toLowerCase(),
            password: $('#s-pw').value, consent: $('#s-ok').checked };
          if (!/^[a-z0-9._-]{3,30}$/.test(a.id)) { toast('Identifiant : 3 à 30 lettres/chiffres, sans espace ni accent.'); return; }
          if (a.password.length < 8) { toast('Mot de passe : 8 caractères minimum.'); return; }
          if (a.password !== $('#s-pw2').value) { toast('Les deux mots de passe sont différents.'); return; }
          if (!a.consent) { toast('Merci d’accepter la page de confidentialité.'); return; }
          act('inscription', async function () { await afterLogin(await Api.call('signup', { account: a }, { tries: 1 }), 'Bienvenue ' + a.name + ' ! Règle tes objectifs.'); }, false);
        };
      } };
  });

  route(/^#\/oubli$/, function () {
    var st = Store.get('forgot', null);
    return { html: '<section class="screen"><a class="back" href="#/login">‹ Connexion</a><h1>Mot de passe oublié</h1>' +
      '<form id="f1">' + field('E-mail du compte', '<input id="f-email" type="email" autocomplete="email" autocapitalize="none" value="' + esc(st ? st.email : '') + '" required>') +
      '<button class="btn ' + (st ? '' : 'primary ') + 'big" type="submit">' + (st ? 'Renvoyer un code' : 'Recevoir un code par e-mail') + '</button></form>' +
      (st ? '<div class="notice">Si un compte utilise cette adresse, un code à 6 chiffres vient d’y être envoyé (regarde aussi les indésirables).' +
        (demo() && window.Demo && Demo.lastMail() ? '<br>Mode démo : ' + esc((Demo.lastMail().body.match(/\d{6}/) || [''])[0]) : '') + '</div>' +
        '<form id="f2">' + field('Code reçu', '<input id="f-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>') +
        field('Nouveau mot de passe', '<input id="f-pw" type="password" autocomplete="new-password" minlength="8" required>', '8 caractères minimum.') +
        '<button class="btn primary big" type="submit">Changer le mot de passe</button></form>' : '') + '</section>',
      bind: function () {
        $('#f1').onsubmit = function (e) {
          e.preventDefault();
          var email = $('#f-email').value.trim();
          act('demande de code', async function () {
            await Api.call('forgot', { email: email }, { tries: 1 });
            Store.set('forgot', { email: email }); render();
          }, false);
        };
        var f2 = $('#f2');
        if (f2) f2.onsubmit = function (e) {
          e.preventDefault();
          act('changement de mot de passe', async function () {
            var r = await Api.call('resetWithCode', { email: st.email, code: $('#f-code').value.trim(), password: $('#f-pw').value }, { tries: 1 });
            Store.del('forgot'); await afterLogin(r, 'Mot de passe changé');
          }, false);
        };
      } };
  });

  route(/^#\/connexion$/, function () {
    var cur = Store.get('apiUrl', '');
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="' + (S.token ? '#/plus' : '#/login') + '">‹ Retour</a><h1>Paramètres de connexion</h1>' +
      '<p>Lien du serveur (« Application Web » Apps Script). Laisse vide pour le serveur par défaut.</p>' +
      field('Lien de l’application Web', '<input id="c-url" type="url" inputmode="url" autocomplete="off" value="' + esc(cur ? Api.apiUrl() : '') + '">') +
      '<button class="btn primary big" id="c-save">Enregistrer</button>' +
      '<hr><p class="muted">Mode démo : données fictives, rien n’est écrit dans le Sheet.</p>' +
      '<button class="btn ghost big" id="c-demo">' + (demo() ? 'Quitter le mode démo' : 'Passer en mode démo') + '</button>' +
      (demo() ? '<button class="btn ghost big" id="c-reset">Remettre la démo à zéro</button>' : '') +
      '<p class="muted small">Version ' + VERSION + '</p></section>',
      bind: function () {
        $('#c-save').onclick = function () {
          var v = $('#c-url').value.trim(), m = v.match(/\/macros\/s\/([\w-]+)/);
          if (v && !m) { toast('Lien non reconnu. Il doit contenir /macros/s/…'); return; }
          if (m) Store.set('apiUrl', m[1]); else Store.del('apiUrl');
          Store.set('demo', false); logout('Serveur enregistré. Connecte-toi.');
        };
        $('#c-demo').onclick = function () { Store.set('demo', !demo()); logout(demo() ? 'Mode démo : admin ou client, mot de passe demo1234.' : 'Mode démo quitté.'); };
        var cr = $('#c-reset'); if (cr) cr.onclick = function () { Api.loadDemo().then(function () { Demo.reset(); logout('Démo remise à zéro.'); }); };
      } };
  });

  /* ================= Plus ================= */
  route(/^#\/plus$/, function () {
    var adm = isAdminAccount(), pend = (S.data.pending || 0), tks = (S.data.tickets || 0);
    var item = function (href, label, extra) { return '<a class="btn big" href="' + href + '">' + label + (extra || '') + '</a>'; };
    return { tab: 'plus', html: '<section class="screen"><h1>Plus</h1>' +
      '<p class="muted">Connecté : <b>' + esc(S.me.name) + '</b> (' + esc(S.me.id) + (adm ? ', admin' : '') + ')' +
      (S.data.foyer ? ' · foyer « ' + esc(S.data.foyer.name) + ' »' : '') + '</p>' +
      '<div class="stack">' + item('#/compte', 'Mon compte') + '</div>' +
      (adm ? '<div class="panel"><div class="panel-title">Affichage</div><div class="row wrap">' +
        '<button class="btn ' + (isAdmin() ? 'primary' : '') + '" data-view="admin">Vue admin</button>' +
        '<button class="btn ' + (!isAdmin() ? 'primary' : '') + '" data-view="client">Vue client</button></div>' +
        '<p class="muted small">La vue client montre l’appli comme la voient tes proches.</p></div>' : '') +
      (isAdmin() ? '<div class="panel"><div class="panel-title">Admin</div><div class="stack">' +
        item('#/admin', 'Tableau de bord', (pend ? ' <span class="badge warn">' + pend + ' à valider</span>' : '') + (tks ? ' <span class="badge warn">' + tks + ' ticket(s)</span>' : '')) +
        item('#/gestion', 'Gestion de la base') + item('#/comptes', 'Comptes utilisateurs') + '</div></div>' : '') +
      '<div class="stack">' +
      item('#/profil', 'Mes objectifs') + item('#/poids', 'Mon poids') + item('#/foyer', 'Mon foyer') +
      item('#/stock', 'Stock cuisine') + item('#/session', 'Session de cuisine (batch)') +
      item('#/inviter', 'Inviter des proches (QR code)') +
      '<a class="btn big" href="guide.html">Mode d’emploi</a>' +
      (adm ? '<a class="btn ghost big" href="#/connexion">Paramètres de connexion</a>' : '') +
      (S.lastError ? '<button class="btn ghost big" id="x-report">Copier le dernier rapport d’erreur</button>' : '') +
      '<button class="btn ghost big" id="x-logout">Se déconnecter</button>' +
      '</div><footer class="legal"><a href="confidentialite.html">Confidentialité et données personnelles</a>' +
      '<span>Données du ' + dateFr(S.data.fetchedAt) + ' · v' + VERSION + '</span></footer></section>',
      bind: function (el) {
        $$('[data-view]', el).forEach(function (b) {
          b.onclick = function () { Store.set('adminView', b.getAttribute('data-view') === 'admin'); render(); toast(isAdmin() ? 'Vue admin' : 'Vue client'); };
        });
        $('#x-logout', el).onclick = function () {
          if (Sync.queue().length && !confirm(Sync.queue().length + ' modification(s) pas encore envoyée(s) seront perdues. Se déconnecter quand même ?')) return;
          logout('Déconnecté');
        };
        var xr = $('#x-report', el); if (xr) xr.onclick = function () { copyText(report(S.lastError)).then(function () { toast('Rapport copié'); }); };
      } };
  });

  route(/^#\/?$/, function () { return redirect('#/recettes'); });

  /* ================= Minuteurs, écran allumé, dictée ================= */
  function timerHtml(id, min) {
    var t = S.timers[id], left = t ? remaining(t) : min * 60;
    return '<div class="timer' + (t && t.done ? ' ring' : '') + '" data-timer="' + esc(id) + '" data-min="' + min + '">' +
      '<output class="clock">' + clock(left) + '</output><div class="row">' +
      '<button class="btn primary" data-t="start">' + (t && t.running ? 'Pause' : (t && left < min * 60 && !t.done ? 'Reprendre' : 'Démarrer')) + '</button>' +
      '<button class="btn ghost" data-t="reset">Remettre</button></div></div>';
  }
  function remaining(t) { return Math.max(0, t.running ? Math.round((t.endAt - Date.now()) / 1000) : t.left); }
  function clock(s) { var m = Math.floor(s / 60), ss = s % 60; return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }
  function bindTimers(el) {
    $$('[data-timer]', el).forEach(function (box) {
      var id = box.getAttribute('data-timer'), min = Number(box.getAttribute('data-min'));
      $('[data-t="start"]', box).onclick = function () {
        unlockAudio();
        var t = S.timers[id] || (S.timers[id] = { left: min * 60, running: false, done: false });
        if (t.done) { t.left = min * 60; t.done = false; }
        if (t.running) { t.left = remaining(t); t.running = false; } else { t.endAt = Date.now() + t.left * 1000; t.running = true; }
        refreshTimer(box, id, min);
      };
      $('[data-t="reset"]', box).onclick = function () { delete S.timers[id]; stopRing(); refreshTimer(box, id, min); };
    });
    tickLoop();
  }
  function refreshTimer(box, id, min) {
    var tmp = document.createElement('div'); tmp.innerHTML = timerHtml(id, min);
    var nb = tmp.firstChild; box.replaceWith(nb); bindTimers(nb.parentNode);
  }
  function tickLoop() {
    if (S.tick) return;
    S.tick = setInterval(function () {
      var any = false;
      Object.keys(S.timers).forEach(function (id) {
        var t = S.timers[id]; if (!t.running) return;
        any = true;
        var left = remaining(t), box = document.querySelector('[data-timer="' + CSS.escape(id) + '"]');
        if (box) $('.clock', box).textContent = clock(left);
        if (left <= 0) { t.running = false; t.left = 0; t.done = true; ring(); if (box) refreshTimer(box, id, Number(box.getAttribute('data-min'))); }
      });
      if (!any) { clearInterval(S.tick); S.tick = null; }
    }, 250);
  }
  var audio = null;
  function unlockAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {} }
  function ring() {
    stopRing(); document.body.classList.add('flash');
    toast('Minuteur terminé ! Touche l’écran pour arrêter la sonnerie.');
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
    var n = 0; S.ringer = setInterval(function () { beep(); if (++n >= 10) stopRing(); }, 900); beep();
  }
  function stopRing() { clearInterval(S.ringer); S.ringer = null; document.body.classList.remove('flash'); }
  document.addEventListener('pointerdown', function () { if (S.ringer) stopRing(); }, true);
  function beep() {
    try {
      unlockAudio(); if (!audio) return;
      var o = audio.createOscillator(), gn = audio.createGain();
      o.type = 'square'; o.frequency.value = 880; gn.gain.value = 0.25;
      o.connect(gn); gn.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.35);
    } catch (e) {}
  }
  async function toggleWake(on) {
    try {
      if (on) {
        if (!('wakeLock' in navigator)) { toast('Ton téléphone ne permet pas de garder l’écran allumé depuis le navigateur.'); return; }
        S.wakeLock = await navigator.wakeLock.request('screen');
        S.wakeWanted = true; toast('L’écran restera allumé');
      } else { S.wakeWanted = false; if (S.wakeLock) await S.wakeLock.release(); S.wakeLock = null; }
    } catch (e) { toast('Impossible de garder l’écran allumé : ' + e.message); }
  }
  document.addEventListener('visibilitychange', function () { if (S.wakeWanted && document.visibilityState === 'visible') toggleWake(true); });
  function dictate(ta, btn) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Utilise le micro du clavier pour dicter.'); return; }
    var rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false;
    btn.textContent = '… j’écoute'; btn.disabled = true;
    rec.onresult = function (e) { ta.value = (ta.value ? ta.value + ', ' : '') + e.results[0][0].transcript; };
    rec.onerror = function (e) { toast('Dictée impossible (' + e.error + '). Utilise le micro du clavier.'); };
    rec.onend = function () { btn.textContent = '🎤 Dicter'; btn.disabled = false; };
    try { rec.start(); } catch (e) { rec.onend(); }
  }

  function macroTable(t, title) {
    return '<div class="macros">' + (title ? '<div class="macros-title">' + title + '</div>' : '') +
      '<div class="m"><span>kcal</span><b>' + fmt(t.kcal) + '</b></div>' +
      '<div class="m"><span>Protéines</span><b>' + fmt(t.p, 1) + ' g</b></div>' +
      '<div class="m"><span>Glucides</span><b>' + fmt(t.g, 1) + ' g</b></div>' +
      '<div class="m"><span>Lipides</span><b>' + fmt(t.l, 1) + ' g</b></div>' +
      '<div class="m"><span>Fibres</span><b>' + fmt(t.f, 1) + ' g</b></div>' +
      '<div class="m"><span>Coût</span><b>' + (t.missingPrice && t.missingPrice.length ? '<span class="warn-text">prix manquant</span>' : euro(t.cost)) + '</b></div></div>';
  }

  /* ================= Démarrage ================= */
  function boot() {
    var m = location.hash.match(/api=([\w-]+)/);
    if (m) {
      if (m[1] !== Store.get('apiUrl', '')) { Store.set('apiUrl', m[1]); setSession('', null); setData(null); }
      Store.set('demo', false); history.replaceState(null, '', location.pathname + '#/');
    }
    if (location.search.indexOf('demo=1') >= 0 && !Store.get('apiUrl', '')) Store.set('demo', true);
    ['token', 'profile'].forEach(function (k) { Store.del(k); }); // anciennes versions
    if (!S.token) setData(null);
    else if (S.data && !('plan' in S.data)) setData(null); // copie d'une ancienne version : on relit
    render();
    if (S.token) { keepStorage(); Sync.flush(); refresh(true); }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(function () {});
      // Nouvelle version téléchargée en arrière-plan : on recharge dès que c'est sans risque
      // (pas de formulaire en cours, rien en attente d'envoi), sinon à la prochaine ouverture.
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || S.reloading) return;
        if (!isFormScreen() && !Sync.queue().length) { S.reloading = true; location.reload(); }
        else toast('Nouvelle version prête : elle s’ouvrira au prochain lancement.');
      });
    }
  }

  window.App = {
    VERSION: VERSION, S: S, C: C, Store: Store, Api: Api, Sync: Sync, $: $, $$: $$, esc: esc, fmt: fmt, euro: euro, g: g,
    dateFr: dateFr, dayFr: dayFr, enc: enc, go: go, field: field, numIn: numIn, uid: uid, toast: toast, copyText: copyText, stars: stars,
    isAdmin: isAdmin, isAdminAccount: isAdminAccount, demo: demo, logout: logout, setSession: setSession,
    setData: setData, saveData: saveData, loadData: loadData, refresh: refresh, refreshStrict: refreshStrict,
    prof: prof, perMeal: perMeal, recipeByName: recipeByName, pk: pk, chosenKcal: chosenKcal, setChosenKcal: setChosenKcal,
    variantOf: variantOf, setVariant: setVariant, adjusted: adjusted, excluded: excluded, avisOf: avisOf, myAvis: myAvis,
    weekKey: weekKey, weekLabel: weekLabel, curWeek: curWeek, myRows: myRows, setMyRows: setMyRows, newRow: newRow,
    myMeals: myMeals, foyerMeals: foyerMeals, fetchFoyerWeek: fetchFoyerWeek, stockMap: stockMap, addLocalStock: addLocalStock,
    shrink: shrink, photoOf: photoOf, wantPhotos: wantPhotos, photoImg: photoImg,
    showError: showError, act: act, report: report, status: status, route: route, render: render, redirect: redirect,
    timerHtml: timerHtml, bindTimers: bindTimers, toggleWake: toggleWake, dictate: dictate, macroTable: macroTable, boot: boot
  };
})();
