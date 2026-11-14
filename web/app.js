/* Appli recettes & macros — écrans et logique d'interface. */
(function () {
  'use strict';
  var VERSION = '1.1.0';
  var C = window.Calc, Store = window.Store, Api = window.Api;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    data: Store.get('data', null),
    idx: null,
    profile: Store.get('profile', ''),
    token: Store.get('session', ''),
    me: Store.get('me', null),
    lastAction: 'ouverture',
    lastError: null,
    timers: {},
    wakeLock: null,
    loading: false
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
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function enc(s) { return encodeURIComponent(s); }
  function go(h) { location.hash = h; }
  // Compte admin (droits réels) / vue admin affichée (l'admin peut passer en vue client).
  function isAdminAccount() { return !!(S.token && S.me && S.me.role === 'admin'); }
  function isAdmin() { return isAdminAccount() && Store.get('adminView', true) !== false; }
  function demo() { return !!Store.get('demo', false); }

  function setSession(token, me) {
    S.token = token || ''; S.me = me || null;
    if (S.token) { Store.set('session', S.token); Store.set('me', S.me); } else { Store.del('session'); Store.del('me'); }
  }
  // Déconnexion : on efface aussi la copie des données de ce téléphone.
  function logout(msg) {
    setSession('', null); setData(null); S.profile = ''; Store.del('profile');
    if (msg) toast(msg);
    go('#/login'); render();
  }
  // Profil affiché : un client voit toujours le sien ; l'admin peut en choisir un autre.
  function syncProfile() {
    if (!S.me) return;
    if (S.me.role !== 'admin' || !S.profile || !(S.data && (S.data.profiles || []).some(function (p) { return p.name === S.profile; }))) {
      S.profile = S.me.name; Store.set('profile', S.profile);
    }
  }

  function setData(d) {
    S.data = d;
    S.idx = C.index(d ? d.ingredients : []);
    Store.set('data', d);
  }
  if (S.data) S.idx = C.index(S.data.ingredients);

  function profile() {
    if (!S.data) return null;
    return (S.data.profiles || []).filter(function (p) { return p.name === S.profile; })[0] || null;
  }
  function perMeal(p) {
    p = p || profile();
    var repas = (p && C.num(p.repas)) || 3;
    return {
      kcal: p && C.num(p.kcal) ? Math.round(C.num(p.kcal) / repas / 10) * 10 : null,
      prot: p && C.num(p.prot) ? C.num(p.prot) / repas : null,
      margin: ((p && C.num(p.marge)) || 10) / 100
    };
  }
  function recipeByName(n) { return (S.data.recipes || []).filter(function (r) { return r.name === n; })[0]; }
  function pk(k) { return k + '.' + S.profile; }

  // kcal choisies pour une recette par le profil (sinon cible par repas, sinon fiche).
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
  function variantOf(r, kcal) {
    var v = Store.get(pk('variant'), {})[r.name];
    return v && v.kcal === kcal ? v : null;
  }

  // Résultat ajusté (en tenant compte d'une alternative choisie).
  function adjusted(r, kcal) {
    var pm = perMeal();
    var a = C.adjust(r, S.idx, { kcal: kcal, protRef: pm.prot, margin: pm.margin });
    var v = variantOf(r, kcal);
    if (v) {
      var items = v.items.map(function (it) {
        var ing = C.find(S.idx, it.name);
        return { name: it.name, ing: ing, role: ing ? C.roleOf(ing) : 'autre', qty0: it.qty0, qty: it.qty, fixed: true };
      });
      a = Object.assign({}, a, { items: items, totals: C.totals(items, S.idx), status: 'variant',
        messages: ['Version modifiée : ' + v.label + '.'] });
      a.protStatus = C.protStatus(a.totals.p, pm.prot, pm.margin);
    }
    return a;
  }

  /* ================= Erreurs ================= */
  var ADVICE = {
    HORS_LIGNE: 'Tu es hors ligne. Les recettes et la liste de courses restent consultables. Réessaie l’enregistrement quand le réseau revient.',
    RESEAU: 'Vérifie ta connexion (wifi ou 4G) puis réessaie. Si ça continue, copie le rapport.',
    HTTP: 'Le serveur Google a un souci passager. Réessaie dans une minute.',
    REPONSE: 'Le script Google n’est peut-être pas déployé en accès « Tout le monde », ou son autorisation a expiré. Voir le mode d’emploi, étape « Déployer ».',
    CONFIG: 'Ouvre le lien complet que tu as reçu, ou demande à l’admin le lien de connexion.',
    NON_AUTORISE: 'Cette action est réservée à l’admin.',
    NON_CONNECTE: 'Reconnecte-toi avec ton identifiant et ton mot de passe.',
    MDP_FAUX: 'Vérifie l’identifiant et le mot de passe (majuscules comprises). Après 5 erreurs, attente de 15 minutes. Mot de passe oublié : demande à l’admin de le réinitialiser.',
    PAS_DE_COMPTE: 'Dans le Sheet : menu Appli recettes > 2. Créer ou réinitialiser mon compte admin.',
    BLOQUE: 'Patiente 15 minutes avant de réessayer.',
    DECALE: 'Touche « Actualiser les données » (Plus) puis recommence.',
    DOUBLON: 'Utilise l’élément existant au lieu d’en créer un nouveau.',
    DRIVE: 'Dans Apps Script : Services > + > Drive API > Ajouter, puis redéploie. Tu peux aussi saisir les valeurs à la main.',
    PLEIN: 'Dans le Sheet, recopie la dernière ligne de formules vers le bas pour ajouter des lignes.'
  };

  function scrub(s) {
    return String(s == null ? '' : s)
      .replace(/AKfy[\w-]{10,}/g, '[id-api]')
      .replace(/[\w.-]+\|\d{13}\|[\w-]{1,8}\|[\w-]+={0,2}/g, '[jeton]')
      .replace(/script\.google\.com\/macros\/s\/[\w-]+/g, 'script.google.com/macros/s/[id-api]')
      .replace(/"(token|code|password|oldPassword|newPassword)"\s*:\s*"[^"]*"/g, '"$1":"[masqué]"');
  }

  function report(err) {
    return scrub([
      'Rapport d’erreur — appli recettes v' + VERSION,
      'Heure : ' + new Date().toLocaleString('fr-FR'),
      'Écran : ' + (location.hash || '#/'),
      'Ce que je faisais : ' + S.lastAction,
      'Code : ' + (err.code || '—'),
      'Message : ' + (err.message || err),
      'Détail technique : ' + (err.technical || (err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : '—')),
      'En ligne : ' + (navigator.onLine ? 'oui' : 'non') + ' — Mode démo : ' + (demo() ? 'oui' : 'non'),
      'Navigateur : ' + navigator.userAgent
    ].join('\n'));
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

  function showError(err, retry) {
    S.lastError = err;
    var box = $('#errorbox');
    box.innerHTML = '<div class="err-card" role="alert">' +
      '<p class="err-title">' + esc(err.message || 'Une erreur est survenue.') + '</p>' +
      '<p class="err-advice">' + esc(ADVICE[err.code] || 'Réessaie. Si ça recommence, copie le rapport et colle-le dans Claude Code.') + '</p>' +
      '<div class="row wrap">' +
      (retry ? '<button class="btn" data-x="retry">Réessayer</button>' : '') +
      '<button class="btn ghost" data-x="copy">Copier le rapport d’erreur</button>' +
      '<button class="btn ghost" data-x="close">Fermer</button></div></div>';
    box.hidden = false;
    box.onclick = function (e) {
      var x = e.target.getAttribute('data-x');
      if (x === 'close') box.hidden = true;
      if (x === 'retry') { box.hidden = true; retry(); }
      if (x === 'copy') copyText(report(err)).then(function (ok) { toast(ok ? 'Rapport copié. Colle-le dans Claude Code.' : 'Copie impossible : fais une capture d’écran.'); });
    };
  }

  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  window.addEventListener('error', function (e) {
    var err = e.error || new Error(e.message); if (!err.code) err.code = 'JS'; showError(err);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var err = e.reason instanceof Error ? e.reason : new Error(String(e.reason)); if (!err.code) err.code = 'JS'; showError(err);
  });

  async function act(label, fn, retryable) {
    S.lastAction = label;
    try { return await fn(); }
    catch (err) { showError(err, retryable === false ? null : function () { act(label, fn, retryable); }); return undefined; }
  }

  /* ================= Données ================= */
  async function refresh(silent) {
    if (S.loading) return;
    if ((!demo() && !Api.apiUrl()) || !S.token) { render(); return; }
    S.loading = true; status();
    try {
      S.lastAction = 'lecture du Sheet';
      await loadData();
      if (!isFormScreen()) render(); else status();
      if (!silent) toast('Données à jour');
    } catch (err) {
      if (err.code === 'NON_CONNECTE') { logout('Connexion expirée : reconnecte-toi.'); return; }
      if (err.code !== 'HORS_LIGNE' || !S.data) showError(err, function () { refresh(); });
    } finally { S.loading = false; status(); }
  }
  async function loadData() {
    var d = await Api.call('data', { token: S.token });
    delete d.ok;
    if (d.me) { setSession(S.token, d.me); delete d.me; }
    setData(d); syncProfile();
  }

  function isFormScreen() { return /^#\/(ingredient|nouvelle-recette|profil-edit|connexion|cuisine|login|compte|comptes)/.test(location.hash); }

  function status() {
    var el = $('#status');
    var off = !navigator.onLine;
    var txt = S.loading ? 'Mise à jour…' : (S.data ? 'Màj ' + dateFr(S.data.fetchedAt).replace(' à ', ' ') : 'Aucune donnée');
    el.innerHTML = (off ? '<span class="badge warn">Hors ligne</span> ' : '') +
      (demo() ? '<span class="badge">Démo</span> ' : '') +
      (isAdmin() ? '<span class="badge ok">Admin</span> ' : '') + esc(txt);
  }
  window.addEventListener('online', function () { status(); refresh(true); });
  window.addEventListener('offline', status);

  /* ================= Routage ================= */
  var routes = [];
  function route(re, fn) { routes.push([re, fn]); }

  function render() {
    status();
    var h = location.hash || '#/';
    var main = $('#main');
    if (!S.token && !/^#\/connexion/.test(h)) h = '#/login';
    else if (S.token && /^#\/login/.test(h)) h = '#/recettes';
    if (S.token && !S.data && !/^#\/connexion/.test(h)) { main.innerHTML = screenWelcome(); bindWelcome(); nav(''); return; }
    if (S.token && S.data && !profile() && !/^#\/(profils|profil-edit|connexion|compte)/.test(h)) { h = '#/profils'; }
    for (var i = 0; i < routes.length; i++) {
      var m = h.match(routes[i][0]);
      if (m) {
        var out = routes[i][1].apply(null, m.slice(1).map(decodeURIComponent));
        main.innerHTML = out.html;
        nav(out.tab || '');
        if (out.bind) out.bind(main);
        $('#main').focus({ preventScroll: true });
        return;
      }
    }
    go('#/recettes');
  }
  window.addEventListener('hashchange', function () { stopAllTimersIfLeaving(); render(); window.scrollTo(0, 0); });

  function nav(tab) {
    $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    $('#nav').hidden = !S.token || !S.data || !profile();
  }

  /* ================= Accueil / connexion ================= */
  function screenWelcome() {
    return '<section class="screen"><h1>Chargement</h1>' +
      '<p>Lecture des recettes en cours…</p><button class="btn primary big" id="w-retry">Réessayer</button>' +
      '<button class="btn ghost big" id="w-out">Se déconnecter</button></section>';
  }
  function bindWelcome() {
    $('#w-retry').onclick = function () { refresh(); };
    $('#w-out').onclick = function () { logout(); };
  }

  route(/^#\/login$/, function () {
    return { html: '<section class="screen"><h1>Connexion</h1>' +
      '<p>Connecte-toi avec l’identifiant et le mot de passe donnés par l’admin.</p>' +
      (demo() ? '<p class="notice">Mode démo : <b>admin</b> ou <b>client</b>, mot de passe <b>demo1234</b>.</p>' : '') +
      '<form id="l-form">' +
      field('Identifiant', '<input id="l-id" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>') +
      field('Mot de passe', '<input id="l-pw" type="password" autocomplete="current-password" required>') +
      '<button class="btn primary big" type="submit">Se connecter</button></form>' +
      '<p class="muted small">Mot de passe oublié : demande à l’admin de le réinitialiser.</p>' +
      '<hr><button class="btn ghost big" id="l-demo">' + (demo() ? 'Quitter le mode démo' : 'Essayer avec des données de démo') + '</button>' +
      '<a class="btn ghost big" href="#/connexion">Paramètres de connexion</a></section>',
      bind: function () {
        $('#l-form').onsubmit = function (e) {
          e.preventDefault();
          var id = $('#l-id').value.trim(), pw = $('#l-pw').value;
          if (!id || !pw) return;
          act('connexion', async function () {
            var r = await Api.call('login', { id: id, password: pw }, { tries: 2 });
            setSession(r.token, r.me);
            S.profile = r.me.name; Store.set('profile', S.profile);
            await loadData(); toast('Bonjour ' + r.me.name);
            go(profile() ? '#/recettes' : '#/profils'); render();
          }, false);
        };
        $('#l-demo').onclick = function () { Store.set('demo', !demo()); Store.del('demoData'); render(); };
      } };
  });

  route(/^#\/connexion$/, function () {
    var cur = Store.get('apiUrl', '');
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="' + (S.token ? '#/plus' : '#/login') + '">‹ Retour</a><h1>Paramètres de connexion</h1>' +
      '<p>Lien du serveur (« Application Web » Apps Script, commence par <code>https://script.google.com/macros/s/</code>). ' +
      'Laisse vide pour utiliser le serveur par défaut.</p>' +
      '<label class="field"><span>Lien de l’application Web</span><input id="c-url" type="url" inputmode="url" autocomplete="off" value="' + esc(cur ? Api.apiUrl() : '') + '"></label>' +
      '<button class="btn primary big" id="c-save">Enregistrer</button>' +
      '<hr><p class="muted">Mode démo : données fictives, rien n’est écrit dans le Sheet.</p>' +
      '<button class="btn ghost big" id="c-demo">' + (demo() ? 'Quitter le mode démo' : 'Passer en mode démo') + '</button>' +
      '<p class="muted small">Version ' + VERSION + '</p></section>',
      bind: function () {
        $('#c-save').onclick = function () {
          var v = $('#c-url').value.trim();
          var m = v.match(/\/macros\/s\/([\w-]+)/);
          if (v && !m) { toast('Lien non reconnu. Il doit contenir /macros/s/…'); return; }
          if (m) Store.set('apiUrl', m[1]); else Store.del('apiUrl');
          Store.set('demo', false);
          logout('Serveur enregistré. Connecte-toi.');
        };
        $('#c-demo').onclick = function () {
          Store.set('demo', !demo()); Store.del('demoData');
          logout(demo() ? 'Mode démo : identifiant admin ou client, mot de passe demo1234.' : 'Mode démo quitté.');
        };
      } };
  });
  async function refreshStrict() { await loadData(); render(); }

  /* ================= Profils ================= */
  route(/^#\/profils$/, function () {
    if (!isAdminAccount()) {
      // Un client a un seul profil : le sien (à créer s'il n'existe pas encore).
      setTimeout(function () { go(profile() ? '#/recettes' : '#/profil-edit/' + enc(S.me ? S.me.name : '')); });
      return { html: '' };
    }
    var ps = S.data.profiles || [];
    return { tab: 'plus', html: '<section class="screen"><h1>Quel profil afficher ?</h1>' +
      (ps.length ? '<div class="stack">' + ps.map(function (p) {
        return '<button class="btn big profile ' + (p.name === S.profile ? 'primary' : '') + '" data-p="' + esc(p.name) + '">' +
          '<strong>' + esc(p.name) + '</strong><span>' + fmt(p.kcal) + ' kcal · ' + fmt(p.prot) + ' g prot. · ' + esc(p.objectif || '') + '</span></button>';
      }).join('') + '</div>' : '<p>Aucun profil pour l’instant.</p>') +
      '<a class="btn ghost big" href="#/profil-edit/">+ Nouveau profil</a></section>',
      bind: function (el) {
        $$('[data-p]', el).forEach(function (b) {
          b.onclick = function () { S.profile = b.getAttribute('data-p'); Store.set('profile', S.profile); go('#/recettes'); };
        });
      } };
  });

  route(/^#\/profil-edit\/(.*)$/, function (name) {
    if (!isAdminAccount() && S.me) name = S.me.name; // un client ne règle que son propre profil
    var found = (S.data.profiles || []).filter(function (x) { return x.name === name; })[0];
    var p = found || { name: name, objectif: 'Maintien', repas: 3, marge: 10 };
    var obj = ['Sèche', 'Maintien', 'Masse'];
    return { tab: 'plus', html: '<section class="screen"><h1>' + (found ? 'Mes cibles' : 'Créer mon profil') + '</h1>' +
      '<p class="muted">Valeurs saisies à la main : l’appli ne calcule aucune cible.</p>' +
      field('Prénom', '<input id="p-name" value="' + esc(p.name || '') + '" ' + (p.name ? 'readonly' : '') + ' autocomplete="off">') +
      field('kcal cibles par jour', '<input id="p-kcal" type="number" inputmode="numeric" value="' + esc(p.kcal || '') + '">') +
      field('Protéines cibles par jour (g)', '<input id="p-prot" type="number" inputmode="numeric" value="' + esc(p.prot || '') + '">') +
      field('Objectif', '<select id="p-obj">' + obj.map(function (o) { return '<option' + (o === p.objectif ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
      field('Repas par jour', '<input id="p-repas" type="number" inputmode="numeric" min="1" max="8" value="' + esc(p.repas || 3) + '">') +
      field('Marge sur les protéines', '<select id="p-marge"><option value="10"' + (C.num(p.marge) !== 5 ? ' selected' : '') + '>10 %</option><option value="5"' + (C.num(p.marge) === 5 ? ' selected' : '') + '>5 %</option></select>') +
      '<button class="btn primary big" id="p-save">Enregistrer</button></section>',
      bind: function () {
        $('#p-save').onclick = function () {
          var np = { name: $('#p-name').value.trim(), kcal: C.num($('#p-kcal').value), prot: C.num($('#p-prot').value),
            objectif: $('#p-obj').value, repas: C.num($('#p-repas').value) || 3, marge: C.num($('#p-marge').value) };
          if (!np.name || !np.kcal || !np.prot) { toast('Prénom, kcal et protéines sont obligatoires.'); return; }
          act('enregistrement du profil', async function () {
            await Api.call('saveProfile', { token: S.token, profile: np });
            S.profile = np.name; Store.set('profile', np.name);
            await refreshStrict(); toast('Profil enregistré'); go('#/recettes');
          });
        };
      } };
  });

  function field(label, input, hint) {
    return '<label class="field"><span>' + label + '</span>' + input + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }

  /* ================= Recettes ================= */
  route(/^#\/recettes$/, function () {
    var q = Store.get('search', '');
    var list = (S.data.recipes || []).slice().sort(function (a, b) {
      return (b.favori === 'Oui') - (a.favori === 'Oui') || a.name.localeCompare(b.name, 'fr');
    });
    return { tab: 'recettes', html: '<section class="screen"><div class="row between"><h1>Recettes</h1>' +
      (isAdmin() ? '<a class="btn small" href="#/nouvelle-recette">+ Recette</a>' : '') + '</div>' +
      '<p class="muted">Profil : <a href="' + (isAdminAccount() ? '#/profils' : '#/profil-edit/' + enc(S.profile)) + '">' + esc(S.profile) + '</a> · ' + fmt(perMeal().kcal) + ' kcal par repas</p>' +
      '<input id="r-search" class="search" type="search" placeholder="Rechercher une recette" value="' + esc(q) + '" aria-label="Rechercher">' +
      '<div id="r-list" class="stack">' + list.map(cardRecipe).join('') + '</div></section>',
      bind: function (el) {
        var inp = $('#r-search', el);
        var apply = function () {
          var v = C.norm(inp.value); Store.set('search', inp.value);
          $$('.card[data-name]', el).forEach(function (c) { c.hidden = v && C.norm(c.getAttribute('data-name')).indexOf(v) < 0; });
        };
        inp.oninput = apply; apply();
      } };
  });

  function cardRecipe(r) {
    var t = C.recipeTotals(r, S.idx).portion;
    var warn = t.missing.length ? '<span class="badge warn">Ingrédient introuvable</span>' :
      (t.missingPrice.length ? '<span class="badge warn">Prix manquant</span>' : '');
    return '<a class="card" href="#/recette/' + enc(r.name) + '" data-name="' + esc(r.name) + '">' +
      '<div class="card-title">' + (r.favori === 'Oui' ? '★ ' : '') + esc(r.name) + '</div>' +
      '<div class="macros-inline"><b>' + fmt(t.kcal) + '</b> kcal · <b>' + fmt(t.p, 1) + '</b> g prot. · <b>' +
      (t.missingPrice.length ? '?' : euro(t.cost)) + '</b> / portion</div>' +
      '<div class="muted small">' + esc([r.categorie, r.objectif, (r.portions || 1) + ' portion(s)'].filter(Boolean).join(' · ')) + '</div>' + warn + '</a>';
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

  route(/^#\/recette\/(.+)$/, function (name) {
    var r = recipeByName(name);
    if (!r) return { html: '<section class="screen"><p>Recette introuvable.</p><a href="#/recettes" class="btn">Retour</a></section>' };
    var base = C.recipeTotals(r, S.idx);
    var kcal = chosenKcal(r);
    var a = adjusted(r, kcal);
    var pm = perMeal();
    var protBadge = a.protStatus === 'ok' ? '<span class="badge ok">Protéines dans la marge</span>' :
      a.protStatus === 'hors' ? '<span class="badge warn">Protéines hors marge</span>' : '';
    var needAlt = a.status === 'low' || a.status === 'high' || a.status === 'impossible';
    var alts = needAlt && a.status !== 'error' ? C.alternatives(r, S.idx, { kcal: kcal, margin: pm.margin }) : [];
    var html = '<section class="screen"><a class="back" href="#/recettes">‹ Recettes</a>' +
      '<h1>' + esc(r.name) + '</h1>' +
      '<p class="muted">' + esc([r.categorie, r.objectif, (r.portions || 1) + ' portion(s) dans la fiche',
        r.prepa ? 'prépa ' + r.prepa + ' min' : '', r.cuisson ? 'cuisson ' + r.cuisson + ' min' : ''].filter(Boolean).join(' · ')) + '</p>' +
      macroTable(base.portion, 'Fiche, par portion') +
      '<div class="panel"><div class="panel-title">Mes kcal pour une portion</div>' +
      '<div class="stepper"><button class="btn step" data-k="-50" aria-label="Moins 50 kcal">−</button>' +
      '<input id="k-in" type="number" inputmode="numeric" value="' + Math.round(kcal) + '" aria-label="kcal par portion">' +
      '<button class="btn step" data-k="50" aria-label="Plus 50 kcal">+</button></div>' +
      '<div class="row wrap center"><button class="btn small ghost" id="k-fiche">Fiche (' + fmt(base.portion.kcal) + ')</button>' +
      (pm.kcal ? '<button class="btn small ghost" id="k-prof">Mon repas (' + fmt(pm.kcal) + ')</button>' : '') + '</div>' +
      (a.messages.length ? '<div class="notice ' + (a.status === 'variant' ? '' : 'warn') + '">' + a.messages.map(esc).join('<br>') +
        (a.status === 'variant' ? ' <button class="linkbtn" id="v-clear">Revenir à la recette</button>' : '') + '</div>' : '') +
      macroTable(a.totals, 'Ma portion recalculée') + protBadge +
      (pm.prot ? '<p class="muted small">Cible protéines par repas : ' + fmt(pm.prot, 0) + ' g ± ' + Math.round(pm.margin * 100) + ' %. Limite basse de cette recette : ' + fmt(a.minKcal) + ' kcal.</p>' : '') +
      '<table class="qty"><thead><tr><th>Ingrédient</th><th>Fiche</th><th>Moi</th></tr></thead><tbody>' +
      a.items.map(function (it) {
        return '<tr><td>' + esc(it.name) + '<br><span class="chip">' + esc(it.role) + (it.fixed ? ' · gardé' : ' · ajusté') + '</span></td>' +
          '<td>' + (it.qty0 ? g(it.qty0) : '—') + '</td><td><b>' + g(it.qty) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (alts.length ? '<div class="panel"><div class="panel-title">Alternatives (mêmes protéines et kcal, ± ' + Math.round(pm.margin * 100) + ' %)</div>' +
        alts.map(function (x, i) { return altCard(x, i); }).join('') + '</div>' :
        (needAlt && a.status !== 'error' ? '<div class="notice">Aucune alternative trouvée dans tes ingrédients. Ajoute des ingrédients (ex. une protéine plus maigre) ou change les kcal.</div>' : '')) +
      '<div class="actions"><a class="btn primary big" href="#/cuisine/' + enc(r.name) + '">Cuisiner</a>' +
      '<button class="btn big" id="to-week">Ajouter à ma semaine</button>' +
      (isAdmin() ? '<a class="btn ghost big" href="#/modifier-recette/' + enc(r.name) + '">Modifier les quantités</a>' : '') + '</div>' +
      (r.notes ? '<p class="muted">Notes : ' + esc(r.notes) + '</p>' : '') + '</section>';
    return { tab: 'recettes', html: html, bind: function (el) {
      var inp = $('#k-in', el);
      var setK = function (k) { k = Math.max(50, Math.round(k)); setChosenKcal(r, k); render(); };
      $$('[data-k]', el).forEach(function (b) { b.onclick = function () { setK((C.num(inp.value) || kcal) + Number(b.getAttribute('data-k'))); }; });
      inp.onchange = function () { setK(C.num(inp.value) || kcal); };
      $('#k-fiche', el).onclick = function () { setK(base.portion.kcal); };
      var kp = $('#k-prof', el); if (kp) kp.onclick = function () { setK(pm.kcal); };
      var vc = $('#v-clear', el); if (vc) vc.onclick = function () { var v = Store.get(pk('variant'), {}); delete v[r.name]; Store.set(pk('variant'), v); render(); };
      $$('[data-alt]', el).forEach(function (b) {
        b.onclick = function () {
          var x = alts[Number(b.getAttribute('data-alt'))];
          var v = Store.get(pk('variant'), {});
          v[r.name] = { kcal: kcal, label: altLabel(x), items: x.items.map(function (it) { return { name: it.name, qty: it.qty, qty0: it.qty0 }; }) };
          Store.set(pk('variant'), v); toast('Version enregistrée pour ce profil'); render();
        };
      });
      $('#to-week', el).onclick = function () {
        var plan = Store.get(pk('plan'), {}); plan[r.name] = (plan[r.name] || 0) + 1; Store.set(pk('plan'), plan);
        toast('Ajouté : ' + plan[r.name] + ' repas dans la semaine');
      };
    } };
  });

  function altLabel(x) {
    return x.by ? 'remplacer ' + x.replaced + ' par ' + x.by : 'retirer ' + x.replaced;
  }
  function altCard(x, i) {
    var b = x.before, a = x.after;
    function row(l, k, d, u) { return '<tr><td>' + l + '</td><td>' + fmt(b[k], d) + u + '</td><td><b>' + fmt(a[k], d) + u + '</b></td></tr>'; }
    return '<div class="alt"><div class="alt-title">' + (x.by ? 'Remplacer <b>' + esc(x.replaced) + '</b> (' + g(x.replacedQty) + ') par <b>' + esc(x.by) + '</b> (' + g(x.byQty) + ')'
      : 'Retirer <b>' + esc(x.replaced) + '</b> (' + g(x.replacedQty) + ')') + '</div>' +
      '<table class="qty"><thead><tr><th></th><th>Avant</th><th>Après</th></tr></thead><tbody>' +
      '<tr class="removed"><td><s>' + esc(x.replaced) + '</s></td><td>' + g(x.replacedQty) + '</td><td><b>—</b></td></tr>' +
      x.items.map(function (it) {
        return '<tr><td>' + esc(it.name) + '</td><td>' + (it.isNew ? '—' : g(it.qty0)) + '</td><td><b>' + g(it.qty) + '</b></td></tr>';
      }).join('') +
      row('kcal', 'kcal', 0, '') + row('Protéines', 'p', 1, ' g') + row('Glucides', 'g', 1, ' g') + row('Lipides', 'l', 1, ' g') +
      '</tbody></table><button class="btn" data-alt="' + i + '">Utiliser cette version</button></div>';
  }

  /* ================= Cuisine : pesée, étapes, minuteur ================= */
  route(/^#\/cuisine\/(.+)$/, function (name) {
    var r = recipeByName(name);
    if (!r) return { html: '<section class="screen"><p>Recette introuvable.</p></section>' };
    var kcal = chosenKcal(r);
    var a = adjusted(r, kcal);
    var ck = Store.get('cook.' + r.name, { portions: C.num(r.portions) || 1, cooked: {} });
    var plan = C.cookPlan(a, ck.portions, ck.cooked);
    var raws = plan.filter(function (x) { return x.isRaw; });
    var html = '<section class="screen kitchen"><a class="back" href="#/recette/' + enc(r.name) + '">‹ ' + esc(r.name) + '</a>' +
      '<h1>Cuisiner</h1>' +
      '<div class="panel"><div class="panel-title">Nombre de portions</div><div class="stepper">' +
      '<button class="btn step" data-n="-1" aria-label="Une portion de moins">−</button><output id="n-out" class="big-num">' + ck.portions + '</output>' +
      '<button class="btn step" data-n="1" aria-label="Une portion de plus">+</button></div>' +
      '<p class="muted center">' + fmt(a.totals.kcal) + ' kcal · ' + fmt(a.totals.p, 1) + ' g de protéines par portion</p></div>' +
      '<div class="panel"><div class="panel-title">1. À peser</div><ul class="weigh">' +
      plan.map(function (x) { return '<li><span>' + esc(x.name) + '</span><b>' + g(x.raw) + '</b></li>'; }).join('') + '</ul></div>' +
      '<div class="panel"><div class="panel-title">2. Étapes</div>' +
      '<label class="toggle"><input type="checkbox" id="wake"' + (S.wakeLock ? ' checked' : '') + '> Garder l’écran allumé</label>' +
      (r.steps && r.steps.length ? '<ol class="steps">' + r.steps.map(function (s, i) {
        return '<li><p>' + esc(s.text) + '</p>' + (C.num(s.timer) ? timerHtml(r.name + '#' + i, C.num(s.timer)) : '') + '</li>';
      }).join('') + '</ol>' : '<p class="muted">Aucune étape dans l’onglet Étapes.</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">3. Après cuisson : répartir</div>' +
      (raws.length ? '<p class="muted">Pèse chaque préparation cuite (le poids change à chaque cuisson). Les macros restent calculées sur le cru.</p>' +
        raws.map(function (x, i) {
          return '<div class="cooked"><label class="field"><span>' + esc(x.name) + ' : poids cuit total (g)</span>' +
            '<input type="number" inputmode="numeric" data-cooked="' + i + '" value="' + esc(x.cooked || '') + '" placeholder="ex. ' + Math.round(x.raw * 0.75) + '"></label>' +
            (x.perPortionCooked ? '<div class="result">' + fmt(x.raw) + ' g cru → ' + fmt(x.cooked) + ' g cuit<br><b class="huge">' + g(x.perPortionCooked) + '</b> par assiette</div>' : '') + '</div>';
        }).join('') : '<p class="muted">Aucun ingrédient pesé cru dans cette recette : répartis en ' + ck.portions + ' parts égales.</p>') +
      macroTable(a.totals, 'Chaque assiette') + '</div></section>';
    return { tab: 'recettes', html: html, bind: function (el) {
      $$('[data-n]', el).forEach(function (b) {
        b.onclick = function () { ck.portions = Math.max(1, ck.portions + Number(b.getAttribute('data-n'))); ck.cooked = {}; Store.set('cook.' + r.name, ck); render(); };
      });
      $$('[data-cooked]', el).forEach(function (inp) {
        inp.onchange = function () { ck.cooked[raws[Number(inp.getAttribute('data-cooked'))].name] = C.num(inp.value); Store.set('cook.' + r.name, ck); render(); };
      });
      $('#wake', el).onchange = function (e) { toggleWake(e.target.checked); };
      bindTimers(el);
    } };
  });

  function timerHtml(id, min) {
    var t = S.timers[id];
    var left = t ? remaining(t) : min * 60;
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
        if (t.running) { t.left = remaining(t); t.running = false; }
        else { t.endAt = Date.now() + t.left * 1000; t.running = true; }
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
        var t = S.timers[id];
        if (!t.running) return;
        any = true;
        var left = remaining(t);
        var box = document.querySelector('[data-timer="' + CSS.escape(id) + '"]');
        if (box) $('.clock', box).textContent = clock(left);
        if (left <= 0) {
          t.running = false; t.left = 0; t.done = true; ring(id);
          if (box) refreshTimer(box, id, Number(box.getAttribute('data-min')));
        }
      });
      if (!any) { clearInterval(S.tick); S.tick = null; }
    }, 250);
  }
  function stopAllTimersIfLeaving() { /* les minuteurs continuent même si on change d'écran */ }

  var audio = null;
  function unlockAudio() {
    try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
  }
  function ring(id) {
    stopRing();
    document.body.classList.add('flash');
    toast('Minuteur terminé ! Touche l’écran pour arrêter la sonnerie.');
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
    var n = 0;
    S.ringer = setInterval(function () {
      beep(); n++;
      if (n >= 10) stopRing();
    }, 900);
    beep();
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
        S.wakeLock.addEventListener('release', function () { if (S.wakeWanted && document.visibilityState === 'visible') toggleWake(true); });
        S.wakeWanted = true; toast('L’écran restera allumé');
      } else { S.wakeWanted = false; if (S.wakeLock) await S.wakeLock.release(); S.wakeLock = null; }
    } catch (e) { toast('Impossible de garder l’écran allumé : ' + e.message); }
  }
  document.addEventListener('visibilitychange', function () {
    if (S.wakeWanted && document.visibilityState === 'visible') toggleWake(true);
  });

  /* ================= Semaine ================= */
  route(/^#\/semaine$/, function () {
    var plan = Store.get(pk('plan'), {});
    var recipes = S.data.recipes || [];
    var total = Object.keys(plan).reduce(function (s, k) { return s + (plan[k] || 0); }, 0);
    var speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return { tab: 'semaine', html: '<section class="screen"><h1>Ma semaine</h1>' +
      '<div class="panel"><div class="panel-title">Dicter ou écrire</div>' +
      '<textarea id="w-text" rows="3" placeholder="ex. trois soirs poulet riz, deux soirs tacos, sept midis cabillaud">' + esc(Store.get(pk('planText'), '')) + '</textarea>' +
      '<div class="row wrap">' + (speech ? '<button class="btn" id="w-mic">🎤 Dicter</button>' : '') +
      '<button class="btn primary" id="w-parse">Remplir le planning</button></div><div id="w-unknown"></div></div>' +
      '<div class="panel"><div class="panel-title">Ou cocher les recettes (nombre de repas)</div>' +
      recipes.map(function (r) {
        var n = plan[r.name] || 0;
        return '<div class="plan-row' + (n ? ' on' : '') + '"><a href="#/recette/' + enc(r.name) + '">' + esc(r.name) +
          '<span class="muted small">' + fmt(chosenKcal(r)) + ' kcal / repas</span></a>' +
          '<div class="stepper small"><button class="btn step" data-m="-1" data-r="' + esc(r.name) + '" aria-label="Un repas de moins">−</button>' +
          '<output>' + n + '</output><button class="btn step" data-m="1" data-r="' + esc(r.name) + '" aria-label="Un repas de plus">+</button></div></div>';
      }).join('') + '</div>' +
      '<p class="center"><b>' + total + '</b> repas prévus</p>' +
      '<div class="actions"><button class="btn primary big" id="w-list"' + (total ? '' : ' disabled') + '>Calculer ma liste de courses</button>' +
      (total ? '<button class="btn ghost" id="w-clear">Vider la semaine</button>' : '') + '</div></section>',
      bind: function (el) {
        $$('[data-m]', el).forEach(function (b) {
          b.onclick = function () {
            var p = Store.get(pk('plan'), {}), n = b.getAttribute('data-r');
            p[n] = Math.max(0, Math.min(42, (p[n] || 0) + Number(b.getAttribute('data-m'))));
            if (!p[n]) delete p[n]; Store.set(pk('plan'), p); render();
          };
        });
        $('#w-parse', el).onclick = function () {
          var txt = $('#w-text', el).value; Store.set(pk('planText'), txt);
          var res = C.parsePlan(txt, recipes);
          if (!res.items.length) { $('#w-unknown', el).innerHTML = '<div class="notice warn">Je n’ai reconnu aucune recette. Écris par exemple « 3 soirs poulet riz ».</div>'; return; }
          var p = {}; res.items.forEach(function (it) { p[it.recipe] = it.meals; });
          Store.set(pk('plan'), p); render();
          if (res.unknown.length) toast('Non reconnu : ' + res.unknown.join(' / '));
          else toast('Planning rempli : vérifie et corrige si besoin');
        };
        var mic = $('#w-mic', el);
        if (mic) mic.onclick = function () { dictate($('#w-text', el), mic); };
        var cl = $('#w-clear', el); if (cl) cl.onclick = function () { Store.set(pk('plan'), {}); render(); };
        var wl = $('#w-list', el); if (wl) wl.onclick = function () { computeList(); go('#/courses'); };
      } };
  });

  function dictate(ta, btn) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Utilise le micro du clavier pour dicter.'); return; }
    if (!navigator.onLine) { toast('La dictée demande du réseau. Utilise le micro du clavier.'); }
    var rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false;
    btn.textContent = '… j’écoute'; btn.disabled = true;
    rec.onresult = function (e) { ta.value = (ta.value ? ta.value + ', ' : '') + e.results[0][0].transcript; };
    rec.onerror = function (e) { toast('Dictée impossible (' + e.error + '). Utilise le micro du clavier.'); };
    rec.onend = function () { btn.textContent = '🎤 Dicter'; btn.disabled = false; };
    try { rec.start(); } catch (e) { rec.onend(); }
  }

  /* ================= Courses ================= */
  function stockMap() {
    var m = {};
    (S.data.stock || []).forEach(function (s) { m[s.ing] = (m[s.ing] || 0) + (C.num(s.qty) || 0); });
    return m;
  }
  function computeList() {
    var plan = Store.get(pk('plan'), {}), pm = perMeal();
    var items = Object.keys(plan).map(function (n) { return { recipe: n, meals: plan[n], kcal: chosenKcal(recipeByName(n) || { name: n, lines: [] }) }; })
      .filter(function (x) { return recipeByName(x.recipe); });
    var useStock = Store.get(pk('useStock'), true);
    // Les versions modifiées (alternatives) sont prises en compte.
    var recipes = (S.data.recipes || []).map(function (r) {
      var k = chosenKcal(r), v = variantOf(r, k);
      if (!v) return r;
      var portions = C.num(r.portions) || 1;
      return Object.assign({}, r, { lines: v.items.map(function (it) { return { ing: it.name, qty: it.qty * portions }; }) });
    });
    var varNames = {}; recipes.forEach(function (r) { if (variantOf(r, chosenKcal(r))) varNames[r.name] = 1; });
    // Pour une version modifiée, les quantités sont déjà ajustées : on ne recalcule pas (kcal null).
    items = items.map(function (x) { return varNames[x.recipe] ? Object.assign({}, x, { kcal: null }) : x; });
    var res = C.shoppingList(items, recipes, S.idx, { protRef: pm.prot, margin: pm.margin, stock: stockMap(), useStock: useStock });
    var old = Store.get(pk('list'), null);
    res.checked = old && old.checked ? old.checked : {};
    res.computedAt = new Date().toISOString();
    res.dataAt = S.data.fetchedAt;
    res.meals = items.reduce(function (s, x) { return s + x.meals; }, 0);
    Store.set(pk('list'), res);
    return res;
  }

  route(/^#\/courses$/, function () {
    var L = Store.get(pk('list'), null);
    if (!L) return { tab: 'courses', html: '<section class="screen"><h1>Courses</h1><p>Aucune liste calculée.</p><a class="btn primary big" href="#/semaine">Choisir ma semaine</a></section>' };
    var useStock = Store.get(pk('useStock'), true);
    var groups = {};
    L.lines.forEach(function (l) { (groups[l.rayon] = groups[l.rayon] || []).push(l); });
    var left = L.lines.filter(function (l) { return l.buy > 0 && !L.checked[l.name]; }).length;
    var html = '<section class="screen"><h1>Courses</h1>' +
      '<p class="muted">' + L.meals + ' repas · calculée le ' + dateFr(L.computedAt) + '</p>' +
      '<label class="toggle"><input type="checkbox" id="l-stock"' + (useStock ? ' checked' : '') + '> Retrancher mon stock cuisine</label>' +
      (L.warnings.length ? '<div class="notice warn">' + L.warnings.map(esc).join('<br>') + '</div>' : '') +
      C.RAYONS.filter(function (r) { return groups[r]; }).map(function (r) {
        return '<h2 class="rayon">' + esc(r.charAt(0).toUpperCase() + r.slice(1)) + '</h2><ul class="shop">' + groups[r].map(function (l) {
          var done = !!L.checked[l.name], none = l.buy <= 0;
          return '<li class="' + (done ? 'done' : '') + (none ? ' none' : '') + '"><label>' +
            '<input type="checkbox" data-c="' + esc(l.name) + '"' + (done || none ? ' checked' : '') + (none ? ' disabled' : '') + '>' +
            '<span class="s-name">' + esc(l.name) + (l.stock > 0 ? '<small>besoin ' + g(l.need) + ' − stock ' + g(l.stock) + '</small>' : '') +
            (l.magasin && l.magasin !== 'Exemple' ? '<small>' + esc(l.magasin) + '</small>' : '') + '</span>' +
            '<span class="s-qty">' + (none ? 'en stock' : g(l.buy)) + '<small>' + (none ? '' : (l.cost === null ? '<span class="warn-text">prix manquant</span>' : euro(l.cost))) + '</small></span>' +
            '</label></li>';
        }).join('') + '</ul>';
      }).join('') +
      '<div class="total"><span>Total estimé</span><b>' + euro(L.total) + '</b></div>' +
      (L.missingPrice.length ? '<p class="warn-text">+ ' + L.missingPrice.length + ' article(s) sans prix, non comptés : ' + L.missingPrice.map(esc).join(', ') + '</p>' : '') +
      '<p class="muted center">' + left + ' article(s) restant(s)</p>' +
      '<div class="actions"><button class="btn big" id="l-re">Recalculer</button><button class="btn ghost" id="l-uncheck">Tout décocher</button></div></section>';
    return { tab: 'courses', html: html, bind: function (el) {
      $$('[data-c]', el).forEach(function (cb) {
        cb.onchange = function () {
          var L2 = Store.get(pk('list'), L); L2.checked[cb.getAttribute('data-c')] = cb.checked; Store.set(pk('list'), L2);
          render();
        };
      });
      $('#l-stock', el).onchange = function (e) { Store.set(pk('useStock'), e.target.checked); computeList(); render(); };
      $('#l-re', el).onclick = function () { computeList(); render(); toast('Liste recalculée'); };
      $('#l-uncheck', el).onclick = function () { var L2 = Store.get(pk('list'), L); L2.checked = {}; Store.set(pk('list'), L2); render(); };
    } };
  });

  /* ================= Plus ================= */
  route(/^#\/plus$/, function () {
    var adm = isAdminAccount();
    return { tab: 'plus', html: '<section class="screen"><h1>Plus</h1>' +
      '<p class="muted">Connecté : <b>' + esc(S.me ? S.me.id : '') + '</b> (' + (adm ? 'admin' : 'client') + ')</p>' +
      (adm ? '<div class="panel"><div class="panel-title">Affichage</div><div class="row wrap">' +
        '<button class="btn ' + (isAdmin() ? 'primary' : '') + '" data-view="admin">Vue admin</button>' +
        '<button class="btn ' + (!isAdmin() ? 'primary' : '') + '" data-view="client">Vue client</button></div>' +
        '<p class="muted small">La vue client montre l’appli comme la voient tes proches.</p></div>' : '') +
      '<div class="stack">' +
      (adm ? '<a class="btn big" href="#/profils">Changer de profil affiché (' + esc(S.profile) + ')</a>' : '') +
      '<a class="btn big" href="#/profil-edit/' + enc(S.profile) + '">Mes cibles (kcal, protéines)</a>' +
      '<a class="btn big" href="#/stock">Stock cuisine</a>' +
      (isAdmin() ? '<a class="btn big" href="#/gestion">Gestion de la base</a><a class="btn big" href="#/comptes">Comptes utilisateurs</a>' : '') +
      '<button class="btn big" id="x-refresh">Actualiser les données</button>' +
      '<a class="btn big" href="guide.html">Mode d’emploi</a>' +
      '<a class="btn big" href="#/compte">Mon compte (mot de passe)</a>' +
      (adm ? '<a class="btn ghost big" href="#/connexion">Paramètres de connexion</a>' : '') +
      (S.lastError ? '<button class="btn ghost big" id="x-report">Copier le dernier rapport d’erreur</button>' : '') +
      '<button class="btn ghost big" id="x-logout">Se déconnecter</button>' +
      '</div><p class="muted small center">Données du ' + dateFr(S.data.fetchedAt) + ' · v' + VERSION + '</p></section>',
      bind: function (el) {
        $$('[data-view]', el).forEach(function (b) {
          b.onclick = function () { Store.set('adminView', b.getAttribute('data-view') === 'admin'); render(); toast(isAdmin() ? 'Vue admin' : 'Vue client'); };
        });
        $('#x-logout', el).onclick = function () { logout('Déconnecté'); };
        $('#x-refresh', el).onclick = function () { refresh(); };
        var xr = $('#x-report', el); if (xr) xr.onclick = function () { copyText(report(S.lastError)).then(function () { toast('Rapport copié'); }); };
      } };
  });

  /* ================= Stock ================= */
  route(/^#\/stock$/, function () {
    var st = S.data.stock || [];
    var names = S.data.ingredients.map(function (i) { return i.name; });
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Stock cuisine</h1>' +
      (st.length ? '<ul class="shop">' + st.map(function (s, i) {
        return '<li><div class="stock-row"><span class="s-name">' + esc(s.ing) + '<small>' + (s.date ? 'mis à jour le ' + esc(String(s.date).split('-').reverse().join('/')) : '') + '</small></span>' +
          (isAdmin() ? '<input type="number" inputmode="numeric" class="qty-in" data-s="' + i + '" value="' + esc(s.qty) + '" aria-label="Quantité en g">'
            : '<span class="s-qty">' + g(C.num(s.qty) || 0) + '</span>') + '</div></li>';
      }).join('') + '</ul>' : '<p>Stock vide.</p>') +
      (isAdmin() ? '<div class="panel"><div class="panel-title">Ajouter ou dire ce que j’ai</div>' +
        '<textarea id="s-text" rows="2" placeholder="ex. 500 g de riz basmati cru, 1 kg de poulet"></textarea>' +
        '<div class="row wrap">' + ((window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button class="btn" id="s-mic">🎤 Dicter</button>' : '') +
        '<button class="btn" id="s-parse">Lire</button></div>' +
        '<div class="row"><input id="s-ing" list="ing-names" placeholder="Ingrédient (nom exact)" aria-label="Ingrédient"><input id="s-qty" type="number" inputmode="numeric" placeholder="g" class="qty-in" aria-label="Quantité en g"></div>' +
        '<datalist id="ing-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
        '<button class="btn primary big" id="s-save">Enregistrer le stock dans le Sheet</button></div>'
        : '<p class="muted">Seule la personne qui gère la base peut modifier le stock.</p>') + '</section>',
      bind: function (el) {
        if (!isAdmin()) return;
        var pending = {};
        $$('[data-s]', el).forEach(function (inp) { inp.onchange = function () { pending[st[Number(inp.getAttribute('data-s'))].ing] = C.num(inp.value) || 0; }; });
        var mic = $('#s-mic', el); if (mic) mic.onclick = function () { dictate($('#s-text', el), mic); };
        $('#s-parse', el).onclick = function () {
          var res = C.parseStock($('#s-text', el).value, S.data.ingredients);
          res.items.forEach(function (it) { pending[it.ing] = it.qty; });
          toast(res.items.length ? 'Lu : ' + res.items.map(function (x) { return x.ing + ' ' + x.qty + ' g'; }).join(', ') + '. Touche Enregistrer.' : 'Rien reconnu.');
          if (res.unknown.length) toast('Non reconnu : ' + res.unknown.join(' / '));
        };
        $('#s-save', el).onclick = function () {
          var ing = $('#s-ing', el).value.trim(), q = C.num($('#s-qty', el).value);
          if (ing) {
            if (!C.find(S.idx, ing)) { toast('Ingrédient inconnu (le nom doit être exact).'); return; }
            if (q === null) { toast('Indique la quantité en g.'); return; }
            pending[ing] = q;
          }
          var items = Object.keys(pending).map(function (k) { return { ing: k, qty: pending[k] }; });
          if (!items.length) { toast('Aucun changement.'); return; }
          act('enregistrement du stock', async function () {
            await Api.call('setStock', { token: S.token, items: items });
            await refreshStrict(); toast('Stock enregistré');
          });
        };
      } };
  });

  /* ================= Mon compte ================= */
  route(/^#\/compte$/, function () {
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Mon compte</h1>' +
      '<p>Identifiant : <b>' + esc(S.me ? S.me.id : '') + '</b> · profil ' + esc(S.me ? S.me.name : '') + '</p>' +
      '<form id="a-form"><div class="panel"><div class="panel-title">Changer mon mot de passe</div>' +
      field('Mot de passe actuel', '<input id="a-old" type="password" autocomplete="current-password" required>') +
      field('Nouveau mot de passe', '<input id="a-new" type="password" autocomplete="new-password" minlength="8" required>', '8 caractères minimum') +
      field('Nouveau mot de passe (encore)', '<input id="a-new2" type="password" autocomplete="new-password" required>') +
      '<button class="btn primary big" type="submit">Changer le mot de passe</button></div></form>' +
      '<button class="btn ghost big" id="a-out">Se déconnecter</button></section>',
      bind: function () {
        $('#a-out').onclick = function () { logout('Déconnecté'); };
        $('#a-form').onsubmit = function (e) {
          e.preventDefault();
          var o = $('#a-old').value, n1 = $('#a-new').value, n2 = $('#a-new2').value;
          if (n1.length < 8) { toast('8 caractères minimum.'); return; }
          if (n1 !== n2) { toast('Les deux nouveaux mots de passe sont différents.'); return; }
          act('changement de mot de passe', async function () {
            var r = await Api.call('changePassword', { token: S.token, oldPassword: o, newPassword: n1 }, { tries: 1 });
            setSession(r.token, S.me); toast('Mot de passe changé'); go('#/plus');
          }, false);
        };
      } };
  });

  /* ================= Comptes (admin) ================= */
  route(/^#\/comptes$/, function () {
    if (!isAdmin()) { setTimeout(function () { go('#/plus'); }); return { html: '' }; }
    var names = (S.data.profiles || []).map(function (p) { return p.name; });
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Comptes utilisateurs</h1>' +
      '<div id="acc-list"><p class="muted">Chargement…</p></div>' +
      '<form id="acc-form" class="panel"><div class="panel-title">Nouveau compte</div>' +
      field('Identifiant', '<input id="n-id" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" required>', 'Lettres, chiffres, point ou tiret, sans espace ni accent (ex. marine).') +
      field('Prénom du profil', '<input id="n-pname" list="prof-names" autocomplete="off" required>', 'Doit correspondre au prénom de l’onglet Profils (ou sera créé à la 1re connexion).') +
      '<datalist id="prof-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      field('Mot de passe provisoire', '<input id="n-pw" autocomplete="new-password" minlength="8" required>', '8 caractères minimum. Donne-le à la personne : elle pourra le changer dans Mon compte.') +
      field('Rôle', '<select id="n-role"><option value="client">Client</option><option value="admin">Admin</option></select>') +
      '<button class="btn primary big" type="submit">Créer le compte</button></form></section>',
      bind: function (el) {
        var load = function () {
          act('lecture des comptes', async function () {
            var r = await Api.call('listAccounts', { token: S.token });
            var box = $('#acc-list', el); if (!box) return;
            box.innerHTML = r.accounts.length ? '<ul class="shop">' + r.accounts.map(function (a) {
              var self = S.me && a.id === S.me.id;
              return '<li><div class="acc"><div><b>' + esc(a.id) + '</b> · ' + esc(a.name) +
                ' <span class="badge ' + (a.role === 'admin' ? 'ok' : '') + '">' + (a.role === 'admin' ? 'admin' : 'client') + '</span>' +
                (a.active ? '' : ' <span class="badge warn">désactivé</span>') +
                '<small>' + (a.lastLogin ? 'Dernière connexion : ' + esc(String(a.lastLogin).slice(0, 10).split('-').reverse().join('/')) : 'Jamais connecté') + '</small></div>' +
                '<div class="row wrap"><button class="btn small" data-reset="' + esc(a.id) + '">Nouveau mot de passe</button>' +
                (self ? '' : '<button class="btn small ghost" data-active="' + esc(a.id) + '" data-v="' + (a.active ? '0' : '1') + '">' + (a.active ? 'Désactiver' : 'Réactiver') + '</button>' +
                  '<button class="btn small ghost" data-role="' + esc(a.id) + '" data-v="' + (a.role === 'admin' ? 'client' : 'admin') + '">' + (a.role === 'admin' ? 'Passer client' : 'Passer admin') + '</button>') +
                '</div></div></li>';
            }).join('') + '</ul>' : '<p>Aucun compte.</p>';
            $$('[data-reset]', box).forEach(function (b) {
              b.onclick = function () {
                var pw = prompt('Nouveau mot de passe pour « ' + b.getAttribute('data-reset') + ' » (8 caractères minimum) :');
                if (!pw) return;
                act('réinitialisation du mot de passe', async function () {
                  await Api.call('resetPassword', { token: S.token, id: b.getAttribute('data-reset'), password: pw }, { tries: 1 });
                  toast('Mot de passe changé. Donne-le à la personne.'); load();
                }, false);
              };
            });
            $$('[data-active]', box).forEach(function (b) {
              b.onclick = function () {
                act('modification du compte', async function () {
                  await Api.call('updateAccount', { token: S.token, account: { id: b.getAttribute('data-active'), active: b.getAttribute('data-v') === '1' } });
                  toast('Compte modifié'); load();
                });
              };
            });
            $$('[data-role]', box).forEach(function (b) {
              b.onclick = function () {
                act('modification du compte', async function () {
                  await Api.call('updateAccount', { token: S.token, account: { id: b.getAttribute('data-role'), role: b.getAttribute('data-v') } });
                  toast('Compte modifié'); load();
                });
              };
            });
          });
        };
        load();
        $('#acc-form', el).onsubmit = function (e) {
          e.preventDefault();
          var acc = { id: $('#n-id').value.trim().toLowerCase(), name: $('#n-pname').value.trim(), password: $('#n-pw').value, role: $('#n-role').value };
          if (!/^[a-z0-9._-]{3,30}$/.test(acc.id)) { toast('Identifiant : 3 à 30 lettres/chiffres, sans espace ni accent.'); return; }
          if (acc.password.length < 8) { toast('Mot de passe : 8 caractères minimum.'); return; }
          act('création d’un compte', async function () {
            await Api.call('createAccount', { token: S.token, account: acc }, { tries: 1 });
            toast('Compte « ' + acc.id + ' » créé'); $('#acc-form', el).reset(); load();
          }, false);
        };
      } };
  });

  /* ================= Gestion de la base (admin) ================= */
  route(/^#\/gestion$/, function () {
    if (!isAdmin()) { setTimeout(function () { go('#/plus'); }); return { html: '' }; }
    var noRoles = !S.data.hasRoleColumns;
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Gestion de la base</h1>' +
      (noRoles ? '<div class="notice warn">Les colonnes Rôle et Rayon n’existent pas encore dans l’onglet Ingrédients. Les valeurs proposées d’après les macros sont utilisées en attendant.</div>' : '') +
      '<div class="stack">' +
      '<a class="btn primary big" href="#/ingredient/photo">📷 Nouvel ingrédient par photo</a>' +
      '<a class="btn big" href="#/ingredient/nouveau">Nouvel ingrédient à la main</a>' +
      '<a class="btn big" href="#/nouvelle-recette">Nouvelle recette</a>' +
      '<a class="btn big" href="#/ingredients">Ingrédients : prix, rôle, rayon</a>' +
      '<button class="btn big" id="g-setup">' + (noRoles ? 'Ajouter Rôle et Rayon au Sheet' : 'Compléter Rôle et Rayon vides') + '</button>' +
      '<a class="btn big" href="#/comptes">Comptes utilisateurs</a></div></section>',
      bind: function () {
        $('#g-setup').onclick = function () {
          act('ajout des colonnes Rôle et Rayon', async function () {
            var r = await Api.call('setup', { token: S.token }); await refreshStrict(); toast(r.message || 'Fait');
          });
        };      } };
  });

  route(/^#\/ingredients$/, function () {
    if (!isAdmin()) { setTimeout(function () { go('#/gestion'); }); return { html: '' }; }
    var list = S.data.ingredients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/gestion">‹ Gestion</a><h1>Ingrédients</h1>' +
      '<input id="i-search" class="search" type="search" placeholder="Rechercher" aria-label="Rechercher">' +
      '<div class="stack">' + list.map(function (i) {
        return '<a class="card" data-name="' + esc(i.name) + '" href="#/ingredient/' + enc(i.name) + '"><div class="card-title">' + esc(i.name) + '</div>' +
          '<div class="macros-inline">' + fmt(i.kcal) + ' kcal · P ' + fmt(i.p, 1) + ' · G ' + fmt(i.g, 1) + ' · L ' + fmt(i.l, 1) + ' /100 g</div>' +
          '<div class="small">' + (C.num(i.prix) === null ? '<span class="badge warn">Prix manquant</span>' : euro(i.prix) + ' /kg') +
          ' · ' + esc(C.roleOf(i)) + (i.role ? '' : ' (proposé)') + ' · ' + esc(C.rayonOf(i)) + '</div></a>';
      }).join('') + '</div></section>',
      bind: function (el) {
        var inp = $('#i-search', el);
        inp.oninput = function () { var v = C.norm(inp.value); $$('.card', el).forEach(function (c) { c.hidden = v && C.norm(c.getAttribute('data-name')).indexOf(v) < 0; }); };
      } };
  });

  /* ---------- Formulaire ingrédient (création / photo / modification) ---------- */
  route(/^#\/ingredient\/(.+)$/, function (key) {
    if (!isAdmin()) { setTimeout(function () { go('#/gestion'); }); return { html: '' }; }
    var editing = key !== 'nouveau' && key !== 'photo' ? C.find(S.idx, key) : null;
    var draft = Store.get('ingDraft', null);
    var v = editing ? Object.assign({}, editing) : (draft || { etat: 'Cru', source: '' });
    var roleSel = function (cur) { return C.ROLES.map(function (r) { return '<option' + (r === cur ? ' selected' : '') + '>' + r + '</option>'; }).join(''); };
    var raySel = function (cur) { return C.RAYONS.map(function (r) { return '<option' + (r === cur ? ' selected' : '') + '>' + r + '</option>'; }).join(''); };
    var role = v.role || C.suggestRole(v), rayon = v.rayon || C.suggestRayon(role);
    var recipes = S.data.recipes || [];
    var html = '<section class="screen"><a class="back" href="#/gestion">‹ Gestion</a>' +
      '<h1>' + (editing ? 'Modifier un ingrédient' : 'Nouvel ingrédient') + '</h1>' +
      (editing ? '' : '<div class="panel"><div class="panel-title">Photo du tableau nutritionnel</div>' +
        '<p class="muted small">La photo est lue par Google (gratuit) puis supprimée. Rien n’est enregistré sans ta validation.</p>' +
        '<label class="btn primary big file"><input type="file" accept="image/*" capture="environment" id="f-photo">📷 Prendre la photo</label>' +
        '<div id="ocr-out"></div></div>') +
      '<div id="dup"></div>' +
      field('Nom (avec cru/cuit)', '<input id="f-name" value="' + esc(v.name || '') + '"' + (editing ? ' readonly' : '') + ' autocomplete="off">',
        editing ? 'Le nom ne se change pas ici (il est utilisé dans les recettes).' : 'Ex. « Riz basmati cru ». Doit être identique partout.') +
      field('État', '<select id="f-etat">' + ['Cru', 'Cuit', 'Autre'].map(function (e) { return '<option' + (e === v.etat ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select>') +
      '<div class="grid2">' +
      field('kcal / 100 g', numIn('f-kcal', v.kcal)) + field('Protéines / 100 g', numIn('f-p', v.p)) +
      field('Glucides / 100 g', numIn('f-g', v.g)) + field('Lipides / 100 g', numIn('f-l', v.l)) +
      field('Fibres / 100 g', numIn('f-f', v.f)) + field('Prix au kg (€)', numIn('f-prix', v.prix), 'Vide = « prix manquant »') + '</div>' +
      '<label class="btn ghost file"><input type="file" accept="image/*" capture="environment" id="f-pricephoto">📷 Lire le prix en rayon</label><div id="price-out"></div>' +
      field('Magasin', '<input id="f-mag" value="' + esc(v.magasin || '') + '">') +
      field('Source macros', '<input id="f-src" value="' + esc(v.source || '') + '">') +
      field('Remarque', '<input id="f-rem" value="' + esc(v.remarque || '') + '">') +
      '<div class="grid2">' + field('Rôle', '<select id="f-role">' + roleSel(role) + '</select>', v.role ? '' : 'Proposé d’après les macros') +
      field('Rayon', '<select id="f-rayon">' + raySel(rayon) + '</select>') + '</div>' +
      (editing ? '' : '<div class="panel"><div class="panel-title">Utilisé dans une recette (facultatif)</div>' +
        field('Recette', '<select id="f-rec"><option value="">— aucune —</option>' + recipes.map(function (r) { return '<option>' + esc(r.name) + '</option>'; }).join('') + '</select>') +
        field('Quantité dans la recette (g)', numIn('f-recqty', '')) + '</div>') +
      '<button class="btn primary big" id="f-save">Valider et enregistrer dans le Sheet</button></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var read = function () {
        return { name: $('#f-name').value.trim(), etat: $('#f-etat').value, kcal: C.num($('#f-kcal').value), p: C.num($('#f-p').value),
          g: C.num($('#f-g').value), l: C.num($('#f-l').value), f: C.num($('#f-f').value), prix: C.num($('#f-prix').value),
          magasin: $('#f-mag').value.trim(), source: $('#f-src').value.trim(), remarque: $('#f-rem').value.trim(),
          role: $('#f-role').value, rayon: $('#f-rayon').value };
      };
      var checkDup = function () {
        if (editing) return;
        var n = $('#f-name').value.trim(), ex = n && C.findLoose(S.idx, n);
        $('#dup').innerHTML = ex ? '<div class="notice warn">Cet ingrédient existe déjà : <b>' + esc(ex.name) + '</b>. <a href="#/ingredient/' + enc(ex.name) + '">Le modifier</a> au lieu d’en créer un doublon.</div>' : '';
      };
      $('#f-name').oninput = checkDup; checkDup();
      $$('input,select', el).forEach(function (i) { if (!editing) i.addEventListener('change', function () { Store.set('ingDraft', read()); }); });
      ['#f-kcal', '#f-p', '#f-g', '#f-l'].forEach(function (s) {
        $(s).addEventListener('change', function () {
          if (v.role) return;
          var r = C.suggestRole(read()); $('#f-role').value = r; $('#f-rayon').value = C.suggestRayon(r);
        });
      });
      var photo = $('#f-photo', el);
      if (photo) photo.onchange = function () { ocrFlow(photo.files[0], 'nutrition'); photo.value = ''; };
      var pp = $('#f-pricephoto', el);
      pp.onchange = function () { ocrFlow(pp.files[0], 'prix'); pp.value = ''; };
      $('#f-save').onclick = function () {
        var ing = read();
        if (!ing.name) { toast('Le nom est obligatoire.'); return; }
        if ([ing.kcal, ing.p, ing.g, ing.l].some(function (x) { return x === null; })) { toast('kcal, protéines, glucides et lipides sont obligatoires.'); return; }
        var kcalCalc = 4 * ing.p + 4 * ing.g + 9 * ing.l;
        if (ing.kcal > 0 && Math.abs(kcalCalc - ing.kcal) / ing.kcal > 0.2 && kcalCalc > 20 &&
          !confirm('Attention : 4×P + 4×G + 9×L = ' + Math.round(kcalCalc) + ' kcal, loin des ' + ing.kcal + ' kcal saisies. Une virgule mal lue ? Enregistrer quand même ?')) return;
        var recName = $('#f-rec') ? $('#f-rec').value : '', recQty = $('#f-recqty') ? C.num($('#f-recqty').value) : null;
        if (recName && !recQty) { toast('Indique la quantité utilisée dans la recette.'); return; }
        act(editing ? 'modification d’un ingrédient' : 'ajout d’un ingrédient', async function () {
          if (editing) await Api.call('updateIngredient', { token: S.token, row: editing.row, name: editing.name, ingredient: ing });
          else {
            await Api.call('addIngredient', { token: S.token, ingredient: ing });
            if (recName) await Api.call('addLine', { token: S.token, recipe: recName, line: { ing: ing.name, qty: recQty } });
            Store.del('ingDraft');
          }
          await refreshStrict(); toast('Enregistré dans le Sheet'); go(editing ? '#/ingredients' : '#/gestion');
        });
      };

      function ocrFlow(file, kind) {
        if (!file) return;
        if (!navigator.onLine) { showError(Api.ApiError('La lecture de photo demande du réseau. Saisis les valeurs à la main ou réessaie plus tard.', 'HORS_LIGNE')); return; }
        var out = $(kind === 'prix' ? '#price-out' : '#ocr-out');
        out.innerHTML = '<p class="muted">Lecture de la photo…</p>';
        act('lecture d’une photo d’étiquette', async function () {
          var img = await shrink(file);
          var r = await Api.call('ocr', { token: S.token, image: img.b64, mime: 'image/jpeg', kind: kind });
          if (kind === 'prix') {
            var pr = C.parsePrice(r.text);
            out.innerHTML = '<div class="notice' + (pr.prixKg === null ? ' warn' : '') + '">' + esc(pr.how) + (pr.prixKg !== null ? ' : <b>' + euro(pr.prixKg) + '/kg</b>. Vérifie la case Prix.' : '. Saisis-le à la main.') + '</div>';
            if (pr.prixKg !== null) { $('#f-prix').value = pr.prixKg; $('#f-prix').classList.add('read'); }
          } else {
            var n = C.parseNutrition(r.text);
            var setv = function (id, val) { if (val !== null && val !== undefined && val !== '') { $(id).value = typeof val === 'number' ? String(val).replace('.', ',') : val; $(id).classList.add('read'); } };
            if (n.name && !$('#f-name').value) setv('#f-name', n.name);
            setv('#f-kcal', n.kcal); setv('#f-p', n.p); setv('#f-g', n.g); setv('#f-l', n.l); setv('#f-f', n.f);
            if (!$('#f-src').value) $('#f-src').value = 'Étiquette (photo)';
            var miss = ['kcal', 'p', 'g', 'l', 'f'].filter(function (k) { return n[k] === null; })
              .map(function (k) { return { kcal: 'kcal', p: 'protéines', g: 'glucides', l: 'lipides', f: 'fibres' }[k]; });
            out.innerHTML = '<div class="notice">Valeurs lues pour 100 g (surlignées) : <b>vérifie chaque chiffre</b>, surtout les virgules.' +
              (miss.length ? '<br><span class="warn-text">Non trouvé : ' + miss.join(', ') + '.</span>' : '') +
              '<details><summary>Texte lu sur la photo</summary><pre>' + esc(r.text) + '</pre></details></div>';
            var rr = C.suggestRole(read()); $('#f-role').value = rr; $('#f-rayon').value = C.suggestRayon(rr);
            checkDup(); Store.set('ingDraft', read());
          }
        });
      }
    } };
  });

  function numIn(id, val) {
    return '<input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(val === null || val === undefined ? '' : String(val).replace('.', ',')) + '">';
  }

  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ b64: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = function () { reject(Api.ApiError('Photo illisible. Réessaie.', 'PHOTO')); };
      img.src = url;
    });
  }

  /* ---------- Nouvelle recette ---------- */
  route(/^#\/nouvelle-recette$/, function () {
    if (!isAdmin()) { setTimeout(function () { go('#/gestion'); }); return { html: '' }; }
    var d = Store.get('recDraft', null) || { name: '', portions: 1, categorie: '', objectif: 'Maintien', prepa: '', cuisson: '', notes: '', lines: [{ ing: '', qty: '' }], steps: [{ text: '', timer: '' }] };
    var names = S.data.ingredients.map(function (i) { return i.name; });
    var html = '<section class="screen"><a class="back" href="#/gestion">‹ Gestion</a><h1>Nouvelle recette</h1>' +
      field('Nom de la recette', '<input id="n-name" value="' + esc(d.name) + '">') +
      '<div class="grid2">' + field('Portions', '<input id="n-portions" type="number" inputmode="numeric" value="' + esc(d.portions) + '">') +
      field('Catégorie', '<input id="n-cat" value="' + esc(d.categorie) + '" placeholder="Déjeuner, Dîner…">') +
      field('Objectif', '<select id="n-obj">' + ['Sèche', 'Maintien', 'Masse'].map(function (o) { return '<option' + (o === d.objectif ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
      field('Prépa (min)', '<input id="n-prepa" type="number" inputmode="numeric" value="' + esc(d.prepa) + '">') +
      field('Cuisson (min)', '<input id="n-cuisson" type="number" inputmode="numeric" value="' + esc(d.cuisson) + '">') + '</div>' +
      '<div class="panel"><div class="panel-title">Ingrédients (quantités pour toute la recette)</div>' +
      d.lines.map(function (l, i) {
        return '<div class="line-row"><input list="ing-names" data-li="' + i + '" placeholder="Ingrédient (nom exact)" value="' + esc(l.ing) + '" aria-label="Ingrédient">' +
          '<input type="number" inputmode="numeric" class="qty-in" data-lq="' + i + '" placeholder="g" value="' + esc(l.qty) + '" aria-label="Quantité en g">' +
          '<button class="btn ghost step" data-ldel="' + i + '" aria-label="Retirer">✕</button></div>';
      }).join('') +
      '<datalist id="ing-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<button class="btn" id="n-addline">+ Ingrédient</button> <a class="btn ghost" href="#/ingredient/photo">Créer un ingrédient</a></div>' +
      '<div class="panel"><div class="panel-title">Étapes</div>' +
      d.steps.map(function (s, i) {
        return '<div class="line-row"><textarea rows="2" data-si="' + i + '" placeholder="Étape ' + (i + 1) + '" aria-label="Étape ' + (i + 1) + '">' + esc(s.text) + '</textarea>' +
          '<input type="number" inputmode="numeric" class="qty-in" data-st="' + i + '" placeholder="min" value="' + esc(s.timer) + '" aria-label="Minuteur en minutes"></div>';
      }).join('') + '<button class="btn" id="n-addstep">+ Étape</button></div>' +
      field('Notes', '<input id="n-notes" value="' + esc(d.notes) + '">') +
      '<div id="n-preview"></div>' +
      '<button class="btn primary big" id="n-save">Enregistrer la recette dans le Sheet</button></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var read = function () {
        return { name: $('#n-name').value.trim(), portions: C.num($('#n-portions').value), categorie: $('#n-cat').value.trim(),
          objectif: $('#n-obj').value, prepa: C.num($('#n-prepa').value), cuisson: C.num($('#n-cuisson').value), notes: $('#n-notes').value.trim(),
          lines: $$('[data-li]', el).map(function (x, i) { return { ing: x.value.trim(), qty: $('[data-lq="' + i + '"]', el).value }; }),
          steps: $$('[data-si]', el).map(function (x, i) { return { text: x.value.trim(), timer: $('[data-st="' + i + '"]', el).value }; }) };
      };
      var preview = function () {
        var r = read(); Store.set('recDraft', r);
        var lines = r.lines.filter(function (l) { return l.ing; }).map(function (l) { return { ing: l.ing, qty: C.num(l.qty) || 0 }; });
        var bad = lines.filter(function (l) { return !C.find(S.idx, l.ing); });
        var t = C.recipeTotals({ lines: lines, portions: r.portions || 1 }, S.idx).portion;
        $('#n-preview').innerHTML = (bad.length ? '<div class="notice warn">Ingrédient introuvable (nom exact requis) : ' + bad.map(function (b) { return esc(b.ing); }).join(', ') + '</div>' : '') +
          (lines.length ? macroTable(t, 'Aperçu par portion') : '');
      };
      el.addEventListener('change', preview); preview();
      $('#n-addline').onclick = function () { var r = read(); r.lines.push({ ing: '', qty: '' }); Store.set('recDraft', r); render(); };
      $('#n-addstep').onclick = function () { var r = read(); r.steps.push({ text: '', timer: '' }); Store.set('recDraft', r); render(); };
      $$('[data-ldel]', el).forEach(function (b) { b.onclick = function () { var r = read(); r.lines.splice(Number(b.getAttribute('data-ldel')), 1); if (!r.lines.length) r.lines.push({ ing: '', qty: '' }); Store.set('recDraft', r); render(); }; });
      $('#n-save').onclick = function () {
        var r = read();
        r.lines = r.lines.filter(function (l) { return l.ing; }).map(function (l) { return { ing: l.ing, qty: C.num(l.qty) }; });
        r.steps = r.steps.filter(function (s) { return s.text; }).map(function (s) { return { text: s.text, timer: C.num(s.timer) }; });
        if (!r.name || !r.portions) { toast('Nom et portions obligatoires.'); return; }
        if (!r.lines.length) { toast('Ajoute au moins un ingrédient.'); return; }
        if (r.lines.some(function (l) { return !C.find(S.idx, l.ing) || !l.qty; })) { toast('Vérifie les ingrédients (nom exact) et les quantités.'); return; }
        act('ajout d’une recette', async function () {
          await Api.call('addRecipe', { token: S.token, recipe: r });
          Store.del('recDraft'); await refreshStrict(); toast('Recette enregistrée'); go('#/recette/' + enc(r.name));
        });
      };
    } };
  });

  /* ---------- Modifier les quantités d'une recette ---------- */
  route(/^#\/modifier-recette\/(.+)$/, function (name) {
    var r = recipeByName(name);
    if (!r || !isAdmin()) { setTimeout(function () { go('#/recettes'); }); return { html: '' }; }
    var names = S.data.ingredients.map(function (i) { return i.name; });
    return { tab: 'recettes', html: '<section class="screen"><a class="back" href="#/recette/' + enc(r.name) + '">‹ ' + esc(r.name) + '</a>' +
      '<h1>Modifier les quantités</h1><p class="muted">Quantités pour toute la recette (' + (r.portions || 1) + ' portion(s)).</p>' +
      r.lines.map(function (l, i) {
        return '<div class="line-row"><span class="grow">' + esc(l.ing) + '</span><input type="number" inputmode="numeric" class="qty-in" data-q="' + i + '" value="' + esc(l.qty) + '" aria-label="Quantité en g">' +
          '<button class="btn ghost step" data-del="' + i + '" aria-label="Retirer ' + esc(l.ing) + '">✕</button></div>';
      }).join('') +
      '<div class="panel"><div class="panel-title">Ajouter un ingrédient</div><div class="line-row">' +
      '<input id="m-ing" list="ing-names" placeholder="Nom exact" aria-label="Ingrédient"><input id="m-qty" type="number" inputmode="numeric" class="qty-in" placeholder="g" aria-label="Quantité"></div>' +
      '<datalist id="ing-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<button class="btn" id="m-add">Ajouter</button></div></section>',
      bind: function (el) {
        $$('[data-q]', el).forEach(function (inp) {
          inp.onchange = function () {
            var l = r.lines[Number(inp.getAttribute('data-q'))], q = C.num(inp.value);
            if (q === null) return;
            act('modification d’une quantité', async function () {
              await Api.call('updateLine', { token: S.token, row: l.row, recipe: r.name, ing: l.ing, qty: q });
              await refreshStrict(); toast('Quantité enregistrée');
            });
          };
        });
        $$('[data-del]', el).forEach(function (b) {
          b.onclick = function () {
            var l = r.lines[Number(b.getAttribute('data-del'))];
            if (!confirm('Retirer ' + l.ing + ' de la recette ?')) return;
            act('retrait d’un ingrédient de recette', async function () {
              await Api.call('deleteLine', { token: S.token, row: l.row, recipe: r.name, ing: l.ing });
              await refreshStrict(); toast('Retiré');
            });
          };
        });
        $('#m-add', el).onclick = function () {
          var ing = $('#m-ing', el).value.trim(), q = C.num($('#m-qty', el).value);
          if (!C.find(S.idx, ing) || !q) { toast('Nom exact et quantité requis.'); return; }
          act('ajout d’un ingrédient à une recette', async function () {
            await Api.call('addLine', { token: S.token, recipe: r.name, line: { ing: ing, qty: q } });
            await refreshStrict(); toast('Ajouté');
          });
        };
      } };
  });

  route(/^#\/?$/, function () { setTimeout(function () { go(profile() ? '#/recettes' : '#/profils'); }); return { html: '' }; });

  /* ================= Démarrage ================= */
  function boot() {
    // Lien partagé : …/#api=IDENTIFIANT → mémorisé puis retiré de l'adresse.
    var m = location.hash.match(/api=([\w-]+)/);
    if (m) {
      if (m[1] !== Store.get('apiUrl', '')) { Store.set('apiUrl', m[1]); setSession('', null); setData(null); }
      Store.set('demo', false); history.replaceState(null, '', location.pathname + '#/');
    }
    if (location.search.indexOf('demo=1') >= 0 && !Store.get('apiUrl', '')) Store.set('demo', true);
    Store.del('token'); // ancien code secret (v1.0), remplacé par les comptes
    if (!S.token) { setData(null); S.profile = ''; Store.del('profile'); }
    render();
    refresh(true);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  window.App = { S: S, render: render, computeList: computeList, report: report, VERSION: VERSION };
  boot();
})();
