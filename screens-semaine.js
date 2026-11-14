/* Écrans : semaine (planning), liste de courses du foyer, stock cuisine. */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, Store = A.Store, $ = A.$, $$ = A.$$, esc = A.esc, fmt = A.fmt, euro = A.euro, g = A.g, enc = A.enc;
  var JOURS = [['lun', 'Lundi'], ['mar', 'Mardi'], ['mer', 'Mercredi'], ['jeu', 'Jeudi'], ['ven', 'Vendredi'], ['sam', 'Samedi'], ['dim', 'Dimanche']];
  var SLOTS = [['matin', 'Matin'], ['midi', 'Midi'], ['collation', 'Collation'], ['soir', 'Soir']];

  function weekSwitch(week) {
    var w0 = A.weekKey(0), w1 = A.weekKey(1);
    return '<div class="seg" role="tablist">' +
      '<button class="seg-b' + (week === w0 ? ' on' : '') + '" data-week="' + w0 + '" role="tab" aria-selected="' + (week === w0) + '">Cette semaine</button>' +
      '<button class="seg-b' + (week === w1 ? ' on' : '') + '" data-week="' + w1 + '" role="tab" aria-selected="' + (week === w1) + '">Semaine prochaine</button></div>' +
      '<p class="muted small center">' + esc(A.weekLabel(week).split(' · ')[1]) + '</p>';
  }
  function bindWeek(el) { $$('[data-week]', el).forEach(function (b) { b.onclick = function () { Store.set('week', b.getAttribute('data-week')); A.render(); }; }); }

  /* ================= Semaine ================= */
  A.route(/^#\/semaine$/, function () {
    var week = A.curWeek(), rows = A.myRows(week);
    var recipes = (S.data.recipes || []).filter(function (r) { return !A.excluded(r); });
    var count = {}; rows.forEach(function (r) { if (!r.reste && !r.cooked) count[r.recipe] = (count[r.recipe] || 0) + 1; });
    var speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var fm = A.foyerMeals(week), others = fm.meals.filter(function (m) { return !m.mine; });
    var p = A.prof(), defMeals = Math.min(28, ((p && C.num(p.repas)) || 3) * 7);
    var showGrid = Store.get('weekGrid', false);
    var byDay = {};
    rows.forEach(function (r) { if (r.day) (byDay[r.day] = byDay[r.day] || []).push(r); });
    var html = '<section class="screen"><h1>Ma semaine</h1>' + weekSwitch(week) +
      '<div class="panel"><div class="panel-title">Mes repas (' + rows.length + ')</div>' +
      (rows.length ? '<ul class="meals">' + rows.map(function (r, i) {
        var rec = A.recipeByName(r.recipe);
        return '<li class="' + (r.cooked ? 'done' : '') + '"><div class="meal-name"><a href="#/recette/' + enc(r.recipe) + '">' + esc(r.recipe) + '</a>' +
          (r.reste ? ' <span class="badge">reste</span>' : '') + (r.cooked ? ' <span class="badge ok">cuisiné</span>' : '') +
          (!rec ? ' <span class="badge warn">supprimée</span>' : '') + '<small>' + fmt(r.kcal) + ' kcal' + (r.version ? ' · version modifiée' : '') + '</small></div>' +
          '<div class="meal-when"><select data-day="' + i + '" aria-label="Jour"><option value="">Jour…</option>' +
          JOURS.map(function (j) { return '<option value="' + j[0] + '"' + (r.day === j[0] ? ' selected' : '') + '>' + j[1] + '</option>'; }).join('') + '</select>' +
          '<select data-slot="' + i + '" aria-label="Moment"><option value="">Moment…</option>' +
          SLOTS.map(function (s) { return '<option value="' + s[0] + '"' + (r.slot === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' +
          '<button class="btn ghost step" data-del="' + i + '" aria-label="Retirer ce repas">✕</button></div></li>';
      }).join('') + '</ul>' : '<p class="muted">Aucun repas prévu. Ajoute des recettes ci-dessous, dicte ta semaine ou demande une proposition.</p>') +
      (rows.length ? '<label class="toggle"><input type="checkbox" id="w-grid"' + (showGrid ? ' checked' : '') + '> Voir par jour</label>' : '') +
      (showGrid && rows.length ? '<table class="grid-week"><tbody>' + JOURS.map(function (j) {
        var list = byDay[j[0]] || [];
        return '<tr><th>' + j[1].slice(0, 3) + '</th><td>' + (list.length ? list.map(function (r) {
          return '<span class="chip">' + esc((r.slot ? r.slot + ' · ' : '') + r.recipe) + '</span>';
        }).join(' ') : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '<tr><th>?</th><td>' + rows.filter(function (r) { return !r.day; }).map(function (r) { return '<span class="chip">' + esc(r.recipe) + '</span>'; }).join(' ') + '</td></tr></tbody></table>' : '') +
      (rows.length ? '<button class="btn ghost small" id="w-clear">Vider ma semaine</button>' : '') + '</div>' +
      '<div class="panel"><div class="panel-title">Propose-moi une semaine</div>' +
      '<div class="row"><label class="field grow"><span>Nombre de repas</span><input id="w-n" type="number" inputmode="numeric" min="1" max="42" value="' + defMeals + '"></label>' +
      '<button class="btn primary" id="w-auto">Proposer</button></div>' +
      '<p class="muted small">D’après tes favoris, les notes, tes exclusions, et en variant les recettes. Les repas déjà cuisinés sont gardés.</p></div>' +
      '<div class="panel"><div class="panel-title">Dicter ou écrire</div>' +
      '<textarea id="w-text" rows="2" placeholder="ex. trois soirs poulet riz, deux soirs tacos">' + esc(Store.get(A.pk('planText'), '')) + '</textarea>' +
      '<div class="row wrap">' + (speech ? '<button class="btn" id="w-mic">🎤 Dicter</button>' : '') +
      '<button class="btn" id="w-parse">Ajouter au planning</button></div></div>' +
      '<div class="panel"><div class="panel-title">Ajouter des recettes (nombre de repas)</div>' +
      recipes.map(function (r) {
        var n = count[r.name] || 0;
        return '<div class="plan-row' + (n ? ' on' : '') + '"><a href="#/recette/' + enc(r.name) + '">' + esc(r.name) +
          '<span class="muted small">' + fmt(A.chosenKcal(r)) + ' kcal / repas</span></a>' +
          '<div class="stepper small"><button class="btn step" data-m="-1" data-r="' + esc(r.name) + '" aria-label="Un repas de moins">−</button>' +
          '<output>' + n + '</output><button class="btn step" data-m="1" data-r="' + esc(r.name) + '" aria-label="Un repas de plus">+</button></div></div>';
      }).join('') + '</div>' +
      (S.data.foyer ? '<p class="muted center">Foyer « ' + esc(S.data.foyer.name) + ' » : ' + others.length + ' repas des autres membres' +
        (fm.fetchedAt ? '' : ' (pas encore chargés)') + '.</p>' : '') +
      '<div class="actions"><a class="btn primary big" href="#/courses">Liste de courses</a>' +
      '<a class="btn big" href="#/session">Session de cuisine</a></div></section>';
    return { tab: 'semaine', html: html, bind: function (el) {
      bindWeek(el);
      var upd = function (fn) { var rs = A.myRows(week).map(function (x) { return Object.assign({}, x); }); fn(rs); A.setMyRows(week, rs); A.render(); };
      $$('[data-day]', el).forEach(function (s) { s.onchange = function () { upd(function (rs) { rs[Number(s.getAttribute('data-day'))].day = s.value; }); }; });
      $$('[data-slot]', el).forEach(function (s) { s.onchange = function () { upd(function (rs) { rs[Number(s.getAttribute('data-slot'))].slot = s.value; }); }; });
      $$('[data-del]', el).forEach(function (b) { b.onclick = function () { upd(function (rs) { rs.splice(Number(b.getAttribute('data-del')), 1); }); }; });
      $$('[data-m]', el).forEach(function (b) {
        b.onclick = function () {
          var name = b.getAttribute('data-r'), d = Number(b.getAttribute('data-m'));
          upd(function (rs) {
            if (d > 0) { rs.push(A.newRow(name)); return; }
            for (var i = rs.length - 1; i >= 0; i--) if (rs[i].recipe === name && !rs[i].reste && !rs[i].cooked) { rs.splice(i, 1); return; }
          });
        };
      });
      var gr = $('#w-grid', el); if (gr) gr.onchange = function () { Store.set('weekGrid', gr.checked); A.render(); };
      var cl = $('#w-clear', el);
      if (cl) cl.onclick = function () { if (confirm('Retirer tous les repas non cuisinés de cette semaine ?')) upd(function (rs) { for (var i = rs.length - 1; i >= 0; i--) if (!rs[i].cooked) rs.splice(i, 1); }); };
      $('#w-auto', el).onclick = function () {
        var n = C.num($('#w-n', el).value) || defMeals;
        var avis = {};
        recipes.forEach(function (r) { var a = A.avisOf(r.name) || {}, m = A.myAvis(r.name); avis[r.name] = { fav: m.fav, note: m.note, avg: a.avg }; });
        var pm = A.perMeal();
        var plan = C.autoPlan(recipes, { meals: n, avis: avis, seed: Date.now() % 233280,
          ok: function (r) { var a = C.adjust(r, S.idx, { kcal: A.chosenKcal(r), protRef: pm.prot, margin: pm.margin }); return a.status === 'ok'; } });
        if (!plan.length) { A.toast('Aucune recette ne tient tes kcal : ajuste tes objectifs ou les recettes.'); return; }
        var kept = A.myRows(week).filter(function (r) { return r.cooked || r.reste; });
        var rs = kept.slice();
        plan.forEach(function (x) { for (var i = 0; i < x.meals; i++) rs.push(A.newRow(x.recipe)); });
        A.setMyRows(week, rs); A.toast(n + ' repas proposés. Modifie-les à ta guise.'); A.render();
      };
      $('#w-parse', el).onclick = function () {
        var txt = $('#w-text', el).value; Store.set(A.pk('planText'), txt);
        var res = C.parsePlan(txt, recipes);
        if (!res.items.length) { A.toast('Aucune recette reconnue. Écris par exemple « 3 soirs poulet riz ».'); return; }
        upd(function (rs) { res.items.forEach(function (it) { for (var i = 0; i < it.meals; i++) rs.push(A.newRow(it.recipe)); }); });
        A.toast(res.unknown.length ? 'Non reconnu : ' + res.unknown.join(' / ') : 'Ajouté au planning');
      };
      var mic = $('#w-mic', el); if (mic) mic.onclick = function () { A.dictate($('#w-text', el), mic); };
      if (S.data.foyer && navigator.onLine && !(S.fw && S.fw[week])) A.fetchFoyerWeek(week).then(function () { if (location.hash === '#/semaine') A.render(); }, function () {});
    } };
  });

  /* ================= Courses ================= */
  function listFor(week) {
    var fm = A.foyerMeals(week);
    var need = C.needsFromMeals(fm.meals);
    var useStock = Store.get('useStock', true);
    var L = C.foyerList(need, S.idx, { offers: S.data.offers || [], stock: A.stockMap(), useStock: useStock });
    L.meals = fm.meals.filter(function (m) { return !m.cooked && !m.reste; }).length;
    L.fetchedAt = fm.fetchedAt; L.warnings = fm.warnings || [];
    return L;
  }
  function checkedOf(week) { var c = (S.data.checks || {})[week]; return (c && c.checked) || []; }
  function setChecked(week, list) {
    S.data.checks = S.data.checks || {};
    S.data.checks[week] = Object.assign({}, S.data.checks[week], { checked: list });
    A.saveData();
    A.Sync.push('checks:' + week, 'saveChecks', { week: week, checked: list });
  }
  function qtyText(l) { return l.packs ? l.packs + ' × ' + g(l.packSize) : g(l.buy); }

  A.route(/^#\/courses$/, function () {
    var week = A.curWeek(), L = listFor(week), useStock = Store.get('useStock', true);
    var checked = checkedOf(week), isC = {}; checked.forEach(function (n) { isC[n] = 1; });
    var done = ((S.data.checks || {})[week] || {}).done;
    var groups = {};
    L.lines.forEach(function (l) { (groups[l.rayon] = groups[l.rayon] || []).push(l); });
    var toBuy = L.lines.filter(function (l) { return l.buy > 0; });
    var left = toBuy.filter(function (l) { return !isC[l.name]; }).length;
    var html = '<section class="screen"><h1>Courses</h1>' + weekSwitch(week) +
      '<p class="muted">' + L.meals + ' repas' + (S.data.foyer ? ' du foyer « ' + esc(S.data.foyer.name) + ' »' : '') +
      (S.data.foyer ? (L.fetchedAt ? ' · repas des autres du ' + esc(A.dateFr(L.fetchedAt)) : ' · repas des autres pas encore chargés') : '') + '</p>' +
      (S.data.foyer ? '<button class="btn ghost small" id="l-fw">Actualiser les repas du foyer</button>' : '') +
      (done ? '<div class="notice">Courses terminées le ' + esc(A.dayFr(done)) + ' : le coché a été ajouté au stock.</div>' : '') +
      '<label class="toggle"><input type="checkbox" id="l-stock"' + (useStock ? ' checked' : '') + '> Retrancher le stock cuisine</label>' +
      (L.lines.length ? '<p class="muted small">Touche <b>€</b> sur un article pour noter son prix (à la main ou en photo de l’étiquette), ou ' +
        '<a href="#/ticket">lis ton ticket de caisse</a> après les courses.</p>' : '') +
      (L.warnings.length ? '<div class="notice warn">' + L.warnings.map(esc).join('<br>') + '</div>' : '') +
      (!L.lines.length ? '<p>Rien à acheter. <a href="#/semaine">Remplir le planning</a>.</p>' : '') +
      C.RAYONS.filter(function (r) { return groups[r]; }).map(function (r) {
        return '<h2 class="rayon">' + esc(r.charAt(0).toUpperCase() + r.slice(1)) + '</h2><ul class="shop">' + groups[r].map(function (l) {
          var on = !!isC[l.name], none = l.buy <= 0;
          return '<li class="shop-line' + (on ? ' done' : '') + (none ? ' none' : '') + '"><label>' +
            '<input type="checkbox" data-c="' + esc(l.name) + '"' + (on || none ? ' checked' : '') + (none ? ' disabled' : '') + '>' +
            '<span class="s-name">' + esc(l.name) + (l.stock > 0 ? '<small>besoin ' + g(l.need) + ' − stock ' + g(l.stock) + '</small>' : '') +
            (l.packs ? '<small>pour ' + g(l.buy) + '</small>' : '') +
            (l.magasin && l.magasin !== 'Exemple' && l.magasin !== 'Démo' ? '<small>' + esc(l.magasin) + '</small>' : '') + '</span>' +
            '<span class="s-qty">' + (none ? 'en stock' : qtyText(l)) + '<small>' + (none ? '' : (l.cost === null ? '<span class="warn-text">prix manquant</span>' : euro(l.cost))) + '</small></span>' +
            '</label><button class="btn ghost price-btn" data-price="' + esc(l.name) + '" aria-label="Noter le prix de ' + esc(l.name) + '">€</button></li>' +
            (S.priceFor === l.name ? '<li class="price-form">' + priceForm(l) + '</li>' : '');
        }).join('') + '</ul>';
      }).join('') +
      (L.lines.length ? '<div class="total"><span>Total estimé</span><b>' + euro(L.total) + '</b></div>' +
        (L.missingPrice.length ? '<p class="warn-text">+ ' + L.missingPrice.length + ' article(s) sans prix, non comptés : ' + L.missingPrice.map(esc).join(', ') + '</p>' : '') +
        '<p class="muted center">' + left + ' article(s) restant(s)</p>' +
        '<div class="actions"><button class="btn primary big" id="l-finish"' + (checked.length ? '' : ' disabled') + '>J’ai fini mes courses</button>' +
        '<p class="muted small center">Ajoute ce qui est coché au stock' + (S.data.foyer ? ' du foyer' : '') + ' et remet la liste à zéro.</p>' +
        '<a class="btn big" href="#/ticket">🧾 Ticket de caisse : relever les prix</a>' +
        '<button class="btn big" id="l-share">Partager la liste</button>' +
        '<button class="btn ghost" id="l-uncheck">Tout décocher</button></div>' : '') + '</section>';
    return { tab: 'courses', html: html, bind: function (el) {
      bindWeek(el);
      $$('[data-c]', el).forEach(function (cb) {
        cb.onchange = function () {
          var n = cb.getAttribute('data-c'), list = checkedOf(week).filter(function (x) { return x !== n; });
          if (cb.checked) list.push(n);
          setChecked(week, list); A.render();
        };
      });
      $('#l-stock', el).onchange = function (e) { Store.set('useStock', e.target.checked); A.render(); };
      $$('[data-price]', el).forEach(function (b) {
        b.onclick = function () { var n = b.getAttribute('data-price'); S.priceFor = S.priceFor === n ? null : n; A.render(); };
      });
      bindPriceForm(el);
      var fw = $('#l-fw', el); if (fw) fw.onclick = function () { A.act('lecture des repas du foyer', async function () { await A.fetchFoyerWeek(week); A.render(); A.toast('Liste à jour'); }); };
      var un = $('#l-uncheck', el); if (un) un.onclick = function () { setChecked(week, []); A.render(); };
      var fin = $('#l-finish', el);
      if (fin) fin.onclick = function () {
        var items = toBuy.filter(function (l) { return isC[l.name]; }).map(function (l) { return { ing: l.name, qty: Math.round(l.bought || l.buy) }; });
        if (!confirm('Ajouter ' + items.length + ' article(s) au stock et terminer les courses ?')) return;
        items.forEach(function (it) { A.addLocalStock(it.ing, it.qty); });
        S.data.checks[week] = { checked: [], done: C.isoDay(new Date()) }; A.saveData();
        A.Sync.queue().filter(function (x) { return x.key === 'checks:' + week; }).length && A.Store.set('queue', A.Sync.queue().filter(function (x) { return x.key !== 'checks:' + week; }));
        A.Sync.push(null, 'finishShopping', { week: week, items: items });
        A.toast('Stock mis à jour'); A.render();
      };
      var sh = $('#l-share', el);
      if (sh) sh.onclick = function () {
        var txt = 'Courses — ' + A.weekLabel(week) + '\n' + C.RAYONS.filter(function (r) { return groups[r]; }).map(function (r) {
          var ls = groups[r].filter(function (l) { return l.buy > 0 && !isC[l.name]; });
          return ls.length ? '\n' + r.toUpperCase() + '\n' + ls.map(function (l) { return '☐ ' + l.name + ' : ' + qtyText(l) + (l.magasin && l.magasin !== 'Exemple' && l.magasin !== 'Démo' ? ' (' + l.magasin + ')' : ''); }).join('\n') : '';
        }).join('\n') + '\n\nTotal estimé : ' + euro(L.total);
        if (navigator.share) navigator.share({ title: 'Liste de courses', text: txt }).catch(function () {});
        else A.copyText(txt).then(function () { A.toast('Liste copiée : colle-la dans WhatsApp ou un SMS'); });
      };
      if (S.data.foyer && navigator.onLine && !(S.fw && S.fw[week])) A.fetchFoyerWeek(week).then(function () { if (location.hash === '#/courses') A.render(); }, function () {});
    } };
  });

  /* ================= Prix relevés pendant les courses ================= */
  function knownStores() {
    var s = {}; (S.data.offers || []).forEach(function (o) { if (o.magasin) s[o.magasin] = 1; });
    C.STORES.forEach(function (x) { s[x] = 1; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  }
  function storeList() { return '<datalist id="stores">' + knownStores().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>'; }
  function offerFor(ing, mag) { return (S.data.offers || []).filter(function (o) { return o.ing === ing && (!mag || C.norm(o.magasin) === C.norm(mag)); })[0]; }

  function priceForm(l) {
    var mag = Store.get('lastStore', ''), o = offerFor(l.name, mag) || offerFor(l.name);
    var pack = l.packSize || (o && o.pack) || Math.max(1, Math.round(l.buy || 0)) || '';
    return '<div class="pf"><div class="panel-title">Prix de ' + esc(l.name) + '</div>' +
      A.field('Magasin', '<input id="pf-mag" list="stores" autocomplete="off" value="' + esc(mag) + '" placeholder="ex. Lidl">') + storeList() +
      '<div class="grid2">' + A.field('Contenance (g)', '<input id="pf-pack" type="number" inputmode="numeric" value="' + esc(pack) + '">') +
      A.field('Prix payé (€)', A.numIn('pf-prix', '', ' placeholder="ex. 2,49"')) + '</div>' +
      '<label class="btn ghost file"><input type="file" accept="image/*" capture="environment" id="pf-photo">📷 Photo de l’étiquette</label><div id="pf-out"></div>' +
      '<div class="row wrap"><button class="btn primary" id="pf-save" data-ing="' + esc(l.name) + '">' + (A.isAdmin() ? 'Enregistrer le prix' : 'Envoyer le prix') + '</button>' +
      '<button class="btn ghost" id="pf-cancel">Annuler</button></div></div>';
  }
  // Admin : appliqué tout de suite ; sinon : proposé à l'admin. Marche hors ligne (envoyé plus tard).
  function sendPrices(offers, title) {
    offers = offers.filter(function (o) { return o.ing && o.magasin && o.pack > 0 && o.prix > 0; });
    if (!offers.length) { A.toast('Rien à envoyer : vérifie magasin, contenance et prix.'); return false; }
    Store.set('lastStore', offers[0].magasin);
    if (A.isAdmin()) {
      S.data.offers = (S.data.offers || []).filter(function (x) {
        return !offers.some(function (o) { return o.ing === x.ing && C.norm(o.magasin) === C.norm(x.magasin); });
      }).concat(offers.map(function (o) { return Object.assign({ date: C.isoDay(new Date()) }, o); }));
      A.saveData();
    }
    A.Sync.push(null, 'propose', { type: 'prix', title: title, data: { offers: offers } });
    A.toast(A.isAdmin() ? offers.length + ' prix enregistré(s)' : offers.length + ' prix envoyé(s) à l’admin. Merci !');
    return true;
  }
  function readPriceText(text) {
    var flat = String(text || '').replace(/\s+/g, ' ');
    var p = flat.match(/(\d+[.,]\d{2})\s*€/) || flat.match(/€\s*(\d+[.,]\d{2})/), w = flat.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
    return { prix: p ? p[1] : null, pack: w ? Math.round(C.num(w[1]) * (/kg/i.test(w[2]) ? 1000 : 1)) : null };
  }
  function bindPriceForm(el) {
    var save = $('#pf-save', el); if (!save) return;
    $('#pf-cancel', el).onclick = function () { S.priceFor = null; A.render(); };
    $('#pf-photo', el).onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      A.act('lecture d’une étiquette de prix', async function () {
        var img = await A.shrink(f, 1600, 0.85);
        var r = await A.Api.call('ocr', { token: S.token, image: img.b64, mime: 'image/jpeg', kind: 'prix' });
        var v = readPriceText(r.text);
        if (v.prix) $('#pf-prix', el).value = v.prix;
        if (v.pack) $('#pf-pack', el).value = v.pack;
        $('#pf-out', el).innerHTML = '<div class="notice' + (v.prix ? '' : ' warn') + '">' + (v.prix ? 'Lu : ' + esc(v.prix) + ' €' + (v.pack ? ' pour ' + g(v.pack) : '') + '. Vérifie.' : 'Prix non trouvé : saisis-le à la main.') + '</div>';
      });
    };
    save.onclick = function () {
      var o = { ing: save.getAttribute('data-ing'), magasin: $('#pf-mag', el).value.trim(), pack: C.num($('#pf-pack', el).value), prix: C.num($('#pf-prix', el).value) };
      if (!o.magasin || !o.pack || !o.prix) { A.toast('Magasin, contenance et prix sont obligatoires.'); return; }
      if (sendPrices([o], o.ing + ' — ' + o.magasin)) { S.priceFor = null; A.render(); }
    };
  }

  /* ---------- Ticket de caisse : photo ou fichier (image ou PDF) ---------- */
  function fileB64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(A.Api.ApiError('Fichier illisible.', 'PHOTO')); };
      fr.readAsDataURL(file);
    });
  }
  A.route(/^#\/ticket$/, function () {
    var R = S.receipt;
    var ings = (S.data.ingredients || []).map(function (i) { return i.name; }).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
    var opts = function (cur) { return '<option value="">— ignorer —</option>' + ings.map(function (n) { return '<option' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); };
    var html = '<section class="screen"><a class="back" href="#/courses">‹ Courses</a><h1>Ticket de caisse</h1>' +
      '<p class="muted">L’appli lit le ticket (gratuit, via Google) et propose un prix par article reconnu. Tu vérifies avant d’envoyer.' +
      (A.isAdmin() ? '' : ' L’admin valide ensuite les prix.') + '</p>' +
      '<div class="stack"><label class="btn primary big file"><input type="file" accept="image/*" capture="environment" id="t-cam">📷 Photographier le ticket</label>' +
      '<label class="btn big file"><input type="file" accept="image/*,application/pdf" id="t-file">📎 Joindre un ticket (photo ou PDF)</label></div>' +
      '<div id="t-out"></div>' +
      (R ? '<div class="panel"><div class="panel-title">' + R.items.length + ' article(s) lu(s)</div>' +
        A.field('Magasin', '<input id="t-mag" list="stores" autocomplete="off" value="' + esc(R.magasin || Store.get('lastStore', '')) + '">') + storeList() +
        (R.items.length ? R.items.map(function (it, i) {
          return '<div class="receipt-row"><div class="muted small">« ' + esc(it.label) + ' »</div>' +
            '<select data-ri="' + i + '" aria-label="Ingrédient correspondant">' + opts(it.ing) + '</select>' +
            '<div class="row"><label class="field grow"><span>Contenance (g)</span><input type="number" inputmode="numeric" data-rp="' + i + '" value="' + esc(it.pack || '') + '"></label>' +
            '<label class="field grow"><span>Prix (€)</span>' + A.numIn('rx-' + i, it.prix, ' data-rx="' + i + '"') + '</label></div></div>';
        }).join('') + '<button class="btn primary big" id="t-send">' + (A.isAdmin() ? 'Enregistrer les prix' : 'Envoyer les prix à l’admin') + '</button>'
          : '<p>Aucun article avec un prix n’a été reconnu. Réessaie avec une photo plus nette, à plat.</p>') +
        (R.text ? '<details><summary>Texte lu sur le ticket</summary><pre>' + esc(R.text) + '</pre></details>' : '') + '</div>' : '') + '</section>';
    return { tab: 'courses', html: html, bind: function (el) {
      var read = async function (file) {
        if (!file) return;
        if (!navigator.onLine) { A.showError(A.Api.ApiError('La lecture du ticket demande du réseau. Garde la photo et réessaie plus tard.', 'HORS_LIGNE')); return; }
        var pdf = file.type === 'application/pdf';
        if (pdf && file.size > 5e6) { A.toast('PDF trop lourd (5 Mo maximum).'); return; }
        $('#t-out', el).innerHTML = '<p class="muted">Lecture du ticket…</p>';
        A.act('lecture d’un ticket de caisse', async function () {
          var b64 = pdf ? await fileB64(file) : (await A.shrink(file, 2200, 0.85)).b64;
          var r = await A.Api.call('ocr', { token: S.token, image: b64, mime: pdf ? 'application/pdf' : 'image/jpeg', kind: 'ticket' });
          var p = C.parseReceipt(r.text, S.data.ingredients);
          S.receipt = { magasin: p.magasin, items: p.items, text: r.text };
          A.render();
        });
      };
      $('#t-cam', el).onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; read(f); };
      $('#t-file', el).onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; read(f); };
      var send = $('#t-send', el);
      if (send) send.onclick = function () {
        var mag = $('#t-mag', el).value.trim();
        if (!mag) { A.toast('Indique le magasin.'); return; }
        var offers = R.items.map(function (it, i) {
          return { ing: $('[data-ri="' + i + '"]', el).value, magasin: mag, pack: C.num($('[data-rp="' + i + '"]', el).value), prix: C.num($('[data-rx="' + i + '"]', el).value) };
        }).filter(function (o) { return o.ing; });
        var missing = offers.filter(function (o) { return !o.pack || !o.prix; }).length;
        if (missing && !confirm(missing + ' article(s) sans contenance ou prix seront ignorés. Continuer ?')) return;
        if (sendPrices(offers, 'Ticket ' + mag + ' (' + offers.length + ' prix)')) { S.receipt = null; A.go('#/courses'); }
      };
    } };
  });

  /* ================= Stock ================= */
  // Une ligne par ingrédient du catalogue, rangée par rayon ; chaque quantité s'enregistre dès qu'on la change.
  function setStockLocal(items) {
    var st = S.data.stock = S.data.stock || [];
    items.forEach(function (it) {
      var rows = st.filter(function (s) { return s.ing === it.ing; });
      if (rows.length) { rows[0].qty = it.qty; rows[0].date = C.isoDay(new Date()); rows.slice(1).forEach(function (r) { st.splice(st.indexOf(r), 1); }); }
      else st.push({ ing: it.ing, qty: it.qty, date: C.isoDay(new Date()) });
      A.Sync.push('stock:' + it.ing, 'setStock', { items: [{ ing: it.ing, qty: it.qty }] });
    });
    A.saveData();
  }

  A.route(/^#\/stock$/, function () {
    var have = A.stockMap(), dates = {};
    (S.data.stock || []).forEach(function (s) { if (s.date && (!dates[s.ing] || s.date > dates[s.ing])) dates[s.ing] = s.date; });
    var only = Store.get('stockOnly', false), q = Store.get('stockQ', '');
    var groups = {}, n = 0;
    (S.data.ingredients || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).forEach(function (i) {
      var qty = Math.round(have[i.name] || 0);
      if (only && !qty) return;
      (groups[C.rayonOf(i)] = groups[C.rayonOf(i)] || []).push({ name: i.name, qty: qty, date: dates[i.name] });
      if (qty) n++;
    });
    // Ingrédients en stock qui ne sont plus au catalogue : gardés à part.
    Object.keys(have).forEach(function (k) { if (!C.find(S.idx, k) && have[k] > 0) (groups.autre = groups.autre || []).push({ name: k, qty: Math.round(have[k]), date: dates[k], gone: true }); });
    var speech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var html = '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Stock cuisine</h1>' +
      '<p class="muted">' + (S.data.foyer ? 'Commun au foyer « ' + esc(S.data.foyer.name) + ' ».' : 'Ton stock.') +
      ' Quantités en grammes, enregistrées dès que tu les changes. Le stock baisse quand un repas est cuisiné et monte quand tu termines tes courses.</p>' +
      '<input id="st-q" class="search" type="search" placeholder="Rechercher un ingrédient" value="' + esc(q) + '" aria-label="Rechercher">' +
      '<label class="toggle"><input type="checkbox" id="st-only"' + (only ? ' checked' : '') + '> Seulement ce que j’ai (' + n + ')</label>' +
      C.RAYONS.filter(function (r) { return groups[r]; }).map(function (r) {
        return '<h2 class="rayon">' + esc(r.charAt(0).toUpperCase() + r.slice(1)) + '</h2><ul class="shop">' + groups[r].map(function (it) {
          return '<li class="stock-li' + (it.qty ? ' has' : '') + '" data-name="' + esc(it.name) + '"><div class="stock-row">' +
            '<span class="s-name">' + esc(it.name) + '<small>' + (it.gone ? 'n’est plus au catalogue · ' : '') + (it.date && it.qty ? 'màj ' + esc(A.dayFr(it.date)) : (it.qty ? '' : 'pas en stock')) + '</small></span>' +
            '<input type="number" inputmode="numeric" min="0" class="qty-in" data-ing="' + esc(it.name) + '" value="' + (it.qty || '') + '" placeholder="0" aria-label="Stock de ' + esc(it.name) + ' en g"></div></li>';
        }).join('') + '</ul>';
      }).join('') +
      (only && !n ? '<p>Rien en stock pour l’instant.</p>' : '') +
      '<div class="panel"><div class="panel-title">Dire ou écrire ce que j’ai</div>' +
      '<textarea id="s-text" rows="2" placeholder="ex. 500 g de riz basmati cru, 1 kg de poulet"></textarea>' +
      '<div class="row wrap">' + (speech ? '<button class="btn" id="s-mic">🎤 Dicter</button>' : '') +
      '<button class="btn primary" id="s-parse">Mettre à jour le stock</button></div></div></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var inp = $('#st-q', el);
      var apply = function () {
        var v = C.norm(inp.value);
        $$('.stock-li', el).forEach(function (li) { li.hidden = v && C.norm(li.getAttribute('data-name')).indexOf(v) < 0; });
        $$('ul.shop', el).forEach(function (ul) {
          var any = $$('.stock-li', ul).some(function (li) { return !li.hidden; });
          ul.hidden = !any; ul.previousElementSibling.hidden = !any;
        });
      };
      inp.oninput = function () { Store.set('stockQ', inp.value); apply(); }; apply();
      $('#st-only', el).onchange = function (e) { Store.set('stockOnly', e.target.checked); A.render(); };
      $$('[data-ing]', el).forEach(function (i) {
        i.onchange = function () {
          var qty = Math.max(0, Math.round(C.num(i.value) || 0));
          setStockLocal([{ ing: i.getAttribute('data-ing'), qty: qty }]);
          i.closest('li').classList.toggle('has', qty > 0);
          A.toast(i.getAttribute('data-ing') + ' : ' + (qty ? g(qty) : 'plus en stock'));
        };
      });
      var mic = $('#s-mic', el); if (mic) mic.onclick = function () { A.dictate($('#s-text', el), mic); };
      $('#s-parse', el).onclick = function () {
        var res = C.parseStock($('#s-text', el).value, S.data.ingredients);
        if (!res.items.length) { A.toast('Rien reconnu. Écris par exemple « 500 g de riz basmati cru ».'); return; }
        setStockLocal(res.items.map(function (it) { return { ing: it.ing, qty: Math.round(it.qty) }; }));
        A.toast('Mis à jour : ' + res.items.map(function (x) { return x.ing + ' ' + g(x.qty); }).join(', ') + (res.unknown.length ? ' · non reconnu : ' + res.unknown.join(' / ') : ''));
        A.render();
      };
    } };
  });
})(window.App);
