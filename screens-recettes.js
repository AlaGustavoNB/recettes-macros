/* Écrans : catalogue de recettes, fiche recette (avis, photo, remplacements), cuisine, session batch. */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, Store = A.Store, $ = A.$, $$ = A.$$, esc = A.esc, fmt = A.fmt, euro = A.euro, g = A.g, enc = A.enc;

  /* ================= Catalogue ================= */
  function costPerPortion(r) { var t = A.C.recipeTotals(r, S.idx).portion; return t.missingPrice.length ? null : t.cost; }

  A.route(/^#\/recettes$/, function () {
    var f = Store.get('filters', { q: '', cat: '', obj: '', prepa: '', cout: '', fav: false, sort: 'nom' });
    var all = S.data.recipes || [];
    var hidden = all.filter(function (r) { return A.excluded(r); });
    var cats = {}; all.forEach(function (r) { if (r.categorie) cats[r.categorie] = 1; });
    var list = all.filter(function (r) {
      if (A.excluded(r)) return false;
      if (f.cat && r.categorie !== f.cat) return false;
      if (f.obj && r.objectif !== f.obj) return false;
      if (f.prepa && (C.num(r.prepa) || 0) + (C.num(r.cuisson) || 0) > Number(f.prepa)) return false;
      if (f.cout) { var c = costPerPortion(r); if (c === null || c > Number(f.cout)) return false; }
      if (f.fav && !A.myAvis(r.name).fav) return false;
      return true;
    });
    var key = {
      nom: function (r) { return 0; },
      note: function (r) { var a = A.avisOf(r.name); return -((a && a.avg) || 0); },
      protEuro: function (r) { var t = C.recipeTotals(r, S.idx).portion; return t.cost > 0 && !t.missingPrice.length ? -(t.p / t.cost) : 0; },
      kcal: function (r) { return C.recipeTotals(r, S.idx).portion.kcal; },
      cout: function (r) { var c = costPerPortion(r); return c === null ? 1e9 : c; }
    }[f.sort] || function () { return 0; };
    list.sort(function (a, b) { return (key(a) - key(b)) || ((A.myAvis(b.name).fav ? 1 : 0) - (A.myAvis(a.name).fav ? 1 : 0)) || a.name.localeCompare(b.name, 'fr'); });
    var active = ['cat', 'obj', 'prepa', 'cout'].filter(function (k) { return f[k]; }).length + (f.fav ? 1 : 0);
    var sel = function (id, cur, opts) {
      return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    };
    var html = '<section class="screen"><div class="row between"><h1>Recettes</h1>' +
      '<a class="btn small soft" href="#/proposer">' + (A.isAdmin() ? '+ Nouvelle recette' : '+ Proposer une recette') + '</a></div>' +
      '<p class="muted">' + esc(S.me.name) + ' · ' + fmt(A.perMeal().kcal) + ' kcal par repas</p>' +
      '<input id="r-search" class="search" type="search" placeholder="Rechercher une recette" value="' + esc(f.q) + '" aria-label="Rechercher">' +
      '<details class="filters"' + (active ? ' open' : '') + '><summary>Filtres et tri' + (active ? ' (' + active + ')' : '') + '</summary><div class="grid2">' +
      A.field('Catégorie', sel('f-cat', f.cat, [['', 'Toutes']].concat(Object.keys(cats).sort().map(function (c) { return [c, c]; })))) +
      A.field('Objectif', sel('f-obj', f.obj, [['', 'Tous'], ['Sèche', 'Sèche'], ['Maintien', 'Maintien'], ['Masse', 'Masse']])) +
      A.field('Temps total', sel('f-prepa', f.prepa, [['', 'Peu importe'], ['15', '≤ 15 min'], ['30', '≤ 30 min'], ['45', '≤ 45 min'], ['60', '≤ 1 h']])) +
      A.field('Coût / portion', sel('f-cout', f.cout, [['', 'Peu importe'], ['2', '≤ 2 €'], ['3', '≤ 3 €'], ['4', '≤ 4 €'], ['6', '≤ 6 €']])) +
      A.field('Trier par', sel('f-sort', f.sort, [['nom', 'Nom'], ['note', 'Meilleure note'], ['protEuro', 'Protéines par euro'], ['kcal', 'Moins de kcal'], ['cout', 'Moins cher']])) +
      '</div><label class="toggle"><input type="checkbox" id="f-fav"' + (f.fav ? ' checked' : '') + '> Mes favoris seulement</label>' +
      (active ? '<button class="btn ghost small" id="f-reset">Effacer les filtres</button>' : '') + '</details>' +
      (hidden.length ? '<p class="muted small">' + hidden.length + ' recette(s) masquée(s) selon tes allergies et exclusions (<a href="#/profil">modifier</a>).</p>' : '') +
      '<div id="r-list" class="stack">' + (list.length ? list.map(cardRecipe).join('') : '<p>Aucune recette ne correspond.</p>') + '</div></section>';
    return { tab: 'recettes', html: html, bind: function (el) {
      var save = function () {
        f = { q: $('#r-search', el).value, cat: $('#f-cat', el).value, obj: $('#f-obj', el).value, prepa: $('#f-prepa', el).value,
          cout: $('#f-cout', el).value, fav: $('#f-fav', el).checked, sort: $('#f-sort', el).value };
        Store.set('filters', f);
      };
      var inp = $('#r-search', el);
      var apply = function () {
        var v = C.norm(inp.value);
        $$('.card[data-name]', el).forEach(function (c) { c.hidden = v && C.norm(c.getAttribute('data-name')).indexOf(v) < 0; });
      };
      inp.oninput = function () { save(); apply(); }; apply();
      $$('select, #f-fav', el).forEach(function (s) { s.onchange = function () { save(); A.render(); }; });
      var rs = $('#f-reset', el); if (rs) rs.onclick = function () { Store.set('filters', { q: '', sort: f.sort }); A.render(); };
      A.wantPhotos(list.map(function (r) { return r.name; }));
    } };
  });

  function cardRecipe(r) {
    var t = C.recipeTotals(r, S.idx).portion, av = A.avisOf(r.name), mine = A.myAvis(r.name);
    var warn = t.missing.length ? '<span class="badge warn">Ingrédient introuvable</span>' : (t.missingPrice.length ? '<span class="badge warn">Prix manquant</span>' : '');
    return '<a class="card with-photo" href="#/recette/' + enc(r.name) + '" data-name="' + esc(r.name) + '">' + A.photoImg(r.name, 'thumb') +
      '<div class="card-body"><div class="card-title">' + (mine.fav ? '♥ ' : '') + esc(r.name) + '</div>' +
      '<div class="macros-inline"><b>' + fmt(t.kcal) + '</b> kcal · <b>' + fmt(t.p, 1) + '</b> g prot. · <b>' +
      (t.missingPrice.length ? '?' : euro(t.cost)) + '</b> / portion</div>' +
      '<div class="muted small">' + esc([r.categorie, r.objectif, (C.num(r.prepa) || C.num(r.cuisson)) ? ((C.num(r.prepa) || 0) + (C.num(r.cuisson) || 0)) + ' min' : ''].filter(Boolean).join(' · ')) +
      (av && av.avg ? ' · <span class="stars" aria-label="Note ' + av.avg + ' sur 5">' + A.stars(av.avg) + '</span> ' + fmt(av.avg, 1) + ' (' + av.n + ')' : '') + '</div>' + warn + '</div></a>';
  }

  /* ================= Fiche recette ================= */
  A.route(/^#\/recette\/(.+)$/, function (name) {
    var r = A.recipeByName(name);
    if (!r) return { html: '<section class="screen"><p>Recette introuvable.</p><a href="#/recettes" class="btn">Retour</a></section>' };
    var base = C.recipeTotals(r, S.idx), kcal = A.chosenKcal(r), a = A.adjusted(r, kcal), pm = A.perMeal();
    var av = A.avisOf(r.name) || { comments: [] }, mine = A.myAvis(r.name);
    var exc = A.excluded(r);
    var protBadge = a.protStatus === 'ok' ? '<span class="badge ok">Protéines dans la marge</span>' : a.protStatus === 'hors' ? '<span class="badge warn">Protéines hors marge</span>' : '';
    var needAlt = a.status === 'low' || a.status === 'high' || a.status === 'impossible';
    var alts = needAlt ? C.alternatives(r, S.idx, { kcal: kcal, margin: pm.margin }) : [];
    var repl = S.replaceFor && S.replaceFor.recipe === r.name ? S.replaceFor.item : null;
    var cands = repl ? C.replacementCandidates(r, S.idx, { kcal: kcal, margin: pm.margin }, repl) : [];
    var planned = A.myRows(A.curWeek()).filter(function (x) { return x.recipe === r.name && !x.reste; }).length;
    var html = '<section class="screen"><a class="back" href="#/recettes">‹ Recettes</a>' +
      A.photoImg(r.name, 'hero') +
      '<div class="row between"><h1 class="grow">' + esc(r.name) + '</h1>' +
      '<button class="btn ghost fav' + (mine.fav ? ' on' : '') + '" id="fav" aria-pressed="' + !!mine.fav + '" aria-label="Favori">' + (mine.fav ? '♥' : '♡') + '</button></div>' +
      '<p class="muted">' + esc([r.categorie, r.objectif, (r.portions || 1) + ' portion(s) dans la fiche',
        r.prepa ? 'prépa ' + r.prepa + ' min' : '', r.cuisson ? 'cuisson ' + r.cuisson + ' min' : ''].filter(Boolean).join(' · ')) +
      (av.avg ? ' · <span class="stars">' + A.stars(av.avg) + '</span> ' + fmt(av.avg, 1) + ' (' + av.n + ' avis)' : '') + '</p>' +
      (exc ? '<div class="notice warn">Contient un ingrédient que tu as exclu : ' + esc(exc) + '.</div>' : '') +
      A.macroTable(base.portion, 'Fiche, par portion') +
      '<div class="panel"><div class="panel-title">Mes kcal pour une portion</div>' +
      '<div class="stepper"><button class="btn step" data-k="-50" aria-label="Moins 50 kcal">−</button>' +
      '<input id="k-in" type="number" inputmode="numeric" value="' + Math.round(kcal) + '" aria-label="kcal par portion">' +
      '<button class="btn step" data-k="50" aria-label="Plus 50 kcal">+</button></div>' +
      '<div class="row wrap center"><button class="btn small ghost" id="k-fiche">Fiche (' + fmt(base.portion.kcal) + ')</button>' +
      (pm.kcal ? '<button class="btn small ghost" id="k-prof">Mon repas (' + fmt(pm.kcal) + ')</button>' : '') + '</div>' +
      (a.messages.length ? '<div class="notice ' + (a.status === 'variant' ? '' : 'warn') + '">' + a.messages.map(esc).join('<br>') +
        (a.status === 'variant' ? ' <button class="linkbtn" id="v-clear">Revenir à la recette</button>' : '') + '</div>' : '') +
      A.macroTable(a.totals, 'Ma portion recalculée') + protBadge +
      (pm.prot ? '<p class="muted small">Cible protéines par repas : ' + fmt(pm.prot, 0) + ' g ± ' + Math.round(pm.margin * 100) + ' %. Limite basse de cette recette : ' + fmt(a.minKcal) + ' kcal.</p>' : '') +
      '<table class="qty"><thead><tr><th>Ingrédient</th><th>Fiche</th><th>Moi</th></tr></thead><tbody>' +
      a.items.map(function (it) {
        return '<tr><td>' + esc(it.name) + '<br><span class="chip">' + esc(it.role) + (it.fixed ? ' · gardé' : ' · ajusté') + '</span>' +
          (a.status !== 'variant' ? ' <button class="linkbtn" data-repl="' + esc(it.name) + '">Remplacer</button>' : '') + '</td>' +
          '<td>' + (it.qty0 ? g(it.qty0) : '—') + '</td><td><b>' + g(it.qty) + '</b></td></tr>';
      }).join('') + '</tbody></table>' +
      (repl ? '<div class="panel inset"><div class="panel-title">Remplacer ' + esc(repl) + '</div>' +
        (cands.length ? cands.slice(0, 8).map(function (x, i) {
          return '<div class="alt-mini"><span class="grow"><b>' + esc(x.by) + '</b> ' + g(x.byQty) + ' · ' + fmt(x.after.kcal) + ' kcal · ' + fmt(x.after.p, 1) + ' g prot.</span>' +
            '<button class="btn small" data-cand="' + i + '">Choisir</button></div>';
        }).join('') : '<p class="muted">Aucun ingrédient du même rôle ne garde les mêmes kcal et protéines.</p>') +
        '<button class="btn ghost small" id="repl-close">Annuler</button></div>' : '') + '</div>' +
      (alts.length ? '<div class="panel"><div class="panel-title">Alternatives (mêmes protéines et kcal, ± ' + Math.round(pm.margin * 100) + ' %)</div>' +
        alts.map(function (x, i) { return altCard(x, i); }).join('') + '</div>' :
        (needAlt && a.status !== 'error' ? '<div class="notice">Aucune alternative trouvée dans les ingrédients. Change les kcal ou propose un ingrédient.</div>' : '')) +
      '<div class="actions"><a class="btn primary big" href="#/cuisine/' + enc(r.name) + '">Cuisiner</a>' +
      '<div class="row"><button class="btn big grow" id="to-week">Ajouter à ma semaine</button>' +
      (planned ? '<span class="badge ok">' + planned + ' prévu(s)</span>' : '') + '</div>' +
      (A.isAdmin() ? '<a class="btn ghost big" href="#/modifier-recette/' + enc(r.name) + '">Modifier les quantités (admin)</a>' : '') + '</div>' +
      (r.notes ? '<p class="muted">Notes : ' + esc(r.notes) + '</p>' : '') +
      '<div class="panel"><div class="panel-title">Mon avis</div>' +
      '<div class="rate" role="radiogroup" aria-label="Ma note">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="star' + ((mine.note || 0) >= n ? ' on' : '') + '" data-note="' + n + '" role="radio" aria-checked="' + (mine.note === n) + '" aria-label="' + n + ' sur 5">★</button>';
      }).join('') + '</div>' +
      '<textarea id="com" rows="2" maxlength="400" placeholder="Un conseil, une variante ? (visible par tous)">' + esc(mine.comment || '') + '</textarea>' +
      '<button class="btn" id="com-save">Publier mon commentaire</button></div>' +
      (av.comments && av.comments.length ? '<div class="panel"><div class="panel-title">Commentaires</div>' + av.comments.map(function (c) {
        return '<div class="comment"><b>' + esc(c.name) + '</b>' + (c.note ? ' <span class="stars">' + A.stars(c.note) + '</span>' : '') +
          ' <span class="muted small">' + esc(A.dayFr(c.date)) + '</span><p>' + esc(c.text) + '</p>' +
          (A.isAdmin() ? '<button class="linkbtn" data-delcom="' + esc(c.by) + '">Supprimer</button>' : '') + '</div>';
      }).join('') + '</div>' : '') +
      '<div class="panel"><div class="panel-title">Photo du plat</div>' +
      '<label class="btn ghost file"><input type="file" accept="image/*" id="ph-in">📷 ' + (A.isAdmin() ? 'Mettre une photo' : 'Proposer une photo') + '</label>' +
      (A.isAdmin() ? '' : '<p class="muted small">L’admin choisit la photo affichée.</p>') + '</div></section>';
    return { tab: 'recettes', html: html, bind: function (el) {
      A.wantPhotos([r.name]);
      var inp = $('#k-in', el);
      var setK = function (k) { k = Math.max(50, Math.round(k)); A.setChosenKcal(r, k); A.render(); };
      $$('[data-k]', el).forEach(function (b) { b.onclick = function () { setK((C.num(inp.value) || kcal) + Number(b.getAttribute('data-k'))); }; });
      inp.onchange = function () { setK(C.num(inp.value) || kcal); };
      $('#k-fiche', el).onclick = function () { setK(base.portion.kcal); };
      var kp = $('#k-prof', el); if (kp) kp.onclick = function () { setK(pm.kcal); };
      var vc = $('#v-clear', el); if (vc) vc.onclick = function () { A.setVariant(r, kcal, null, null); A.render(); };
      $$('[data-alt]', el).forEach(function (b) {
        b.onclick = function () { var x = alts[Number(b.getAttribute('data-alt'))]; A.setVariant(r, kcal, altLabel(x), x.items); A.toast('Version enregistrée pour toi'); A.render(); };
      });
      $$('[data-repl]', el).forEach(function (b) { b.onclick = function () { S.replaceFor = { recipe: r.name, item: b.getAttribute('data-repl') }; A.render(); }; });
      var rc = $('#repl-close', el); if (rc) rc.onclick = function () { S.replaceFor = null; A.render(); };
      $$('[data-cand]', el).forEach(function (b) {
        b.onclick = function () {
          var x = cands[Number(b.getAttribute('data-cand'))];
          A.setVariant(r, kcal, altLabel(x), x.items); S.replaceFor = null; A.toast('Ingrédient remplacé (pour toi)'); A.render();
        };
      });
      $('#to-week', el).onclick = function () {
        var w = A.curWeek(), rows = A.myRows(w).concat([A.newRow(r.name)]);
        A.setMyRows(w, rows); A.toast('Ajouté à ' + A.weekLabel(w).split(' · ')[0].toLowerCase()); A.render();
      };
      var sendAvis = function (av2, msg) {
        S.data.myAvis = S.data.myAvis || {}; S.data.myAvis[r.name] = Object.assign({}, A.myAvis(r.name), av2); A.saveData();
        A.Sync.push('avis:' + r.name + ':' + Object.keys(av2).join(','), 'setAvis', { recipe: r.name, avis: av2 });
        if (msg) A.toast(msg); A.render();
      };
      $('#fav', el).onclick = function () { sendAvis({ fav: !mine.fav }, mine.fav ? 'Retiré des favoris' : 'Ajouté aux favoris'); };
      $$('[data-note]', el).forEach(function (b) { b.onclick = function () { sendAvis({ note: Number(b.getAttribute('data-note')) }, 'Note enregistrée'); }; });
      $('#com-save', el).onclick = function () { sendAvis({ comment: $('#com', el).value.trim() }, 'Commentaire publié (visible après actualisation)'); };
      $$('[data-delcom]', el).forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Supprimer ce commentaire ?')) return;
          A.act('suppression d’un commentaire', async function () {
            await A.Api.call('deleteComment', { token: S.token, recipe: r.name, id: b.getAttribute('data-delcom') }); await A.refreshStrict(); A.toast('Commentaire supprimé');
          });
        };
      });
      $('#ph-in', el).onchange = function (e) {
        var file = e.target.files[0]; e.target.value = ''; if (!file) return;
        A.act('envoi d’une photo de recette', async function () {
          var img = await A.shrink(file, 640, 0.7, 44000);
          var res = await A.Api.call('propose', { token: S.token, type: 'photo', title: 'Photo : ' + r.name, data: { recipe: r.name, image: img.b64 } }, { tries: 2 });
          if (res.applied) { S.photos[r.name] = img.b64; Store.set('photo.' + r.name, img.b64); await A.refreshStrict(); A.toast('Photo mise en ligne'); }
          else A.toast('Photo envoyée à l’admin pour validation');
        });
      };
    } };
  });

  function altLabel(x) { return x.by ? 'remplacer ' + x.replaced + ' par ' + x.by : 'retirer ' + x.replaced; }
  function altCard(x, i) {
    var b = x.before, a = x.after;
    function row(l, k, d, u) { return '<tr><td>' + l + '</td><td>' + fmt(b[k], d) + u + '</td><td><b>' + fmt(a[k], d) + u + '</b></td></tr>'; }
    return '<div class="alt"><div class="alt-title">' + (x.by ? 'Remplacer <b>' + esc(x.replaced) + '</b> (' + g(x.replacedQty) + ') par <b>' + esc(x.by) + '</b> (' + g(x.byQty) + ')'
      : 'Retirer <b>' + esc(x.replaced) + '</b> (' + g(x.replacedQty) + ')') + '</div>' +
      '<table class="qty"><thead><tr><th></th><th>Avant</th><th>Après</th></tr></thead><tbody>' +
      '<tr class="removed"><td><s>' + esc(x.replaced) + '</s></td><td>' + g(x.replacedQty) + '</td><td><b>—</b></td></tr>' +
      x.items.map(function (it) { return '<tr><td>' + esc(it.name) + '</td><td>' + (it.isNew ? '—' : g(it.qty0)) + '</td><td><b>' + g(it.qty) + '</b></td></tr>'; }).join('') +
      row('kcal', 'kcal', 0, '') + row('Protéines', 'p', 1, ' g') + row('Glucides', 'g', 1, ' g') + row('Lipides', 'l', 1, ' g') +
      '</tbody></table><button class="btn" data-alt="' + i + '">Utiliser cette version</button></div>';
  }

  /* ================= Cuisine ================= */
  // Repas du foyer (semaine choisie) pour cette recette, pas encore cuisinés.
  function plannedMeals(name, week) {
    return A.foyerMeals(week).meals.filter(function (m) { return m.recipe === name && !m.cooked && !m.reste; });
  }
  function slotLabel(m) { return [m.day, m.slot].filter(Boolean).join(' ') || 'sans jour'; }

  A.route(/^#\/cuisine\/(.+)$/, function (name) {
    var r = A.recipeByName(name);
    if (!r) return { html: '<section class="screen"><p>Recette introuvable.</p></section>' };
    var week = A.curWeek();
    var meals = plannedMeals(r.name, week);
    var ck = Store.get('cook.' + r.name, null);
    if (!ck || ck.week !== week) ck = { week: week, sel: meals.map(function (m) { return m.id; }), extra: meals.length ? 0 : 1, cooked: {}, step: -1, done: {} };
    var sel = meals.filter(function (m) { return ck.sel.indexOf(m.id) >= 0; });
    var mine = A.adjusted(r, A.chosenKcal(r));
    // Assiettes : repas choisis + portions en plus (à mes quantités).
    var plates = sel.map(function (m) { return { label: m.byName + ' · ' + slotLabel(m), items: m.items, id: m.id }; });
    for (var i = 0; i < ck.extra; i++) plates.push({ label: (meals.length ? 'En plus (reste) ' : 'Portion ') + (i + 1), items: mine.items, extra: true });
    var total = {}, order = [];
    plates.forEach(function (p) { p.items.forEach(function (it) { if (!(it.name in total)) order.push(it.name); total[it.name] = (total[it.name] || 0) + (C.num(it.qty) || 0); }); });
    var weigh = order.map(function (n) { return { name: n, raw: total[n], isRaw: C.isRaw(C.find(S.idx, n), n) }; });
    var guided = ck.step >= 0 && ck.step < weigh.length;
    var html = '<section class="screen kitchen"><a class="back" href="#/recette/' + enc(r.name) + '">‹ ' + esc(r.name) + '</a><h1>Cuisiner</h1>' +
      '<div class="panel"><div class="panel-title">Pour qui ?</div>' +
      (meals.length ? '<p class="muted small">Repas prévus cette semaine dans ton foyer, chacun calculé selon ses objectifs.</p>' +
        meals.map(function (m) {
          return '<label class="toggle"><input type="checkbox" data-meal="' + esc(m.id) + '"' + (ck.sel.indexOf(m.id) >= 0 ? ' checked' : '') + '> ' + esc(m.byName) + ' · ' + esc(slotLabel(m)) + '</label>';
        }).join('') : '<p class="muted small">Cette recette n’est pas dans le planning de la semaine : portions calculées à tes quantités.</p>') +
      '<div class="row between"><span>' + (meals.length ? 'Portions en plus (restes)' : 'Portions') + '</span><div class="stepper small">' +
      '<button class="btn step" data-x="-1" aria-label="Une de moins">−</button><output>' + ck.extra + '</output>' +
      '<button class="btn step" data-x="1" aria-label="Une de plus">+</button></div></div>' +
      '<p class="center"><b>' + plates.length + '</b> assiette(s)</p></div>' +
      '<div class="panel"><div class="panel-title">1. À peser (cru)</div>' +
      (guided ? '<div class="guided"><p class="muted">' + (ck.step + 1) + ' / ' + weigh.length + '</p><p class="huge-name">' + esc(weigh[ck.step].name) + '</p>' +
        '<p class="huge">' + g(weigh[ck.step].raw) + '</p><div class="row"><button class="btn big" id="gw-prev"' + (ck.step ? '' : ' disabled') + '>‹ Précédent</button>' +
        '<button class="btn primary big grow" id="gw-next">' + (ck.step === weigh.length - 1 ? 'Terminé ✓' : 'Pesé ✓ Suivant') + '</button></div></div>'
        : '<ul class="weigh">' + weigh.map(function (x) {
          return '<li class="' + (ck.done[x.name] ? 'done' : '') + '"><span>' + esc(x.name) + '</span><b>' + g(x.raw) + '</b></li>';
        }).join('') + '</ul>' + (plates.length ? '<button class="btn primary big" id="gw-start">Pesée guidée (un par un)</button>' : '')) + '</div>' +
      '<div class="panel"><div class="panel-title">2. Étapes</div>' +
      '<label class="toggle"><input type="checkbox" id="wake"' + (S.wakeLock ? ' checked' : '') + '> Garder l’écran allumé</label>' +
      (r.steps && r.steps.length ? '<ol class="steps">' + r.steps.map(function (s, i) {
        return '<li><p>' + esc(s.text) + '</p>' + (C.num(s.timer) ? A.timerHtml(r.name + '#' + i, C.num(s.timer)) : '') + '</li>';
      }).join('') + '</ol>' : '<p class="muted">Aucune étape dans l’onglet Étapes.</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">3. Après cuisson : répartir</div>' +
      (weigh.some(function (x) { return x.isRaw; }) ? '<p class="muted small">Pèse chaque préparation cuite : l’appli calcule la part de chaque assiette (au prorata du cru).</p>' +
        weigh.filter(function (x) { return x.isRaw; }).map(function (x) {
          return A.field(esc(x.name) + ' : poids cuit total (g)', '<input type="number" inputmode="numeric" data-cooked="' + esc(x.name) + '" value="' + esc(ck.cooked[x.name] || '') + '" placeholder="ex. ' + Math.round(x.raw * 0.75) + '">');
        }).join('') : '') +
      plates.map(function (p) {
        return '<div class="plate"><b>' + esc(p.label) + '</b><ul>' + p.items.map(function (it) {
          var c = C.num(ck.cooked[it.name]), raw = C.num(it.qty) || 0;
          return '<li>' + esc(it.name) + ' : <b>' + (c && total[it.name] ? g(c * raw / total[it.name]) + ' cuit' : g(raw)) + '</b></li>';
        }).join('') + '</ul></div>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn primary big" id="cooked"' + (plates.length ? '' : ' disabled') + '>C’est cuisiné ✓</button>' +
      '<p class="muted small center">Marque les repas comme cuisinés, retire les quantités du stock' + (ck.extra && meals.length ? ' et ajoute ' + ck.extra + ' reste(s) à ton planning' : '') + '.</p></div></section>';
    return { tab: 'recettes', html: html, bind: function (el) {
      var save = function () { Store.set('cook.' + r.name, ck); A.render(); };
      $$('[data-meal]', el).forEach(function (cb) {
        cb.onchange = function () {
          var id = cb.getAttribute('data-meal');
          ck.sel = ck.sel.filter(function (x) { return x !== id; }); if (cb.checked) ck.sel.push(id); save();
        };
      });
      $$('[data-x]', el).forEach(function (b) { b.onclick = function () { ck.extra = Math.max(0, Math.min(20, ck.extra + Number(b.getAttribute('data-x')))); save(); }; });
      var gs = $('#gw-start', el); if (gs) gs.onclick = function () { ck.step = 0; save(); };
      var gp = $('#gw-prev', el); if (gp) gp.onclick = function () { ck.step = Math.max(0, ck.step - 1); save(); };
      var gn = $('#gw-next', el); if (gn) gn.onclick = function () { ck.done[weigh[ck.step].name] = true; ck.step = ck.step + 1 >= weigh.length ? -1 : ck.step + 1; save(); };
      $$('[data-cooked]', el).forEach(function (inp) { inp.onchange = function () { ck.cooked[inp.getAttribute('data-cooked')] = C.num(inp.value); save(); }; });
      $('#wake', el).onchange = function (e) { A.toggleWake(e.target.checked); };
      A.bindTimers(el);
      $('#cooked', el).onclick = function () {
        var ids = sel.map(function (m) { return m.id; });
        var used = weigh.map(function (x) { return { ing: x.name, qty: Math.round(x.raw) }; });
        markCooked(week, ids, used);
        if (ck.extra && meals.length) {
          var k = A.chosenKcal(r), v = A.variantOf(r, k);
          var rows = A.myRows(week);
          for (var j = 0; j < ck.extra; j++) rows.push(A.newRow(r.name, { reste: true, kcal: k, version: v ? v.items.map(function (it) { return { name: it.name, qty: it.qty }; }) : null }));
          A.setMyRows(week, rows);
        }
        Store.del('cook.' + r.name);
        A.toast('Bon appétit ! Stock mis à jour.'); A.go('#/semaine');
      };
    } };
  });

  function markCooked(week, ids, used) {
    var set = {}; ids.forEach(function (i) { set[i] = 1; });
    // Mes repas : mis à jour ici ; ceux des autres : dans la copie du foyer.
    var mineChanged = false;
    var rows = A.myRows(week).map(function (r) { if (set[r.id]) { mineChanged = true; return Object.assign({}, r, { cooked: true }); } return r; });
    if (mineChanged) { S.data.plan = (S.data.plan || []).filter(function (r) { return r.week !== week; }).concat(rows); }
    var fw = (S.fw && S.fw[week]) || Store.get('fw.' + week, null);
    if (fw) { fw.meals.forEach(function (m) { if (set[m.id]) m.cooked = true; }); Store.set('fw.' + week, fw); }
    var stock = A.stockMap();
    used.forEach(function (u) { if (stock[u.ing]) A.addLocalStock(u.ing, -u.qty); });
    A.saveData();
    A.Sync.push(null, 'cooked', { week: week, ids: ids, used: used });
    if (mineChanged) A.setMyRows(week, rows);
  }
  A.markCooked = markCooked;

  /* ================= Session de cuisine (batch) ================= */
  A.route(/^#\/session$/, function () {
    var week = A.curWeek(), fm = A.foyerMeals(week);
    var todo = fm.meals.filter(function (m) { return !m.cooked && !m.reste; });
    var byRec = {}, total = {};
    todo.forEach(function (m) {
      (byRec[m.recipe] = byRec[m.recipe] || []).push(m);
      m.items.forEach(function (it) { total[it.name] = (total[it.name] || 0) + (C.num(it.qty) || 0); });
    });
    var names = Object.keys(byRec).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
    var html = '<section class="screen"><a class="back" href="#/semaine">‹ Semaine</a><h1>Session de cuisine</h1>' +
      '<p class="muted">' + esc(A.weekLabel(week)) + ' · repas du foyer pas encore cuisinés.</p>' +
      (fm.fetchedAt ? '' : '<p class="notice">Repas des autres membres pas encore chargés.</p>') +
      '<button class="btn ghost" id="ss-refresh">Actualiser les repas du foyer</button>' +
      (names.length ? '<div class="panel"><div class="panel-title">Mise en place : tout ce qu’il faut (cru)</div><ul class="weigh">' +
        Object.keys(total).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).map(function (n) {
          return '<li><span>' + esc(n) + '</span><b>' + g(total[n]) + '</b></li>';
        }).join('') + '</ul></div>' +
        '<div class="panel"><div class="panel-title">Recettes à cuisiner</div>' + names.map(function (n) {
          return '<div class="alt-mini"><span class="grow"><b>' + esc(n) + '</b><br><span class="muted small">' + byRec[n].length + ' repas : ' +
            esc(byRec[n].map(function (m) { return m.byName; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ')) + '</span></span>' +
            '<a class="btn small primary" href="#/cuisine/' + enc(n) + '">Cuisiner</a></div>';
        }).join('') + '</div>' +
        '<div class="actions"><button class="btn big" id="ss-all">Tout est cuisiné ✓</button></div>'
        : '<p>Rien à cuisiner pour cette semaine. <a href="#/semaine">Remplir le planning</a>.</p>') + '</section>';
    return { tab: 'semaine', html: html, bind: function (el) {
      $('#ss-refresh', el).onclick = function () { A.act('lecture des repas du foyer', async function () { await A.fetchFoyerWeek(week); A.render(); A.toast('Repas du foyer à jour'); }); };
      var all = $('#ss-all', el);
      if (all) all.onclick = function () {
        if (!confirm('Marquer les ' + todo.length + ' repas comme cuisinés et retirer les quantités du stock ?')) return;
        markCooked(week, todo.map(function (m) { return m.id; }), Object.keys(total).map(function (n) { return { ing: n, qty: Math.round(total[n]) }; }));
        A.toast('Session terminée !'); A.render();
      };
      if (navigator.onLine && !fm.fetchedAt) A.fetchFoyerWeek(week).then(function () { A.render(); }, function () {});
    } };
  });
})(window.App);
