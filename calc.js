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

    items.forEach(function (it, i) {
      var others = items.filter(function (_, j) { return j !== i; });
      var parts = split(others);
      var F = totals(parts.fix, idx), A = totals(parts.adj, idx);
      var candidates = idx.list.filter(function (c) {
        return !inRecipe[c.name] && (num(c.kcal) || 0) > 0 && roleOf(c) === it.role;
      });
      candidates.push(null); // null = retirer l'ingrédient
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
    // Une seule alternative par ingrédient de remplacement, 5 au maximum.
    var seen = {}, res = [];
    out.forEach(function (a) {
      var key = a.replaced + '>' + a.by;
      if (!seen[key] && res.length < 5) { seen[key] = true; res.push(a); }
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

  var api = { ROLES: ROLES, RAYONS: RAYONS, S_MIN: S_MIN, S_MAX: S_MAX, norm: norm, num: num, round: round,
    suggestRole: suggestRole, suggestRayon: suggestRayon, roleOf: roleOf, rayonOf: rayonOf,
    index: index, find: find, findLoose: findLoose, totals: totals, recipeTotals: recipeTotals,
    portionItems: portionItems, adjust: adjust, alternatives: alternatives, protStatus: protStatus,
    isRaw: isRaw, cookPlan: cookPlan, parsePlan: parsePlan, matchRecipe: matchRecipe, parseStock: parseStock,
    shoppingList: shoppingList, parseNutrition: parseNutrition, parsePrice: parsePrice };
  root.Calc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : this);
