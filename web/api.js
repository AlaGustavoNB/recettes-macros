/* Accès au serveur (Apps Script) avec nouvelles tentatives, plus un serveur
   de démonstration local (aucune donnée réelle) pour essayer l'appli. */
(function (root) {
  'use strict';

  var store = root.Store;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function ApiError(message, code, technical) {
    var e = new Error(message); e.code = code || 'ERREUR'; e.technical = technical || ''; return e;
  }

  function apiUrl() {
    var v = store.get('apiUrl', '');
    if (!v) return '';
    if (/^https?:\/\//.test(v)) return v;
    return 'https://script.google.com/macros/s/' + v + '/exec';
  }

  // Erreurs « logiques » renvoyées par le serveur : inutile de réessayer.
  var NO_RETRY = { CODE_FAUX: 1, BLOQUE: 1, NON_AUTORISE: 1, DOUBLON: 1, VALEUR: 1, INTROUVABLE: 1, DECALE: 1,
    PLEIN: 1, PAS_DE_CODE: 1, DRIVE: 1, ACTION: 1, HORS_LIGNE: 1 };

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
    code: 'demo123',
    data: function () {
      var d = store.get('demoData', null);
      if (!d) { d = JSON.parse(JSON.stringify(root.DEMO_DATA)); store.set('demoData', d); }
      return d;
    },
    save: function (d) { store.set('demoData', d); },
    call: async function (action, p) {
      await sleep(150);
      var d = this.data();
      function fail(code, msg) { throw ApiError(msg, code); }
      function admin() { if (p.token !== 'demo-token') fail('NON_AUTORISE', 'Modifications verrouillées : saisis ton code secret.'); }
      var n = Calc.norm;
      switch (action) {
        case 'data':
          d.fetchedAt = new Date().toISOString();
          return Object.assign({ ok: true }, JSON.parse(JSON.stringify(d)));
        case 'unlock':
          if (p.code !== this.code) fail('CODE_FAUX', 'Code incorrect.');
          return { ok: true, token: 'demo-token', expires: Date.now() + 864e5 };
        case 'check': return { ok: true, admin: p.token === 'demo-token' };
        case 'saveProfile': {
          var pr = d.profiles.filter(function (x) { return x.name === p.profile.name; })[0];
          if (pr) Object.assign(pr, p.profile); else d.profiles.push(Object.assign({ row: d.profiles.length + 2 }, p.profile));
          this.save(d); return { ok: true };
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
