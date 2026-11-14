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
      (L.warnings.length ? '<div class="notice warn">' + L.warnings.map(esc).join('<br>') + '</div>' : '') +
      (!L.lines.length ? '<p>Rien à acheter. <a href="#/semaine">Remplir le planning</a>.</p>' : '') +
      C.RAYONS.filter(function (r) { return groups[r]; }).map(function (r) {
        return '<h2 class="rayon">' + esc(r.charAt(0).toUpperCase() + r.slice(1)) + '</h2><ul class="shop">' + groups[r].map(function (l) {
          var on = !!isC[l.name], none = l.buy <= 0;
          return '<li class="' + (on ? 'done' : '') + (none ? ' none' : '') + '"><label>' +
            '<input type="checkbox" data-c="' + esc(l.name) + '"' + (on || none ? ' checked' : '') + (none ? ' disabled' : '') + '>' +
            '<span class="s-name">' + esc(l.name) + (l.stock > 0 ? '<small>besoin ' + g(l.need) + ' − stock ' + g(l.stock) + '</small>' : '') +
            (l.packs ? '<small>pour ' + g(l.buy) + '</small>' : '') +
            (l.magasin && l.magasin !== 'Exemple' && l.magasin !== 'Démo' ? '<small>' + esc(l.magasin) + '</small>' : '') + '</span>' +
            '<span class="s-qty">' + (none ? 'en stock' : qtyText(l)) + '<small>' + (none ? '' : (l.cost === null ? '<span class="warn-text">prix manquant</span>' : euro(l.cost))) + '</small></span>' +
            '</label></li>';
        }).join('') + '</ul>';
      }).join('') +
      (L.lines.length ? '<div class="total"><span>Total estimé</span><b>' + euro(L.total) + '</b></div>' +
        (L.missingPrice.length ? '<p class="warn-text">+ ' + L.missingPrice.length + ' article(s) sans prix, non comptés : ' + L.missingPrice.map(esc).join(', ') + '</p>' : '') +
        '<p class="muted center">' + left + ' article(s) restant(s)</p>' +
        '<div class="actions"><button class="btn primary big" id="l-finish"' + (checked.length ? '' : ' disabled') + '>J’ai fini mes courses</button>' +
        '<p class="muted small center">Ajoute ce qui est coché au stock' + (S.data.foyer ? ' du foyer' : '') + ' et remet la liste à zéro.</p>' +
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

  /* ================= Stock ================= */
  A.route(/^#\/stock$/, function () {
    var st = (S.data.stock || []).filter(function (s) { return C.num(s.qty) > 0 || s.ing; });
    var names = S.data.ingredients.map(function (i) { return i.name; });
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Stock cuisine</h1>' +
      '<p class="muted">' + (S.data.foyer ? 'Commun au foyer « ' + esc(S.data.foyer.name) + ' ».' : 'Ton stock.') + ' Il diminue quand tu marques un repas cuisiné et augmente quand tu termines tes courses.</p>' +
      (st.length ? '<ul class="shop">' + st.map(function (s, i) {
        return '<li><div class="stock-row"><span class="s-name">' + esc(s.ing) + '<small>' + (s.date ? 'mis à jour le ' + esc(A.dayFr(s.date)) : '') + '</small></span>' +
          '<input type="number" inputmode="numeric" class="qty-in" data-s="' + i + '" value="' + esc(Math.round(C.num(s.qty) || 0)) + '" aria-label="Quantité en g"></div></li>';
      }).join('') + '</ul>' : '<p>Stock vide.</p>') +
      '<div class="panel"><div class="panel-title">Ajouter ou dire ce que j’ai</div>' +
      '<textarea id="s-text" rows="2" placeholder="ex. 500 g de riz basmati cru, 1 kg de poulet"></textarea>' +
      '<div class="row wrap">' + ((window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button class="btn" id="s-mic">🎤 Dicter</button>' : '') +
      '<button class="btn" id="s-parse">Lire</button></div>' +
      '<div class="row"><input id="s-ing" list="ing-names" placeholder="Ingrédient (nom exact)" aria-label="Ingrédient"><input id="s-qty" type="number" inputmode="numeric" placeholder="g" class="qty-in" aria-label="Quantité en g"></div>' +
      '<datalist id="ing-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<button class="btn primary big" id="s-save">Enregistrer le stock</button></div></section>',
      bind: function (el) {
        var pending = {};
        $$('[data-s]', el).forEach(function (inp) { inp.onchange = function () { pending[st[Number(inp.getAttribute('data-s'))].ing] = C.num(inp.value) || 0; }; });
        var mic = $('#s-mic', el); if (mic) mic.onclick = function () { A.dictate($('#s-text', el), mic); };
        $('#s-parse', el).onclick = function () {
          var res = C.parseStock($('#s-text', el).value, S.data.ingredients);
          res.items.forEach(function (it) { pending[it.ing] = it.qty; });
          A.toast(res.items.length ? 'Lu : ' + res.items.map(function (x) { return x.ing + ' ' + x.qty + ' g'; }).join(', ') + '. Touche Enregistrer.' : 'Rien reconnu.');
        };
        $('#s-save', el).onclick = function () {
          var ing = $('#s-ing', el).value.trim(), q = C.num($('#s-qty', el).value);
          if (ing) {
            if (!C.find(S.idx, ing)) { A.toast('Ingrédient inconnu (le nom doit être exact).'); return; }
            if (q === null) { A.toast('Indique la quantité en g.'); return; }
            pending[ing] = q;
          }
          var items = Object.keys(pending).map(function (k) { return { ing: k, qty: pending[k] }; });
          if (!items.length) { A.toast('Aucun changement.'); return; }
          items.forEach(function (it) {
            var row = (S.data.stock = S.data.stock || []).filter(function (s) { return s.ing === it.ing; })[0];
            if (row) { row.qty = it.qty; row.date = C.isoDay(new Date()); } else S.data.stock.push({ ing: it.ing, qty: it.qty, date: C.isoDay(new Date()) });
          });
          A.saveData();
          A.Sync.push(null, 'setStock', { items: items });
          A.toast('Stock enregistré'); A.render();
        };
      } };
  });
})(window.App);
