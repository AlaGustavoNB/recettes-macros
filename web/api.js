/* Accès au serveur (Apps Script) avec nouvelles tentatives, plus un serveur
   de démonstration local (aucune donnée réelle) pour essayer l'appli. */
(function (root) {
  'use strict';

  var store = root.Store;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function ApiError(message, code, technical) {
    var e = new Error(message); e.code = code || 'ERREUR'; e.technical = technical || ''; return e;
  }

  // Serveur par défaut : l'appli installée s'y relie toute seule. Ce n'est pas un secret :
  // sans identifiant ni mot de passe, le serveur ne renvoie aucune donnée.
  var DEFAULT_API = 'AKfycbyEtejqEfaRF6cFAtgQTG1OEi0Jcx1hXFg8i3QKleYewunYO9TErd0g_Nn_o6d-5v8oAQ';

  function apiUrl() {
    var v = store.get('apiUrl', '') || DEFAULT_API;
    if (!v) return '';
    if (/^https?:\/\//.test(v)) return v;
    return 'https://script.google.com/macros/s/' + v + '/exec';
  }

  // Erreurs « logiques » renvoyées par le serveur : inutile de réessayer.
  var NO_RETRY = { MDP_FAUX: 1, BLOQUE: 1, NON_AUTORISE: 1, NON_CONNECTE: 1, DOUBLON: 1, VALEUR: 1, INTROUVABLE: 1, DECALE: 1,
    PLEIN: 1, PAS_DE_COMPTE: 1, DRIVE: 1, ACTION: 1, HORS_LIGNE: 1 };

  async function call(action, payload, opts) {
    opts = opts || {};
    if (store.get('demo', false)) return Demo.call(action, payload || {});
    var url = apiUrl();
    if (!url) throw ApiError('L’appli n’est pas encore reliée à ton Google Sheet.', 'CONFIG');
    if (!navigator.onLine) throw ApiError('Pas de connexion internet.', 'HORS_LIGNE');
    var body = Object.assign({ action: action }, payload || {});
    var tries = opts.tries || 3, last;
    for (var i = 0; i < tries; i++) {
      try {
        var res = await fetch(url, {
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

  /* ---------------- Serveur de démonstration ---------------- */
  var Demo = {
    data: function () {
      var d = store.get('demoData', null);
      if (!d || !d.accounts) { d = JSON.parse(JSON.stringify(root.DEMO_DATA)); store.set('demoData', d); }
      return d;
    },
    save: function (d) { store.set('demoData', d); },
    call: async function (action, p) {
      await sleep(150);
      var d = this.data();
      function fail(code, msg) { throw ApiError(msg, code); }
      function acc(id) { return d.accounts.filter(function (a) { return a.id === id; })[0]; }
      function pub(a) { return { id: a.id, name: a.name, role: a.role, active: a.active !== false, lastLogin: a.lastLogin || '' }; }
      function me() {
        var a = acc(String(p.token || '').replace(/^demo:/, ''));
        if (!a || a.active === false) fail('NON_CONNECTE', 'Connexion expirée : reconnecte-toi.');
        return a;
      }
      function admin() { if (me().role !== 'admin') fail('NON_AUTORISE', 'Action réservée à l’admin.'); }
      var n = Calc.norm;
      switch (action) {
        case 'login': {
          var a = acc(String(p.id || '').trim().toLowerCase());
          if (!a || a.active === false || a.password !== p.password) fail('MDP_FAUX', 'Identifiant ou mot de passe incorrect.');
          a.lastLogin = new Date().toISOString().slice(0, 10); this.save(d);
          return { ok: true, token: 'demo:' + a.id, me: { id: a.id, name: a.name, role: a.role } };
        }
        case 'data': {
          var m = me();
          var out = JSON.parse(JSON.stringify(d)); delete out.accounts;
          if (m.role !== 'admin') out.profiles = out.profiles.filter(function (x) { return x.name === m.name; });
          out.fetchedAt = new Date().toISOString(); out.me = { id: m.id, name: m.name, role: m.role };
          return Object.assign({ ok: true }, out);
        }
        case 'check': { var c = me(); return { ok: true, me: { id: c.id, name: c.name, role: c.role } }; }
        case 'changePassword': {
          var cm = me();
          if (cm.password !== p.oldPassword) fail('MDP_FAUX', 'Mot de passe actuel incorrect.');
          if (String(p.newPassword || '').length < 8) fail('VALEUR', 'Mot de passe trop court (8 caractères minimum).');
          cm.password = p.newPassword; this.save(d); return { ok: true, token: 'demo:' + cm.id };
        }
        case 'saveProfile': {
          var sm = me();
          var prof = Object.assign({}, p.profile, sm.role === 'admin' ? {} : { name: sm.name });
          var pr = d.profiles.filter(function (x) { return x.name === prof.name; })[0];
          if (pr) Object.assign(pr, prof); else d.profiles.push(Object.assign({ row: d.profiles.length + 2 }, prof));
          this.save(d); return { ok: true };
        }
        case 'listAccounts': admin(); return { ok: true, accounts: d.accounts.map(pub) };
        case 'createAccount': {
          admin();
          var na = p.account || {};
          var id = String(na.id || '').trim().toLowerCase();
          if (!/^[a-z0-9._-]{3,30}$/.test(id)) fail('VALEUR', 'Identifiant invalide : 3 à 30 caractères (lettres, chiffres, point, tiret), sans espace ni accent.');
          if (acc(id)) fail('DOUBLON', 'Cet identifiant existe déjà.');
          if (!String(na.name || '').trim()) fail('VALEUR', 'Le prénom du profil est obligatoire.');
          if (String(na.password || '').length < 8) fail('VALEUR', 'Mot de passe trop court (8 caractères minimum).');
          d.accounts.push({ id: id, name: na.name.trim(), role: na.role === 'admin' ? 'admin' : 'client', active: true, password: na.password });
          this.save(d); return { ok: true, id: id };
        }
        case 'updateAccount': {
          var self = me(); admin();
          var ua = acc(p.account.id); if (!ua) fail('INTROUVABLE', 'Compte introuvable.');
          var role = p.account.role === undefined ? ua.role : p.account.role;
          var active = p.account.active === undefined ? ua.active !== false : !!p.account.active;
          if (ua.id === self.id && (role !== 'admin' || !active)) fail('VALEUR', 'Tu ne peux pas retirer tes propres droits admin.');
          ua.role = role; ua.active = active; if (p.account.name !== undefined) ua.name = String(p.account.name).trim();
          this.save(d); return { ok: true };
        }
        case 'resetPassword': {
          admin();
          var ra = acc(p.id); if (!ra) fail('INTROUVABLE', 'Compte introuvable.');
          if (String(p.password || '').length < 8) fail('VALEUR', 'Mot de passe trop court (8 caractères minimum).');
          ra.password = p.password; this.save(d); return { ok: true };
        }
        case 'setup':
          admin();
          d.ingredients.forEach(function (i) { if (!i.role) i.role = Calc.suggestRole(i); if (!i.rayon) i.rayon = Calc.suggestRayon(i.role); });
          d.hasRoleColumns = true; this.save(d);
          return { ok: true, message: 'Colonnes Rôle et Rayon complétées (démo).' };
        case 'addIngredient': {
          admin();
          var ex = d.ingredients.filter(function (i) { return n(i.name) === n(p.ingredient.name); })[0];
          if (ex) fail('DOUBLON', 'Cet ingrédient existe déjà : « ' + ex.name + ' ».');
          d.ingredients.push(Object.assign({ row: d.ingredients.length + 2 }, p.ingredient));
          this.save(d); return { ok: true };
        }
        case 'updateIngredient': {
          admin();
          var it = d.ingredients.filter(function (i) { return i.name === p.name; })[0];
          if (!it) fail('DECALE', 'Le Sheet a changé depuis la dernière lecture.');
          Object.assign(it, p.ingredient, { name: p.name }); this.save(d); return { ok: true };
        }
        case 'addRecipe': {
          admin();
          if (d.recipes.some(function (r) { return n(r.name) === n(p.recipe.name); })) fail('DOUBLON', 'Une recette porte déjà ce nom.');
          var names = {}; d.ingredients.forEach(function (i) { names[i.name] = 1; });
          p.recipe.lines.forEach(function (l) { if (!names[l.ing]) fail('INTROUVABLE', 'Ingrédient introuvable : ' + l.ing); });
          d.recipes.push({ row: d.recipes.length + 2, name: p.recipe.name, portions: p.recipe.portions,
            categorie: p.recipe.categorie, objectif: p.recipe.objectif, prepa: p.recipe.prepa, cuisson: p.recipe.cuisson,
            favori: 'Non', statut: 'À tester', notes: p.recipe.notes || '',
            lines: p.recipe.lines.map(function (l, i) { return { row: 100 + i, ing: l.ing, qty: l.qty }; }),
            steps: (p.recipe.steps || []).map(function (s, i) { return { n: i + 1, text: s.text, timer: s.timer }; }) });
          this.save(d); return { ok: true };
        }
        case 'addLine': case 'updateLine': case 'deleteLine': {
          admin();
          var r = d.recipes.filter(function (x) { return x.name === p.recipe; })[0];
          if (!r) fail('INTROUVABLE', 'Recette introuvable.');
          if (action === 'addLine') r.lines.push({ row: Date.now() % 100000, ing: p.line.ing, qty: p.line.qty });
          else {
            var l = r.lines.filter(function (x) { return x.row === p.row && x.ing === p.ing; })[0];
            if (!l) fail('DECALE', 'Le Sheet a changé depuis la dernière lecture.');
            if (action === 'updateLine') l.qty = p.qty; else r.lines.splice(r.lines.indexOf(l), 1);
          }
          this.save(d); return { ok: true };
        }
        case 'setStock':
          admin();
          p.items.forEach(function (it) {
            var s = d.stock.filter(function (x) { return x.ing === it.ing; })[0];
            var today = new Date().toISOString().slice(0, 10);
            if (s) { s.qty = it.qty; s.date = today; } else d.stock.push({ row: d.stock.length + 2, ing: it.ing, qty: it.qty, date: today, remarque: '' });
          });
          this.save(d); return { ok: true };
        case 'ocr':
          admin();
          return { ok: true, text: p.kind === 'prix'
            ? 'FROMAGE BLANC 0%\n1 kg\n2,15 €\nPrix au kg : 2,15 €'
            : 'Skyr nature\nValeurs nutritionnelles pour 100 g\nÉnergie 263 kJ / 62 kcal\nMatières grasses 0,2 g\ndont acides gras saturés 0,1 g\nGlucides 3,6 g\ndont sucres 3,6 g\nFibres alimentaires 0 g\nProtéines 11 g\nSel 0,1 g' };
        default: fail('ACTION', 'Action inconnue : ' + action);
      }
    }
  };

  root.Api = { call: call, apiUrl: apiUrl, ApiError: ApiError, Demo: Demo };
})(window);
