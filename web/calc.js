/* Calculs purs de l'appli (aucun accès réseau ni DOM).
   Chargé dans le navigateur (window.Calc) et dans la page de tests. */
(function (root) {
  'use strict';

  var ROLES = ['protéine', 'glucide', 'lipide', 'légume', 'autre'];
  var RAYONS = ['viandes', 'féculents', 'légumes', 'épicerie', 'autre'];
  var ADJUSTABLE = { 'glucide': true, 'lipide': true };
  var S_MIN = 0.25;   // en dessous : on ne réduit plus glucides/lipides, on prévient
  var S_MAX = 4;      // au-delà : quantités de féculents irréalistes, on prévient

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/\s/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function round(n, d) { var f = Math.pow(10, d || 0); return Math.round(n * f) / f; }
  function fr(n, d) { return Number(round(n, d || 0)).toLocaleString('fr-FR'); }

  /* ---------- Rôle et rayon par défaut ---------- */
  function suggestRole(ing) {
    var k = num(ing.kcal) || 0, p = num(ing.p) || 0, g = num(ing.g) || 0, l = num(ing.l) || 0;
    if (k <= 0) return 'autre';
    var sp = 4 * p / k, sg = 4 * g / k, sl = 9 * l / k;
    if (sp >= 0.4 && p >= 10) return 'protéine';
    if (sl >= 0.6) return 'lipide';
    if (k < 70 && g < 12) return 'légume';
    if (sg >= 0.5) return 'glucide';
    if (sp >= 0.3) return 'protéine';
    return 'autre';
  }
  function suggestRayon(role) {
    return { 'protéine': 'viandes', 'glucide': 'féculents', 'légume': 'légumes', 'lipide': 'épicerie' }[role] || 'épicerie';
  }
  function roleOf(ing) {
    var r = norm(ing && ing.role);
    for (var i = 0; i < ROLES.length; i++) if (norm(ROLES[i]) === r) return ROLES[i];
    return suggestRole(ing || {});
  }
  function rayonOf(ing) {
    var r = norm(ing && ing.rayon);
    for (var i = 0; i < RAYONS.length; i++) if (norm(RAYONS[i]) === r) return RAYONS[i];
    return suggestRayon(roleOf(ing || {}));
  }

  /* ---------- Index et macros ---------- */
  function index(ingredients) {
    var exact = {}, loose = {};
    (ingredients || []).forEach(function (i) { exact[i.name] = i; loose[norm(i.name)] = i; });
    return { exact: exact, loose: loose, list: ingredients || [] };
  }
  // Recherche au caractère près (comme le Sheet), sinon null.
  function find(idx, name) { return idx.exact[name] || null; }
  function findLoose(idx, name) { return idx.loose[norm(name)] || null; }

  function zero() { return { kcal: 0, p: 0, g: 0, l: 0, f: 0, cost: 0, missingPrice: [], missing: [] }; }

  function addLine(t, ing, qty, name) {
    if (!ing) { t.missing.push(name); return t; }
    var q = qty / 100;
    t.kcal += q * (num(ing.kcal) || 0);
    t.p += q * (num(ing.p) || 0);
    t.g += q * (num(ing.g) || 0);
    t.l += q * (num(ing.l) || 0);
    t.f += q * (num(ing.f) || 0);
    var prix = num(ing.prix);
    if (prix === null) { if (t.missingPrice.indexOf(ing.name) < 0) t.missingPrice.push(ing.name); }
    else t.cost += qty / 1000 * prix;
    return t;
  }

  function totals(items, idx) {
    var t = zero();
    items.forEach(function (it) { addLine(t, it.ing || find(idx, it.name), it.qty, it.name); });
    return t;
  }

  function scaleT(t, k) {
    return { kcal: t.kcal * k, p: t.p * k, g: t.g * k, l: t.l * k, f: t.f * k, cost: t.cost * k,
      missingPrice: t.missingPrice.slice(), missing: t.missing.slice() };
  }

  // Totaux et valeurs par portion d'une recette, telles qu'enregistrées dans le Sheet.
  function recipeTotals(recipe, idx) {
    var t = totals(recipe.lines.map(function (l) { return { name: l.ing, qty: num(l.qty) || 0 }; }), idx);
    var portions = num(recipe.portions) || 1;
    return { total: t, portion: scaleT(t, 1 / portions), portions: portions };
  }

  // Ingrédients d'une portion, avec rôle.
  function portionItems(recipe, idx) {
    var portions = num(recipe.portions) || 1;
    return recipe.lines.map(function (l) {
      var ing = find(idx, l.ing);
      return { name: l.ing, ing: ing, qty: (num(l.qty) || 0) / portions, role: ing ? roleOf(ing) : 'autre' };
    });
  }

  function split(items) {
    var fix = [], adj = [];
    items.forEach(function (it) { (ADJUSTABLE[it.role] ? adj : fix).push(it); });
    return { fix: fix, adj: adj };
  }

  /* ---------- Recalcul « protéines fixes » ----------
     opts: { kcal: cible par portion, protRef: protéines cibles par repas (ou null),
             margin: 0.10 ou 0.05 } */
  function adjust(recipe, idx, opts) {
    var margin = opts.margin == null ? 0.10 : opts.margin;
    var items = portionItems(recipe, idx);
    var original = totals(items, idx);
    var target = num(opts.kcal);
    var parts = split(items);
    var tf = totals(parts.fix, idx), ta = totals(parts.adj, idx);
    var res = { items: [], original: original, target: target, margin: margin, s: 1,
      minKcal: tf.kcal + S_MIN * ta.kcal, maxKcal: tf.kcal + S_MAX * ta.kcal,
      fixedKcal: tf.kcal, status: 'ok', messages: [] };

    if (original.missing.length) {
      res.status = 'error';
      res.messages.push('Ingrédient introuvable dans l’onglet Ingrédients : ' + original.missing.join(', ') + '.');
    }
    var s = 1;
    if (target && target > 0 && res.status !== 'error') {
      if (ta.kcal <= 0) {
        if (Math.abs(original.kcal - target) / target > margin) {
          res.status = 'impossible';
          res.messages.push('Cette recette n’a ni glucide ni lipide ajustable : les kcal ne peuvent pas changer sans toucher aux protéines.');
        }
      } else {
        s = (target - tf.kcal) / ta.kcal;
        if (s < S_MIN) {
          res.status = 'low';
          res.messages.push('Limite basse atteinte : avec les protéines gardées, cette recette ne descend pas sous ' +
            fr(res.minKcal) + ' kcal par portion. Je ne réduis pas les protéines en silence : choisis une alternative ci-dessous ou augmente les kcal.');
          s = S_MIN;
        } else if (s > S_MAX) {
          res.status = 'high';
          res.messages.push('Pour atteindre ' + fr(target) + ' kcal il faudrait plus de ' + S_MAX +
            ' fois les féculents et matières grasses. Quantités plafonnées à ' + fr(res.maxKcal) + ' kcal.');
          s = S_MAX;
        }
      }
    }
    res.s = s;
    res.items = items.map(function (it) {
      var q = ADJUSTABLE[it.role] ? it.qty * s : it.qty;
      return { name: it.name, ing: it.ing, role: it.role, qty0: it.qty, qty: q, fixed: !ADJUSTABLE[it.role] };
    });
    res.totals = totals(res.items, idx);
    res.protRef = num(opts.protRef);
    res.protStatus = protStatus(res.totals.p, res.protRef, margin);
    if (res.protStatus === 'hors') {
      res.messages.push('Protéines hors marge : ' + fr(res.totals.p, 1) + ' g pour une cible de ' +
        fr(res.protRef, 1) + ' g ± ' + Math.round(margin * 100) + ' % par repas.');
    }
    return res;
  }

  function protStatus(p, ref, margin) {
    if (!ref || ref <= 0) return 'sans-cible';
    return Math.abs(p - ref) / ref <= margin + 1e-9 ? 'ok' : 'hors';
  }

  /* ---------- Alternatives de remplacement ----------
     Chaque alternative remplace UN ingrédient de la recette, garde les protéines
     d'origine (± marge) et atteint les kcal visées (± marge). */
  function alternatives(recipe, idx, opts) {
    var margin = opts.margin == null ? 0.10 : opts.margin;
    var Kt = num(opts.kcal);
    if (!Kt) return [];
    var items = portionItems(recipe, idx);
    if (items.some(function (it) { return !it.ing; })) return [];
    var before = totals(items, idx);
    var Pref = before.p;
    var out = [];
    var inRecipe = {};
    items.forEach(function (it) { inRecipe[it.name] = true; });

    var only = opts.only || null;
    items.forEach(function (it, i) {
      if (only && only.from && it.name !== only.from) return;
      var others = items.filter(function (_, j) { return j !== i; });
      var parts = split(others);
      var F = totals(parts.fix, idx), A = totals(parts.adj, idx);
      var candidates = idx.list.filter(function (c) {
        if (only && only.to) return c.name === only.to && !inRecipe[c.name] && (num(c.kcal) || 0) > 0;
        return !inRecipe[c.name] && (num(c.kcal) || 0) > 0 && roleOf(c) === it.role;
      });
      if (!(only && only.to)) candidates.push(null); // null = retirer l'ingrédient
      candidates.forEach(function (c) {
        var q, s, pc = c ? (num(c.p) || 0) / 100 : 0, kc = c ? (num(c.kcal) || 0) / 100 : 0;
        if (A.kcal > 0) {
          if (!c) { q = 0; s = (Kt - F.kcal) / A.kcal; }
          else {
            var det = pc * A.kcal - kc * A.p;
            if (Math.abs(det) < 1e-6) return;
            q = ((Pref - F.p) * A.kcal - (Kt - F.kcal) * A.p) / det;
            s = (pc * (Kt - F.kcal) - kc * (Pref - F.p)) / det;
            // Solution exacte hors limites : on borne glucides/lipides, on vise les kcal,
            // et on vérifie ensuite que les protéines restent dans la marge.
            if (s < S_MIN || s > S_MAX) {
              s = Math.min(S_MAX, Math.max(S_MIN, s));
              q = (Kt - F.kcal - s * A.kcal) / kc;
            }
          }
          if (s < S_MIN || s > S_MAX) return;
        } else {
          s = 1;
          if (!c) return;
          q = (Kt - F.kcal) / kc;
        }
        if (c && (q < 5 || q > 600)) return;
        var after = others.map(function (o) {
          return { name: o.name, ing: o.ing, role: o.role, qty0: o.qty, qty: ADJUSTABLE[o.role] ? o.qty * s : o.qty };
        });
        if (c) after.splice(i, 0, { name: c.name, ing: c, role: roleOf(c), qty0: 0, qty: q, isNew: true });
        var t = totals(after, idx);
        if (Math.abs(t.kcal - Kt) / Kt > margin + 1e-9) return;
        if (Pref > 0 && Math.abs(t.p - Pref) / Pref > margin + 1e-9) return;
        var score = Math.abs(t.p - Pref) / Math.max(Pref, 1) + Math.abs(t.kcal - Kt) / Kt + Math.abs(Math.log(Math.max(s, 0.01))) * 0.1;
        out.push({ replaced: it.name, replacedQty: it.qty, by: c ? c.name : null, byQty: q, s: s,
          items: after, before: before, after: t, score: score });
      });
    });
    out.sort(function (a, b) { return a.score - b.score; });
    // Une seule alternative par ingrédient de remplacement, 5 au maximum (par défaut).
    var seen = {}, res = [], max = opts.max || 5;
    out.forEach(function (a) {
      var key = a.replaced + '>' + a.by;
      if (!seen[key] && res.length < max) { seen[key] = true; res.push(a); }
    });
    return res;
  }

  /* ---------- Pesée cru / cuit ---------- */
  function isRaw(ing, name) {
    if (ing && norm(ing.etat) === 'cru') return true;
    return /\bcrue?s?\b/.test(norm(name));
  }
  // portions: nombre d'assiettes ; cooked: { nom: poids cuit total }
  function cookPlan(adjusted, portions, cooked) {
    return adjusted.items.map(function (it) {
      var raw = it.qty * portions;
      var row = { name: it.name, raw: raw, isRaw: isRaw(it.ing, it.name) };
      var c = cooked && num(cooked[it.name]);
      if (row.isRaw && c && c > 0) { row.cooked = c; row.perPortionCooked = c / portions; }
      else row.perPortion = it.qty;
      return row;
    });
  }

  /* ---------- Planning en texte libre ---------- */
  var WORDS = { 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8,
    'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15, 'seize': 16,
    'vingt': 20, 'trente': 30 };
  var FILLER = ['soir', 'soirs', 'midi', 'midis', 'repas', 'fois', 'jour', 'jours', 'portion', 'portions', 'le', 'la', 'les',
    'de', 'des', 'du', 'd', 'recette', 'au', 'aux', 'a', 'pour', 'en', 'et', 'avec', 'matin', 'matins', 'dejeuner',
    'dejeuners', 'diner', 'diners', 'semaine', 'cette', 'je', 'veux', 'mange', 'manger', 'plat', 'plats'];

  function tokens(s) { return norm(s).split(' ').filter(Boolean); }

  function matchRecipe(text, recipes) {
    var tk = tokens(text).filter(function (t) { return FILLER.indexOf(t) < 0; });
    if (!tk.length) return null;
    var best = null, bestScore = 0;
    recipes.forEach(function (r) {
      var rt = tokens(r.name).filter(function (t) { return FILLER.indexOf(t) < 0; });
      if (!rt.length) return;
      var hit = 0;
      tk.forEach(function (t) {
        if (rt.some(function (x) { return x === t || (t.length >= 4 && (x.indexOf(t) === 0 || t.indexOf(x) === 0)); })) hit++;
      });
      var score = hit / Math.max(tk.length, 1) * 0.6 + hit / rt.length * 0.4;
      if (norm(r.name) === tk.join(' ')) score = 2;
      if (score > bestScore) { bestScore = score; best = r; }
    });
    return bestScore >= 0.45 ? best : null;
  }

  function parsePlan(text, recipes) {
    var chunks = String(text || '').split(/[,;\n.]+|\s+puis\s+|\s+et\s+(?=(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze)\b)/i);
    var res = [], unknown = [];
    chunks.forEach(function (c) {
      c = c.trim();
      if (!c) return;
      var m = c.match(/(\d+)/), n = null;
      if (m) n = parseInt(m[1], 10);
      else {
        tokens(c).some(function (t) { if (WORDS[t]) { n = WORDS[t]; return true; } return false; });
      }
      var rest = c.replace(/\d+/g, ' ');
      tokens(c).forEach(function (t) { if (WORDS[t]) rest = rest.replace(new RegExp('\\b' + t + '\\b', 'i'), ' '); });
      rest = rest.replace(/[-–]/g, ' ');
      var r = matchRecipe(rest, recipes);
      if (r) {
        var ex = res.filter(function (x) { return x.recipe === r.name; })[0];
        if (ex) ex.meals += n || 1; else res.push({ recipe: r.name, meals: n || 1 });
      } else unknown.push(c);
    });
    return { items: res, unknown: unknown };
  }

  /* ---------- Stock dicté : « j'ai 500 g de riz basmati cru » ---------- */
  function parseStock(text, ingredients) {
    var out = [], unknown = [];
    String(text || '').split(/[,;\n]+|\s+et\s+(?=\d)/i).forEach(function (c) {
      c = c.trim(); if (!c) return;
      var m = c.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos|g|gr|grammes?)?\s*(?:de |d’|d')?\s*(.*)$/i);
      if (!m) { unknown.push(c); return; }
      var q = num(m[1]); var u = (m[2] || 'g').toLowerCase();
      if (/^k/.test(u)) q *= 1000;
      var fake = ingredients.map(function (i) { return { name: i.name }; });
      var r = matchRecipe(m[3], fake);
      if (r) out.push({ ing: r.name, qty: q }); else unknown.push(c);
    });
    return { items: out, unknown: unknown };
  }

  /* ---------- Liste de courses ----------
     plan: [{ recipe, meals, kcal }], options: { protRef, margin, stock: {nom: g}, useStock } */
  function shoppingList(plan, recipes, idx, options) {
    var byName = {}, warnings = [];
    recipes.forEach(function (r) { byName[r.name] = r; });
    var need = {};
    plan.forEach(function (p) {
      var r = byName[p.recipe];
      if (!r || !(num(p.meals) > 0)) return;
      var a = adjust(r, idx, { kcal: p.kcal, protRef: options.protRef, margin: options.margin });
      if (a.status === 'error') { warnings.push(r.name + ' : ' + a.messages[0]); return; }
      if (a.status === 'low' || a.status === 'high' || a.status === 'impossible') warnings.push(r.name + ' : ' + a.messages[0]);
      a.items.forEach(function (it) {
        need[it.name] = (need[it.name] || 0) + it.qty * num(p.meals);
      });
    });
    var lines = [], total = 0, missingPrice = [];
    Object.keys(need).forEach(function (name) {
      var ing = find(idx, name);
      var have = options.useStock && options.stock ? (num(options.stock[name]) || 0) : 0;
      var buy = Math.max(0, need[name] - have);
      var prix = ing ? num(ing.prix) : null;
      var cost = prix === null ? null : buy / 1000 * prix;
      if (buy > 0 && cost === null) missingPrice.push(name);
      if (cost !== null) total += cost;
      lines.push({ name: name, need: need[name], stock: have, buy: buy, cost: cost,
        rayon: ing ? rayonOf(ing) : 'autre', magasin: ing ? ing.magasin : '' });
    });
    var order = RAYONS;
    lines.sort(function (a, b) {
      return order.indexOf(a.rayon) - order.indexOf(b.rayon) || a.name.localeCompare(b.name, 'fr');
    });
    return { lines: lines, total: total, missingPrice: missingPrice, warnings: warnings };
  }

  /* ---------- Lecture d'étiquette (texte OCR) ---------- */
  var NUM_RE = /(<\s*)?(\d+(?:[.,]\d+)?)/;
  function firstNumberAfter(lines, i, re) {
    var tail = lines[i].replace(re, '');
    var m = tail.match(NUM_RE);
    if (m) return m[1] ? 0 : num(m[2]);
    for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) {
      if (/[a-z]{4,}/i.test(lines[j].replace(/kcal|kj|\bg\b|mg/ig, '')) ) break;
      var m2 = lines[j].match(NUM_RE);
      if (m2) return m2[1] ? 0 : num(m2[2]);
    }
    return null;
  }

  function parseNutrition(text) {
    var raw = String(text || '');
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var res = { name: '', kcal: null, p: null, g: null, l: null, f: null, found: [] };
    var flat = raw.replace(/\s+/g, ' ');
    var mk = flat.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);
    if (mk) res.kcal = num(mk[1]);
    else {
      var mj = flat.match(/(\d+(?:[.,]\d+)?)\s*kj/i);
      if (mj) res.kcal = round(num(mj[1]) / 4.184, 0);
    }
    var keys = [
      ['p', /^.*?prot[ée]ines?/i],
      ['g', /^.*?glucides(?!.*sucre)/i],
      ['l', /^.*?(mati[èe]res?\s+grasses|lipides)(?!.*satur)/i],
      ['f', /^.*?fibres(\s+alimentaires)?/i]
    ];
    lines.forEach(function (line, i) {
      var nl = norm(line);
      if (/dont|satur|sucres/.test(nl)) return;
      keys.forEach(function (k) {
        if (res[k[0]] === null && k[1].test(line)) {
          var v = firstNumberAfter(lines, i, k[1]);
          if (v !== null) res[k[0]] = v;
        }
      });
    });
    var bad = /(valeurs?|nutrition|energie|kcal|kj|pour|100|prot|gluc|lipid|grasses|fibres|sel|sucres|ingr|portion|apport|ar\b)/i;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length >= 3 && !bad.test(norm(lines[i])) && /[a-z]/i.test(lines[i])) { res.name = lines[i]; break; }
    }
    ['kcal', 'p', 'g', 'l', 'f'].forEach(function (k) { if (res[k] !== null) res.found.push(k); });
    return res;
  }

  // Prix au kg lu sur une étiquette de rayon. Ne calcule que ce qui est écrit.
  function parsePrice(text) {
    var flat = String(text || '').replace(/\s+/g, ' ');
    var m = flat.match(/(\d+[.,]\d{1,2})\s*€?\s*(?:\/|le|au|par)\s*(?:le\s*)?kg/i) ||
            flat.match(/(?:prix\s*(?:au|du|par)?\s*kg|€\s*\/\s*kg|le\s*kg)\D{0,6}(\d+[.,]\d{1,2})/i);
    if (m) return { prixKg: num(m[1]), how: 'Prix au kg lu sur l’étiquette' };
    var p = flat.match(/(\d+[.,]\d{2})\s*€/), w = flat.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
    if (p && w) {
      var grams = num(w[1]) * (/kg/i.test(w[2]) ? 1000 : 1);
      if (grams > 0) return { prixKg: round(num(p[1]) / grams * 1000, 2), how: 'Calculé : ' + p[1] + ' € pour ' + w[1] + ' ' + w[2] };
    }
    return { prixKg: null, how: 'Prix non trouvé sur la photo' };
  }

  /* ---------- Ticket de caisse (texte lu par OCR) ----------
     Renvoie le magasin reconnu et une ligne par article avec un prix, rapprochée si possible
     d'un ingrédient. Rien n'est inventé : sans prix lisible, la ligne est ignorée. */
  var STORES = ['Lidl', 'Leclerc', 'Carrefour', 'Auchan', 'Intermarché', 'Super U', 'Hyper U', 'Monoprix', 'Franprix',
    'Aldi', 'Casino', 'Netto', 'Grand Frais', 'Picard', 'Cora', 'Match', 'Biocoop', 'Naturalia', 'Leader Price', 'Spar', 'Action'];
  var NOT_ITEM = /total|sous.?total|tva|t\.v\.a|carte|cb\b|espece|esp\b|rendu|monnaie|remise|reduc|fidel|avantage|ticket|caisse|merci|siret|tel\b|net a payer|a payer|paiement|montant|solde|points|bon d|article|nb ?art|date|heure/;
  function parseReceipt(text, ingredients) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var flat = norm(lines.join(' '));
    var magasin = '';
    STORES.some(function (s) { if (flat.indexOf(norm(s)) >= 0) { magasin = s; return true; } return false; });
    var fake = (ingredients || []).map(function (i) { return { name: i.name }; });
    var items = [];
    lines.forEach(function (l, i) {
      var m = l.match(/(-?\d+[.,]\d{2})\s*(?:€|eur)?\s*(?:[A-Z]\d?|\*)?$/i);
      var label = m ? l.slice(0, m.index).trim() : '';
      // Prix seul sur sa ligne : l'article est sur la ligne d'avant.
      if (m && !/[a-z]{3,}/i.test(label) && i > 0 && !/\d+[.,]\d{2}/.test(lines[i - 1])) label = lines[i - 1];
      if (!m || !/[a-z]{3,}/i.test(label)) return;
      var nl = norm(label);
      if (NOT_ITEM.test(nl)) return;
      var prix = num(m[1]);
      if (!(prix > 0) || prix > 200) return;
      var qtyMult = label.match(/^(\d+)\s*[x×]\s+/i);
      var w = label.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr)\b/i);
      var pack = w ? Math.round(num(w[1]) * (/kg/i.test(w[2]) ? 1000 : 1)) : null;
      var clean = label.replace(/^\d+\s*[x×]\s+/i, '').replace(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr)\b/ig, ' ').replace(/\s+/g, ' ').trim();
      var match = matchRecipe(clean, fake);
      items.push({ label: clean, prix: qtyMult ? round(prix / Number(qtyMult[1]), 2) : prix, pack: pack, ing: match ? match.name : '' });
    });
    return { magasin: magasin, items: items };
  }

  /* ---------- Code-barres : fiche Open Food Facts → valeurs pour 100 g ----------
     Seules les valeurs présentes dans la fiche sont reprises (rien n'est deviné). */
  var OFF_ALLERGENS = { 'en:gluten': 'gluten', 'en:milk': 'lactose', 'en:eggs': 'œuf', 'en:fish': 'poisson',
    'en:crustaceans': 'crustacés', 'en:molluscs': 'crustacés', 'en:nuts': 'fruits à coque', 'en:peanuts': 'arachide',
    'en:soybeans': 'soja', 'en:sesame-seeds': 'sésame' };
  function validEan(code) {
    var c = String(code || '').replace(/\D/g, '');
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(c)) return false;
    var digits = c.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - sum % 10) % 10 === check;
  }
  function parseOFF(json) {
    var p = json && json.product;
    if (!json || json.status !== 1 || !p) return null;
    var n = p.nutriments || {};
    var val = function (k) { var v = num(n[k]); return v === null ? null : round(v, 1); };
    var kcal = num(n['energy-kcal_100g']);
    if (kcal === null && num(n['energy-kj_100g']) !== null) kcal = num(n['energy-kj_100g']) / 4.184;
    if (kcal === null && num(n.energy_100g) !== null) kcal = num(n.energy_100g) / 4.184;
    var tags = {};
    (p.allergens_tags || []).forEach(function (t) { if (OFF_ALLERGENS[t]) tags[OFF_ALLERGENS[t]] = 1; });
    var name = [p.product_name_fr || p.product_name, p.brands ? String(p.brands).split(',')[0].trim() : ''].filter(Boolean).join(' – ');
    var res = { name: name, kcal: kcal === null ? null : Math.round(kcal), p: val('proteins_100g'), g: val('carbohydrates_100g'),
      l: val('fat_100g'), f: val('fiber_100g'), allergenes: Object.keys(tags), quantity: p.quantity || '', found: [] };
    ['kcal', 'p', 'g', 'l', 'f'].forEach(function (k) { if (res[k] !== null) res.found.push(k); });
    return res;
  }

  /* ---------- Remplacer un ingrédient précis (kcal et protéines conservées) ---------- */
  function replaceWith(recipe, idx, opts, fromName, toName) {
    var Kt = num(opts.kcal) || recipeTotals(recipe, idx).portion.kcal;
    var margin = opts.margin == null ? 0.10 : opts.margin;
    var all = alternatives(recipe, idx, { kcal: Kt, margin: margin, only: { from: fromName, to: toName } });
    return all[0] || null;
  }
  // Ingrédients de même rôle qui peuvent remplacer « fromName » dans cette recette.
  function replacementCandidates(recipe, idx, opts, fromName) {
    var Kt = num(opts.kcal) || recipeTotals(recipe, idx).portion.kcal;
    return alternatives(recipe, idx, { kcal: Kt, margin: opts.margin == null ? 0.10 : opts.margin, only: { from: fromName }, max: 30 })
      .filter(function (a) { return a.by; });
  }

  /* ---------- Objectifs proposés ---------- */
  var ALLERGENES = ['gluten', 'lactose', 'œuf', 'poisson', 'crustacés', 'fruits à coque', 'arachide', 'soja', 'sésame', 'porc', 'alcool'];
  // Métier : assis 1,2 · debout 1,375 · physique 1,55 ; + 0,05 par séance de sport (max 1,9).
  function activityFactor(seances, metier) {
    var base = { 'assis': 1.2, 'debout': 1.375, 'physique': 1.55 }[norm(metier)] || 1.2;
    return Math.min(1.9, base + 0.05 * Math.max(0, Math.min(14, num(seances) || 0)));
  }
  var GOAL_K = { 'seche': 0.80, 'maintien': 1, 'masse': 1.10 };
  var PROT_GKG = { 'seche': 2.0, 'maintien': 1.6, 'masse': 1.8 };
  // p : { sexe 'H'|'F', annee, taille (cm), poids (kg), seances, metier, objectif, protGkg }
  function targets(p, year) {
    var w = num(p.poids), h = num(p.taille), y = num(p.annee);
    if (!w || !h || !y) return null;
    var age = (year || new Date().getFullYear()) - y;
    var bmr = 10 * w + 6.25 * h - 5 * age + (String(p.sexe).toUpperCase() === 'F' ? -161 : 5);
    var factor = activityFactor(p.seances, p.metier);
    var goal = norm(p.objectif) || 'maintien';
    var kcal = Math.round(bmr * factor * (GOAL_K[goal] || 1) / 10) * 10;
    var gkg = num(p.protGkg) || PROT_GKG[goal] || 1.6;
    var prot = Math.round(w * gkg);
    var lip = Math.round(w * 0.9);
    var glu = Math.max(0, Math.round((kcal - prot * 4 - lip * 9) / 4));
    return { kcal: kcal, prot: prot, lip: lip, glu: glu, bmr: Math.round(bmr), factor: round(factor, 3), age: age, protGkg: gkg };
  }
  // Glucides / lipides indicatifs pour des kcal et protéines données.
  function macroSplit(kcal, prot, poids) {
    kcal = num(kcal); prot = num(prot);
    if (!kcal || !prot) return null;
    var lip = num(poids) ? Math.round(num(poids) * 0.9) : Math.round(kcal * 0.28 / 9);
    return { lip: lip, glu: Math.max(0, Math.round((kcal - prot * 4 - lip * 9) / 4)) };
  }

  /* ---------- Poids : tendance et ajustement proposé ---------- */
  function mondayOf(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd);
    return x;
  }
  function isoDay(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function parseDay(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  // weights : [{date 'yyyy-mm-dd', kg}] ; renvoie moyennes par semaine et éventuelle proposition.
  function weightTrend(weights, objectif, kcal) {
    var byWeek = {};
    (weights || []).forEach(function (w) {
      var d = parseDay(w.date), kg = num(w.kg);
      if (!d || !kg) return;
      var k = isoDay(mondayOf(d));
      (byWeek[k] = byWeek[k] || []).push(kg);
    });
    var weeks = Object.keys(byWeek).sort().map(function (k) {
      var a = byWeek[k]; return { week: k, avg: a.reduce(function (s, x) { return s + x; }, 0) / a.length, n: a.length };
    });
    var res = { weeks: weeks, rate: null, suggestion: null };
    if (weeks.length < 3) return res;
    var last = weeks[weeks.length - 1], ref = weeks[weeks.length - 3];
    var nWeeks = (parseDay(last.week) - parseDay(ref.week)) / (7 * 864e5);
    if (nWeeks < 2) return res;
    var rate = (last.avg - ref.avg) / ref.avg / nWeeks * 100; // % du poids par semaine
    res.rate = round(rate, 2);
    var goal = norm(objectif) || 'maintien', delta = 0, why = '';
    if (goal === 'seche') {
      if (rate > -0.25) { delta = -100; why = 'Le poids baisse moins de 0,25 % par semaine.'; }
      else if (rate < -1) { delta = 100; why = 'Le poids baisse de plus de 1 % par semaine (trop rapide).'; }
    } else if (goal === 'masse') {
      if (rate < 0.1) { delta = 100; why = 'Le poids monte moins de 0,1 % par semaine.'; }
      else if (rate > 0.5) { delta = -100; why = 'Le poids monte de plus de 0,5 % par semaine (trop rapide).'; }
    } else if (Math.abs(rate) > 0.5) {
      delta = rate > 0 ? -100 : 100; why = 'Le poids varie de plus de 0,5 % par semaine.';
    }
    if (delta && num(kcal)) res.suggestion = { delta: delta, kcal: num(kcal) + delta, why: why };
    return res;
  }

  /* ---------- Paquets et prix par magasin ---------- */
  // offers : [{ ing, magasin, pack (g), prix (€ le paquet) }]
  function bestOffer(name, offers) {
    var best = null;
    (offers || []).forEach(function (o) {
      if (o.ing !== name) return;
      var pack = num(o.pack), prix = num(o.prix);
      if (!pack || pack <= 0 || prix === null) return;
      var perKg = prix / pack * 1000;
      if (!best || perKg < best.perKg) best = { magasin: o.magasin, pack: pack, prix: prix, perKg: perKg };
    });
    return best;
  }
  function priceLine(name, buy, ing, offers) {
    var o = bestOffer(name, offers);
    if (buy <= 0) return { buy: 0, cost: 0, packs: 0, offer: o };
    if (o) {
      var packs = Math.ceil(buy / o.pack - 1e-9);
      return { buy: buy, packs: packs, packSize: o.pack, bought: packs * o.pack, cost: packs * o.prix, magasin: o.magasin, offer: o };
    }
    var prix = ing ? num(ing.prix) : null;
    return { buy: buy, packs: null, bought: buy, cost: prix === null ? null : buy / 1000 * prix, magasin: ing ? ing.magasin : '' };
  }

  /* ---------- Repas d'un membre (utilisé aussi par le serveur) ----------
     row : { recipe, kcal, version: [{name, qty}] (par portion) } */
  function mealItems(row, recipe, idx, prof) {
    if (row.version && row.version.length) {
      return { items: row.version.map(function (v) { return { name: v.name, qty: num(v.qty) || 0 }; }), status: 'variant', messages: [] };
    }
    var repas = (prof && num(prof.repas)) || 3;
    var kcal = num(row.kcal) || (prof && num(prof.kcal) ? num(prof.kcal) / repas : null);
    var a = adjust(recipe, idx, { kcal: kcal, protRef: prof && num(prof.prot) ? num(prof.prot) / repas : null,
      margin: ((prof && num(prof.marge)) || 10) / 100 });
    return { items: a.items.map(function (it) { return { name: it.name, qty: it.qty }; }), status: a.status, messages: a.messages, kcal: a.totals.kcal };
  }

  // Besoins totaux (g) à partir des repas du foyer : meals [{ items:[{name, qty}], cooked, reste }]
  function needsFromMeals(meals) {
    var need = {};
    meals.forEach(function (m) {
      if (m.cooked || m.reste) return;
      m.items.forEach(function (it) { need[it.name] = (need[it.name] || 0) + (num(it.qty) || 0); });
    });
    return need;
  }
  // Liste de courses du foyer : besoins, stock, paquets, prix.
  function foyerList(need, idx, opts) {
    opts = opts || {};
    var lines = [], total = 0, missingPrice = [];
    Object.keys(need).forEach(function (name) {
      var ing = find(idx, name);
      var have = opts.useStock && opts.stock ? (num(opts.stock[name]) || 0) : 0;
      var buy = Math.max(0, need[name] - have);
      var pl = priceLine(name, buy, ing, opts.offers);
      if (buy > 0 && pl.cost === null) missingPrice.push(name);
      if (pl.cost) total += pl.cost;
      lines.push({ name: name, need: need[name], stock: have, buy: buy, packs: pl.packs, packSize: pl.packSize,
        bought: pl.bought || 0, cost: buy > 0 ? pl.cost : 0, magasin: pl.magasin || '', rayon: ing ? rayonOf(ing) : 'autre' });
    });
    lines.sort(function (a, b) { return RAYONS.indexOf(a.rayon) - RAYONS.indexOf(b.rayon) || a.name.localeCompare(b.name, 'fr'); });
    return { lines: lines, total: total, missingPrice: missingPrice };
  }

  /* ---------- Exclusions (allergies, ingrédients) ---------- */
  function splitList(s) {
    if (Array.isArray(s)) return s;
    return String(s || '').split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function excludedBy(recipe, idx, prof) {
    if (!prof) return null;
    var alls = splitList(prof.allergies).map(norm), ings = splitList(prof.exclus).map(norm);
    if (!alls.length && !ings.length) return null;
    for (var i = 0; i < recipe.lines.length; i++) {
      var l = recipe.lines[i], ing = find(idx, l.ing);
      if (ings.indexOf(norm(l.ing)) >= 0) return l.ing;
      if (ing) {
        var tags = splitList(ing.allergenes).map(norm);
        for (var j = 0; j < tags.length; j++) if (alls.indexOf(tags[j]) >= 0) return l.ing + ' (' + tags[j] + ')';
      }
    }
    return null;
  }

  /* ---------- Semaine proposée automatiquement ---------- */
  // opts : { meals: nombre de repas, avis: {recette: {fav, note}}, exclude: fn(recipe)->bool, ok: fn(recipe)->bool, seed }
  function autoPlan(recipes, opts) {
    var n = Math.max(1, Math.min(42, num(opts.meals) || 14));
    var seed = opts.seed || 1;
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var pool = recipes.filter(function (r) { return !(opts.exclude && opts.exclude(r)) && (!opts.ok || opts.ok(r)); });
    if (!pool.length) return [];
    var scored = pool.map(function (r) {
      var a = (opts.avis || {})[r.name] || {};
      var s = 1 + (a.fav ? 2 : 0) + (num(a.note) ? (num(a.note) - 3) * 0.5 : 0) + (num(a.avg) ? (num(a.avg) - 3) * 0.3 : 0);
      return { r: r, w: Math.max(0.2, s) };
    });
    var maxEach = Math.max(2, Math.ceil(n / Math.min(pool.length, 5)));
    var count = {}, out = [];
    for (var i = 0; i < n; i++) {
      var avail = scored.filter(function (x) { return (count[x.r.name] || 0) < maxEach; });
      if (!avail.length) avail = scored;
      var tot = avail.reduce(function (s, x) { return s + x.w; }, 0), t = rnd() * tot, pick = avail[0];
      for (var j = 0; j < avail.length; j++) { t -= avail[j].w; if (t <= 0) { pick = avail[j]; break; } }
      count[pick.r.name] = (count[pick.r.name] || 0) + 1;
      out.push(pick.r.name);
    }
    return Object.keys(count).map(function (k) { return { recipe: k, meals: count[k] }; });
  }

  var api = { ROLES: ROLES, RAYONS: RAYONS, ALLERGENES: ALLERGENES, S_MIN: S_MIN, S_MAX: S_MAX, norm: norm, num: num, round: round,
    suggestRole: suggestRole, suggestRayon: suggestRayon, roleOf: roleOf, rayonOf: rayonOf,
    index: index, find: find, findLoose: findLoose, totals: totals, recipeTotals: recipeTotals,
    portionItems: portionItems, adjust: adjust, alternatives: alternatives, protStatus: protStatus,
    replaceWith: replaceWith, replacementCandidates: replacementCandidates,
    isRaw: isRaw, cookPlan: cookPlan, parsePlan: parsePlan, matchRecipe: matchRecipe, parseStock: parseStock,
    shoppingList: shoppingList, parseNutrition: parseNutrition, parsePrice: parsePrice,
    activityFactor: activityFactor, targets: targets, macroSplit: macroSplit, weightTrend: weightTrend,
    mondayOf: mondayOf, isoDay: isoDay, parseDay: parseDay,
    bestOffer: bestOffer, priceLine: priceLine, mealItems: mealItems, needsFromMeals: needsFromMeals, foyerList: foyerList,
    splitList: splitList, excludedBy: excludedBy, autoPlan: autoPlan, parseReceipt: parseReceipt, STORES: STORES, parseOFF: parseOFF, validEan: validEan };
  root.Calc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
