/* Mode démo : faux Google Sheet gardé dans le téléphone + vrai serveur (demo-server.js).
   Données fictives (demo-data.js). Rien n'est jamais envoyé ailleurs. */
(function (root) {
  'use strict';
  var KEY = 'demoSheet';
  var store = root.Store;
  var server = null, sheets = null, props = {}, cache = {}, lastMail = null;

  function Sheet(name, rows, formulaRows) { this.name = name; this.rows = rows || []; this.fr = formulaRows || 0; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.getMaxColumns = function () { return 26; };
  Sheet.prototype.insertColumnsAfter = function () {};
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.copyFormatToRange = function () {};
  Sheet.prototype.getLastRow = function () {
    var last = this.fr;
    for (var i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i] && this.rows[i].some(function (v) { return v !== '' && v != null; })) { last = Math.max(last, i + 1); break; }
    }
    return last;
  };
  Sheet.prototype.cell = function (r, c) { var row = this.rows[r - 1] || []; var v = row[c - 1]; return v === undefined || v === null ? '' : v; };
  Sheet.prototype.put = function (r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    if (!this.rows[r - 1]) this.rows[r - 1] = [];
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    this.rows[r - 1][c - 1] = v;
  };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    var s = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues: function () { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(s.cell(r + i, c + j)); o.push(row); } return o; },
      getValue: function () { return s.cell(r, c); },
      setValues: function (v) { v.forEach(function (row, i) { row.forEach(function (x, j) { s.put(r + i, c + j, x); }); }); return this; },
      setValue: function (v) { s.put(r, c, v); return this; },
      clearContent: function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) s.put(r + i, c + j, ''); return this; },
      copyFormatToRange: function () {}, setDataValidation: function () { return this; }, setFontWeight: function () { return this; }
    };
  };

  function save() {
    var out = {};
    Object.keys(sheets).forEach(function (n) { out[n] = { rows: sheets[n].rows, fr: sheets[n].fr }; });
    store.set(KEY, { sheets: out, props: props });
  }

  // Les colonnes calculées du vrai Sheet (Recettes G–T) sont recalculées ici pour la démo.
  function recompute() {
    var R = sheets['Recettes'], ings = {}, lines = sheets['Lignes_recette'].rows.slice(1);
    sheets['Ingrédients'].rows.slice(1).forEach(function (r) { if (r && r[0]) ings[r[0]] = r; });
    R.rows.forEach(function (r, i) {
      if (i === 0 || !r || !r[0]) return;
      var t = [0, 0, 0, 0, 0], cost = 0, miss = false, noPrice = false;
      lines.forEach(function (l) {
        if (!l || l[0] !== r[0]) return;
        var g = ings[l[1]]; if (!g) { miss = true; return; }
        var q = (Number(l[2]) || 0) / 100;
        for (var k = 0; k < 5; k++) t[k] += q * (Number(g[2 + k]) || 0);
        if (g[7] === '' || g[7] == null) noPrice = true; else cost += q / 10 * Number(g[7]);
      });
      var p = Number(r[1]) || 1;
      R.put(i + 1, 7, t[0]); R.put(i + 1, 12, t[0] / p); R.put(i + 1, 13, t[1] / p); R.put(i + 1, 14, t[2] / p); R.put(i + 1, 15, t[3] / p);
      R.put(i + 1, 16, cost); R.put(i + 1, 17, cost / p);
      R.put(i + 1, 20, miss ? 'Ingrédient introuvable' : (noPrice ? 'Prix manquant' : 'OK'));
    });
  }

  function env() {
    return {
      SpreadsheetApp: {
        getActive: function () {
          return { getSheetByName: function (n) { return sheets[n] || null; },
            insertSheet: function (n) { sheets[n] = new Sheet(n, [], 0); return sheets[n]; },
            getId: function () { return 'demo'; }, getName: function () { return 'Démo'; } };
        },
        newDataValidation: function () { var b = { requireValueInList: function () { return b; }, setAllowInvalid: function () { return b; }, build: function () { return {}; } }; return b; },
        getUi: function () { throw new Error('pas d’interface en démo'); }
      },
      PropertiesService: { getScriptProperties: function () { return {
        getProperty: function (k) { return k in props ? props[k] : null; }, setProperty: function (k, v) { props[k] = String(v); } }; } },
      CacheService: { getScriptCache: function () { return {
        get: function (k) { return k in cache ? cache[k] : null; }, put: function (k, v) { cache[k] = String(v); }, remove: function (k) { delete cache[k]; } }; } },
      LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } },
      Utilities: {
        getUuid: function () { return (root.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); },
        computeHmacSha256Signature: function (s, k) { var h = 5381, x = s + '|' + k; for (var i = 0; i < x.length; i++) h = (h * 33 + x.charCodeAt(i)) | 0; return String(h >>> 0); },
        base64EncodeWebSafe: function (s) { return btoa(unescape(encodeURIComponent(String(s)))).replace(/\+/g, '-').replace(/\//g, '_'); },
        formatDate: function (d) { return new Date(d).toISOString().slice(0, 10); }
      },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { s: s, setMimeType: function () { return this; } }; } },
      Session: { getScriptTimeZone: function () { return 'Europe/Paris'; } },
      Logger: { log: function () {} },
      MailApp: { sendEmail: function (o) { lastMail = o; } }
    };
  }

  function seed() {
    var D = root.DEMO_DATA;
    sheets = {};
    sheets['Ingrédients'] = new Sheet('Ingrédients', [['Nom']].concat(D.ingredients.map(function (i) {
      return [i.name, i.etat, i.kcal, i.p, i.g, i.l, i.f, i.prix === null ? '' : i.prix, i.magasin, i.source, i.remarque, i.role || '', i.rayon || '', i.allergenes || ''];
    })), 0);
    sheets['Recettes'] = new Sheet('Recettes', [['Nom']].concat(D.recipes.map(function (r) {
      return [r.name, r.portions, r.categorie, r.objectif, r.prepa, r.cuisson, '', '', '', '', '', '', '', '', '', '', '', r.favori, r.statut, '', r.notes];
    })), 201);
    var L = [['Recette']], E = [['Recette']];
    D.recipes.forEach(function (r) {
      r.lines.forEach(function (l) { L.push([r.name, l.ing, l.qty]); });
      r.steps.forEach(function (s) { E.push([r.name, s.n, s.text, s.timer === null || s.timer === undefined ? '' : s.timer]); });
    });
    sheets['Lignes_recette'] = new Sheet('Lignes_recette', L, 501);
    sheets['Étapes'] = new Sheet('Étapes', E, 0);
    sheets['Stock cuisine'] = new Sheet('Stock cuisine', [['Ingrédient']].concat(D.stock.map(function (s) { return [s.ing, s.qty, s.date, s.remarque, '']; })), 0);
    props = {}; cache = {};
    server = root.makeDemoServer(env());
    var I = server.internal;
    I.setup_();
    I.createAccount_({ id: 'admin', name: 'Moi (démo)', role: 'admin', password: 'demo1234', email: 'admin@demo.local' });
    I.createAccount_({ id: 'client', name: 'Proche (démo)', role: 'client', password: 'demo1234', email: 'client@demo.local' });
    var a = I.findAccount_('admin');
    I.saveProfile_(a, { kcal: 2400, prot: 160, objectif: 'Maintien', repas: 4, marge: 10, sexe: 'H', annee: 1992, taille: 180, seances: 4, metier: 'assis', protGkg: 2 });
    I.saveProfile_(I.findAccount_('client'), { kcal: 1800, prot: 110, objectif: 'Sèche', repas: 3, marge: 10, sexe: 'F', annee: 1996, taille: 165, seances: 2, metier: 'debout', protGkg: 1.8 });
    var code = I.createFoyer_(a, 'Maison (démo)').code;
    I.joinFoyer_(I.findAccount_('client'), code);
    var today = new Date();
    [28, 21, 14, 7, 1].forEach(function (d, i) {
      I.addWeight_(I.findAccount_('admin'), root.Calc.isoDay(new Date(today.getTime() - d * 864e5)), 80 + (i % 2) * 0.2);
    });
    I.setAvis_(I.findAccount_('client'), 'Tacos bœuf (démo)', { fav: true, note: 5, comment: 'Super avec du citron vert !' });
    I.setAvis_(I.findAccount_('admin'), 'Poulet riz brocoli (exemple)', { fav: true, note: 4 });
    I.upsertOffer_({ ing: 'Riz basmati cru', magasin: 'Lidl', pack: 1000, prix: 2.49 }, 'admin');
    I.upsertOffer_({ ing: 'Filet de poulet cru', magasin: 'Leclerc', pack: 500, prix: 5.2 }, 'admin');
    I.propose_(I.findAccount_('client'), 'prix', 'Brocoli surgelé Lidl', { offer: { ing: 'Brocoli cuit', magasin: 'Lidl', pack: 1000, prix: 1.89 } });
    recompute(); save();
  }

  function load() {
    if (server) return;
    var saved = store.get(KEY, null);
    if (saved && saved.sheets && saved.sheets['Comptes']) {
      sheets = {};
      Object.keys(saved.sheets).forEach(function (n) { sheets[n] = new Sheet(n, saved.sheets[n].rows, saved.sheets[n].fr); });
      props = saved.props || {};
      server = root.makeDemoServer(env());
    } else seed();
  }

  var SAMPLE = {
    prix: 'FROMAGE BLANC 0%\n1 kg\n2,15 €\nPrix au kg : 2,15 €',
    ticket: 'LIDL\n12 rue de la Gare\nRIZ BASMATI 1KG 2,49 A\nFILET POULET 500G 5,79 A\n2 x BROCOLI 1KG 3,58 A\nTOMATES 1KG\n1,99 A\nSOUS-TOTAL 13,85\nTOTAL 13,85\nCB 13,85\nMerci de votre visite',
    nutrition: 'Skyr nature\nValeurs nutritionnelles pour 100 g\nÉnergie 263 kJ / 62 kcal\nMatières grasses 0,2 g\ndont acides gras saturés 0,1 g\nGlucides 3,6 g\ndont sucres 3,6 g\nFibres alimentaires 0 g\nProtéines 11 g\nSel 0,1 g'
  };

  root.Demo = {
    call: function (action, payload) {
      load();
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (action === 'ocr') { resolve({ ok: true, text: SAMPLE[payload.kind] || SAMPLE.nutrition }); return; }
          var res = server.handle(Object.assign({ action: action }, payload || {}));
          if (action !== 'data' && action !== 'foyerWeek' && action !== 'photos' && action !== 'dashboard') { recompute(); save(); }
          if (res.ok) resolve(res); else reject(res);
        }, 120);
      });
    },
    lastMail: function () { return lastMail; },
    reset: function () { store.del(KEY); server = null; sheets = null; }
  };
})(window);
