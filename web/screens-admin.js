/* Écrans : propositions (recette, ingrédient, prix) pour tous ; tableau de bord, comptes,
   gestion de la base pour l'admin. Un admin enregistre directement, les autres proposent. */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, Store = A.Store, $ = A.$, $$ = A.$$, esc = A.esc, fmt = A.fmt, euro = A.euro, g = A.g, enc = A.enc;

  function datalist(id, names) { return '<datalist id="' + id + '">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>'; }
  // Nouveaux ingrédients préparés pour une proposition de recette (pas encore dans le Sheet).
  function propIngs() { return Store.get(A.pk('propIngs'), []); }
  function idxWith(extra) { return C.index((S.data.ingredients || []).concat(extra || [])); }

  /* ================= Ingrédient : création, photo, modification, proposition ================= */
  A.route(/^#\/ingredient\/(.+)$/, function (key) {
    var admin = A.isAdmin();
    var forRecipe = key === 'pour-recette';
    var editing = admin && ['nouveau', 'photo', 'pour-recette'].indexOf(key) < 0 ? C.find(S.idx, key) : null;
    if (!admin && !forRecipe && key !== 'nouveau' && key !== 'photo') return A.redirect('#/plus');
    var draft = Store.get('ingDraft', null);
    var v = editing ? Object.assign({}, editing) : (draft || { etat: 'Cru', source: '' });
    var opt = function (list, cur) { return list.map(function (r) { return '<option' + (r === cur ? ' selected' : '') + '>' + r + '</option>'; }).join(''); };
    var role = v.role || C.suggestRole(v), rayon = v.rayon || C.suggestRayon(role);
    var tags = C.splitList(v.allergenes).map(C.norm);
    var back = forRecipe ? '#/proposer' : (admin ? '#/gestion' : '#/plus');
    var html = '<section class="screen"><a class="back" href="' + back + '">‹ Retour</a>' +
      '<h1>' + (editing ? 'Modifier un ingrédient' : (admin ? 'Nouvel ingrédient' : 'Proposer un ingrédient')) + '</h1>' +
      (!admin ? '<p class="muted">' + (forRecipe ? 'Il sera ajouté à ta proposition de recette.' : 'L’admin le vérifiera avant de l’ajouter.') + '</p>' : '') +
      '<div class="panel"><div class="panel-title">Code-barres du produit</div>' +
      '<p class="muted small">Les valeurs pour 100 g viennent d’Open Food Facts (base gratuite et collaborative) : elles s’affichent surlignées, corrige-les si besoin.</p>' +
      '<label class="btn primary big file"><input type="file" accept="image/*" capture="environment" id="f-barcode">▥ Scanner le code-barres</label>' +
      '<div class="row"><input id="f-ean" inputmode="numeric" autocomplete="off" placeholder="ou tape les chiffres sous le code" aria-label="Numéro du code-barres">' +
      '<button class="btn" id="f-ean-go">Chercher</button></div><div id="ean-out"></div></div>' +
      (editing ? '' : '<div class="panel"><div class="panel-title">Ou photo du tableau nutritionnel</div>' +
        '<p class="muted small">La photo est lue par Google (gratuit) puis supprimée. Rien n’est enregistré sans ta validation.</p>' +
        '<label class="btn big file"><input type="file" accept="image/*" capture="environment" id="f-photo">📷 Prendre la photo</label>' +
        '<div id="ocr-out"></div></div>') +
      '<div id="dup"></div>' +
      A.field('Nom (avec cru/cuit)', '<input id="f-name" value="' + esc(v.name || '') + '"' + (editing ? ' readonly' : '') + ' autocomplete="off">',
        editing ? 'Le nom ne se change pas ici (il est utilisé dans les recettes).' : 'Ex. « Riz basmati cru ». Doit être identique partout.') +
      A.field('État', '<select id="f-etat">' + opt(['Cru', 'Cuit', 'Autre'], v.etat) + '</select>') +
      '<div class="grid2">' +
      A.field('kcal / 100 g', A.numIn('f-kcal', v.kcal)) + A.field('Protéines / 100 g', A.numIn('f-p', v.p)) +
      A.field('Glucides / 100 g', A.numIn('f-g', v.g)) + A.field('Lipides / 100 g', A.numIn('f-l', v.l)) +
      A.field('Fibres / 100 g', A.numIn('f-f', v.f)) + A.field('Prix au kg (€)', A.numIn('f-prix', v.prix), 'Vide = « prix manquant »') + '</div>' +
      '<label class="btn ghost file"><input type="file" accept="image/*" capture="environment" id="f-pricephoto">📷 Lire le prix en rayon</label><div id="price-out"></div>' +
      A.field('Magasin', '<input id="f-mag" value="' + esc(v.magasin || '') + '">') +
      A.field('Source macros', '<input id="f-src" value="' + esc(v.source || '') + '">') +
      A.field('Remarque', '<input id="f-rem" value="' + esc(v.remarque || '') + '">') +
      '<div class="grid2">' + A.field('Rôle', '<select id="f-role">' + opt(C.ROLES, role) + '</select>', v.role ? '' : 'Proposé d’après les macros') +
      A.field('Rayon', '<select id="f-rayon">' + opt(C.RAYONS, rayon) + '</select>') + '</div>' +
      '<fieldset class="panel"><legend class="panel-title">Allergènes</legend><div class="checks">' + C.ALLERGENES.map(function (a) {
        return '<label class="toggle"><input type="checkbox" data-alg="' + esc(a) + '"' + (tags.indexOf(C.norm(a)) >= 0 ? ' checked' : '') + '> ' + esc(a) + '</label>';
      }).join('') + '</div></fieldset>' +
      '<button class="btn primary big" id="f-save">' + (editing ? 'Enregistrer' : admin ? 'Valider et enregistrer dans le Sheet' : forRecipe ? 'Ajouter à ma recette' : 'Envoyer à l’admin') + '</button></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var read = function () {
        return { name: $('#f-name').value.trim(), etat: $('#f-etat').value, kcal: C.num($('#f-kcal').value), p: C.num($('#f-p').value),
          g: C.num($('#f-g').value), l: C.num($('#f-l').value), f: C.num($('#f-f').value), prix: C.num($('#f-prix').value),
          magasin: $('#f-mag').value.trim(), source: $('#f-src').value.trim(), remarque: $('#f-rem').value.trim(),
          role: $('#f-role').value, rayon: $('#f-rayon').value,
          allergenes: $$('[data-alg]', el).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-alg'); }).join(', ') };
      };
      var checkDup = function () {
        if (editing) return;
        var n = $('#f-name').value.trim(), ex = n && C.findLoose(S.idx, n);
        $('#dup').innerHTML = ex ? '<div class="notice warn">Cet ingrédient existe déjà : <b>' + esc(ex.name) + '</b>.' + (admin ? ' <a href="#/ingredient/' + enc(ex.name) + '">Le modifier</a> au lieu d’en créer un doublon.' : ' Utilise-le tel quel.') + '</div>' : '';
      };
      $('#f-name').oninput = checkDup; checkDup();
      if (!editing) $$('input,select', el).forEach(function (i) { i.addEventListener('change', function () { Store.set('ingDraft', read()); }); });
      ['#f-kcal', '#f-p', '#f-g', '#f-l'].forEach(function (s) {
        $(s).addEventListener('change', function () { if (v.role) return; var r = C.suggestRole(read()); $('#f-role').value = r; $('#f-rayon').value = C.suggestRayon(r); });
      });
      var photo = $('#f-photo', el); if (photo) photo.onchange = function () { ocrFlow(photo.files[0], 'nutrition'); photo.value = ''; };
      var pp = $('#f-pricephoto', el); pp.onchange = function () { ocrFlow(pp.files[0], 'prix'); pp.value = ''; };
      // Code-barres : photo → lecture du code → fiche Open Food Facts → champs pré-remplis (modifiables).
      var eanOut = $('#ean-out', el);
      var lookup = function (code) {
        code = String(code || '').replace(/\D/g, '');
        if (!C.validEan(code)) { eanOut.innerHTML = '<div class="notice warn">Code-barres non valide (' + esc(code || 'vide') + '). Vérifie les chiffres.</div>'; return; }
        $('#f-ean').value = code;
        if (!navigator.onLine) { eanOut.innerHTML = '<div class="notice warn">Pas de réseau : la recherche du code-barres attendra. Tu peux saisir les valeurs à la main.</div>'; return; }
        eanOut.innerHTML = '<p class="muted">Recherche du produit ' + esc(code) + '…</p>';
        A.act('recherche d’un code-barres', async function () {
          var res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=product_name,product_name_fr,brands,nutriments,quantity,allergens_tags');
          var info = C.parseOFF(res.ok ? await res.json() : null);
          if (!info) { eanOut.innerHTML = '<div class="notice warn">Produit ' + esc(code) + ' inconnu d’Open Food Facts. Prends en photo le tableau nutritionnel ou saisis les valeurs.</div>'; return; }
          var setv = function (id, val) { if (val !== null && val !== undefined && val !== '') { $(id).value = typeof val === 'number' ? String(val).replace('.', ',') : val; $(id).classList.add('read'); } };
          if (!editing && !$('#f-name').value && info.name) setv('#f-name', info.name);
          setv('#f-kcal', info.kcal); setv('#f-p', info.p); setv('#f-g', info.g); setv('#f-l', info.l); setv('#f-f', info.f);
          $('#f-src').value = 'Open Food Facts (code ' + code + ')';
          info.allergenes.forEach(function (a) { var cb = $('[data-alg="' + a + '"]', el); if (cb) cb.checked = true; });
          if (!v.role) { var rr = C.suggestRole(read()); $('#f-role').value = rr; $('#f-rayon').value = C.suggestRayon(rr); }
          var miss = ['kcal', 'p', 'g', 'l', 'f'].filter(function (k) { return info[k] === null; })
            .map(function (k) { return { kcal: 'kcal', p: 'protéines', g: 'glucides', l: 'lipides', f: 'fibres' }[k]; });
          eanOut.innerHTML = '<div class="notice">Trouvé : <b>' + esc(info.name || code) + '</b>' + (info.quantity ? ' (' + esc(info.quantity) + ')' : '') +
            '. Valeurs pour 100 g surlignées : <b>vérifie et corrige si besoin</b>.' + (editing ? '' : ' Ajoute « cru » ou « cuit » au nom si utile.') +
            (miss.length ? '<br><span class="warn-text">Absent de la fiche : ' + miss.join(', ') + '. À saisir.</span>' : '') +
            (info.allergenes.length ? '<br>Allergènes cochés : ' + esc(info.allergenes.join(', ')) + '.' : '') + '</div>';
          checkDup(); if (!editing) Store.set('ingDraft', read());
        });
      };
      $('#f-ean-go', el).onclick = function () { lookup($('#f-ean').value); };
      $('#f-ean', el).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup($('#f-ean').value); } };
      $('#f-barcode', el).onchange = function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        eanOut.innerHTML = '<p class="muted">Lecture du code-barres…</p>';
        A.act('lecture d’un code-barres', async function () {
          var code = await readBarcode(f);
          if (!code) { eanOut.innerHTML = '<div class="notice warn">Code-barres illisible. Reprends la photo bien à plat et nette (code entier, sans reflet), ou tape les chiffres.</div>'; return; }
          lookup(code);
        });
      };
      $('#f-save').onclick = function () {
        var ing = read();
        if (!ing.name) { A.toast('Le nom est obligatoire.'); return; }
        if ([ing.kcal, ing.p, ing.g, ing.l].some(function (x) { return x === null; })) { A.toast('kcal, protéines, glucides et lipides sont obligatoires.'); return; }
        var kc = 4 * ing.p + 4 * ing.g + 9 * ing.l;
        if (ing.kcal > 0 && Math.abs(kc - ing.kcal) / ing.kcal > 0.2 && kc > 20 &&
          !confirm('Attention : 4×P + 4×G + 9×L = ' + Math.round(kc) + ' kcal, loin des ' + ing.kcal + ' kcal saisies. Une virgule mal lue ? Continuer quand même ?')) return;
        if (!editing && C.findLoose(S.idx, ing.name)) { A.toast('Cet ingrédient existe déjà.'); return; }
        if (forRecipe && !admin) {
          var list = propIngs().filter(function (x) { return C.norm(x.name) !== C.norm(ing.name); }).concat([ing]);
          Store.set(A.pk('propIngs'), list); Store.del('ingDraft'); A.toast('Ajouté : utilise-le dans ta recette'); A.go('#/proposer'); return;
        }
        A.act(editing ? 'modification d’un ingrédient' : 'ajout d’un ingrédient', async function () {
          if (editing) await A.Api.call('updateIngredient', { token: S.token, row: editing.row, name: editing.name, ingredient: ing });
          else if (admin) await A.Api.call('addIngredient', { token: S.token, ingredient: ing });
          else await A.Api.call('propose', { token: S.token, type: 'ingrédient', title: ing.name, data: { ingredient: ing } });
          Store.del('ingDraft');
          if (admin) { await A.refreshStrict(); A.toast('Enregistré dans le Sheet'); A.go(editing ? '#/ingredients' : (forRecipe ? '#/proposer' : '#/gestion')); }
          else { await A.refreshStrict(); A.toast('Ingrédient envoyé à l’admin. Merci !'); A.go('#/recettes'); }
        });
      };
      function ocrFlow(file, kind) {
        if (!file) return;
        if (!navigator.onLine) { A.showError(A.Api.ApiError('La lecture de photo demande du réseau. Saisis les valeurs à la main.', 'HORS_LIGNE')); return; }
        var out = $(kind === 'prix' ? '#price-out' : '#ocr-out');
        out.innerHTML = '<p class="muted">Lecture de la photo…</p>';
        A.act('lecture d’une photo d’étiquette', async function () {
          var img = await A.shrink(file, 1600, 0.85);
          var r = await A.Api.call('ocr', { token: S.token, image: img.b64, mime: 'image/jpeg', kind: kind });
          if (kind === 'prix') {
            var pr = C.parsePrice(r.text);
            out.innerHTML = '<div class="notice' + (pr.prixKg === null ? ' warn' : '') + '">' + esc(pr.how) + (pr.prixKg !== null ? ' : <b>' + euro(pr.prixKg) + '/kg</b>. Vérifie la case Prix.' : '. Saisis-le à la main.') + '</div>';
            if (pr.prixKg !== null) { $('#f-prix').value = String(pr.prixKg).replace('.', ','); $('#f-prix').classList.add('read'); }
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

  /* ---------- Lecture d'un code-barres sur une photo ----------
     Lecteur intégré du téléphone s'il existe (Android), sinon bibliothèque gratuite ZXing chargée à la demande. */
  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = ZXING_URL; s.async = true;
      s.onload = function () { resolve(window.ZXing); };
      s.onerror = function () { reject(A.Api.ApiError('Lecteur de code-barres indisponible (pas de réseau ?). Tape les chiffres.', 'RESEAU')); };
      document.head.appendChild(s);
    });
  }
  async function readBarcode(file) {
    var url = URL.createObjectURL(file);
    try {
      if ('BarcodeDetector' in window) {
        try {
          var det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          var bmp = await createImageBitmap(file);
          var found = await det.detect(bmp);
          if (found && found.length) return found[0].rawValue;
        } catch (e) { /* on essaie ZXing */ }
      }
      var Z = await loadZxing();
      var hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      var reader = new Z.BrowserMultiFormatReader(hints);
      try { var r = await reader.decodeFromImageUrl(url); return r && r.getText(); }
      catch (e) { return null; }
    } finally { URL.revokeObjectURL(url); }
  }
  A.readBarcode = readBarcode;

  /* ================= Recette : nouvelle (admin) ou proposée (autres) ================= */
  A.route(/^#\/proposer$/, function () {
    var admin = A.isAdmin();
    var d = Store.get(A.pk('recDraft'), null) || { name: '', portions: 1, categorie: '', objectif: 'Maintien', prepa: '', cuisson: '', notes: '', lines: [{ ing: '', qty: '' }], steps: [{ text: '', timer: '' }] };
    var extra = admin ? [] : propIngs();
    var names = S.data.ingredients.map(function (i) { return i.name; }).concat(extra.map(function (i) { return i.name; }));
    var html = '<section class="screen"><a class="back" href="#/recettes">‹ Recettes</a><h1>' + (admin ? 'Nouvelle recette' : 'Proposer une recette') + '</h1>' +
      (admin ? '' : '<p class="muted">L’admin la vérifie avant de l’ajouter au catalogue. Tu suis son état dans « Mes propositions ».</p>') +
      A.field('Nom de la recette', '<input id="n-name" value="' + esc(d.name) + '">') +
      '<div class="grid2">' + A.field('Portions', '<input id="n-portions" type="number" inputmode="numeric" value="' + esc(d.portions) + '">') +
      A.field('Catégorie', '<input id="n-cat" value="' + esc(d.categorie) + '" placeholder="Déjeuner, Dîner…">') +
      A.field('Objectif', '<select id="n-obj">' + ['Sèche', 'Maintien', 'Masse'].map(function (o) { return '<option' + (o === d.objectif ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
      A.field('Prépa (min)', '<input id="n-prepa" type="number" inputmode="numeric" value="' + esc(d.prepa) + '">') +
      A.field('Cuisson (min)', '<input id="n-cuisson" type="number" inputmode="numeric" value="' + esc(d.cuisson) + '">') + '</div>' +
      '<div class="panel"><div class="panel-title">Ingrédients (quantités pour toute la recette, en g)</div>' +
      d.lines.map(function (l, i) {
        return '<div class="line-row"><input list="ing-names" data-li="' + i + '" placeholder="Ingrédient (nom exact)" value="' + esc(l.ing) + '" aria-label="Ingrédient">' +
          '<input type="number" inputmode="numeric" class="qty-in" data-lq="' + i + '" placeholder="g" value="' + esc(l.qty) + '" aria-label="Quantité en g">' +
          '<button class="btn ghost step" data-ldel="' + i + '" aria-label="Retirer">✕</button></div>';
      }).join('') + datalist('ing-names', names) +
      '<div class="row wrap"><button class="btn" id="n-addline">+ Ingrédient</button> <a class="btn ghost" href="#/ingredient/pour-recette">Ingrédient absent ? Le créer</a></div>' +
      (extra.length ? '<p class="muted small">Nouveaux ingrédients proposés : ' + extra.map(function (x) { return esc(x.name); }).join(', ') + ' <button class="linkbtn" id="n-clearings">Effacer</button></p>' : '') + '</div>' +
      '<div class="panel"><div class="panel-title">Étapes</div>' +
      d.steps.map(function (s, i) {
        return '<div class="line-row"><textarea rows="2" data-si="' + i + '" placeholder="Étape ' + (i + 1) + '" aria-label="Étape ' + (i + 1) + '">' + esc(s.text) + '</textarea>' +
          '<input type="number" inputmode="numeric" class="qty-in" data-st="' + i + '" placeholder="min" value="' + esc(s.timer) + '" aria-label="Minuteur en minutes"></div>';
      }).join('') + '<button class="btn" id="n-addstep">+ Étape</button></div>' +
      A.field('Notes', '<input id="n-notes" value="' + esc(d.notes) + '">') +
      '<div id="n-preview"></div>' +
      '<button class="btn primary big" id="n-save">' + (admin ? 'Enregistrer la recette dans le Sheet' : 'Envoyer à l’admin') + '</button></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var ix = idxWith(extra);
      var read = function () {
        return { name: $('#n-name').value.trim(), portions: C.num($('#n-portions').value), categorie: $('#n-cat').value.trim(),
          objectif: $('#n-obj').value, prepa: C.num($('#n-prepa').value), cuisson: C.num($('#n-cuisson').value), notes: $('#n-notes').value.trim(),
          lines: $$('[data-li]', el).map(function (x, i) { return { ing: x.value.trim(), qty: $('[data-lq="' + i + '"]', el).value }; }),
          steps: $$('[data-si]', el).map(function (x, i) { return { text: x.value.trim(), timer: $('[data-st="' + i + '"]', el).value }; }) };
      };
      var keep = function (r) { Store.set(A.pk('recDraft'), r); };
      var preview = function () {
        var r = read(); keep(r);
        var lines = r.lines.filter(function (l) { return l.ing; }).map(function (l) { return { ing: l.ing, qty: C.num(l.qty) || 0 }; });
        var bad = lines.filter(function (l) { return !C.find(ix, l.ing); });
        var t = C.recipeTotals({ lines: lines, portions: r.portions || 1 }, ix).portion;
        $('#n-preview').innerHTML = (bad.length ? '<div class="notice warn">Ingrédient introuvable (nom exact requis) : ' + bad.map(function (b) { return esc(b.ing); }).join(', ') + '. Choisis dans la liste ou crée-le.</div>' : '') +
          (lines.length ? A.macroTable(t, 'Aperçu par portion') : '');
      };
      $('.screen', el).addEventListener('change', preview); preview(); // sur l'écran, pas sur <main> (qui reste d'un écran à l'autre)
      $('#n-addline').onclick = function () { var r = read(); r.lines.push({ ing: '', qty: '' }); keep(r); A.render(); };
      $('#n-addstep').onclick = function () { var r = read(); r.steps.push({ text: '', timer: '' }); keep(r); A.render(); };
      var ci = $('#n-clearings', el); if (ci) ci.onclick = function () { Store.del(A.pk('propIngs')); A.render(); };
      $$('[data-ldel]', el).forEach(function (b) { b.onclick = function () { var r = read(); r.lines.splice(Number(b.getAttribute('data-ldel')), 1); if (!r.lines.length) r.lines.push({ ing: '', qty: '' }); keep(r); A.render(); }; });
      $('#n-save').onclick = function () {
        var r = read();
        r.lines = r.lines.filter(function (l) { return l.ing; }).map(function (l) { return { ing: l.ing, qty: C.num(l.qty) }; });
        r.steps = r.steps.filter(function (s) { return s.text; }).map(function (s) { return { text: s.text, timer: C.num(s.timer) }; });
        if (!r.name || !r.portions) { A.toast('Nom et portions obligatoires.'); return; }
        if (!r.lines.length) { A.toast('Ajoute au moins un ingrédient.'); return; }
        if (r.lines.some(function (l) { return !C.find(ix, l.ing) || !l.qty; })) { A.toast('Vérifie les ingrédients (nom exact) et les quantités.'); return; }
        if (A.recipeByName(r.name) || (S.data.recipes || []).some(function (x) { return C.norm(x.name) === C.norm(r.name); })) { A.toast('Une recette porte déjà ce nom.'); return; }
        var used = {}; r.lines.forEach(function (l) { used[l.ing] = 1; });
        var newIngs = extra.filter(function (x) { return used[x.name]; });
        A.act(admin ? 'ajout d’une recette' : 'proposition d’une recette', async function () {
          var res = await A.Api.call('propose', { token: S.token, type: 'recette', title: r.name, data: { recipe: r, ingredients: newIngs } });
          Store.del(A.pk('recDraft')); Store.del(A.pk('propIngs'));
          await A.refreshStrict();
          if (res.applied) { A.toast('Recette enregistrée'); A.go('#/recette/' + enc(r.name)); }
          else { A.toast('Recette envoyée à l’admin. Merci !'); A.go('#/recettes'); }
        });
      };
    } };
  });

  /* ================= Prix en magasin ================= */
  A.route(/^#\/proposer-prix$/, function () {
    var admin = A.isAdmin(), names = S.data.ingredients.map(function (i) { return i.name; });
    var offers = (S.data.offers || []).slice().sort(function (a, b) { return a.ing.localeCompare(b.ing, 'fr') || a.magasin.localeCompare(b.magasin, 'fr'); });
    var html = '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>' + (admin ? 'Prix en magasin' : 'Proposer un prix') + '</h1>' +
      '<p class="muted">Taille du paquet et prix payé : la liste de courses arrondit au nombre de paquets et choisit le magasin le moins cher au kilo.</p>' +
      '<div class="panel">' + A.field('Ingrédient', '<input id="o-ing" list="ing-names" autocomplete="off">') + datalist('ing-names', names) +
      A.field('Magasin', '<input id="o-mag" list="mag-names" autocomplete="off" placeholder="ex. Lidl">') +
      datalist('mag-names', offers.map(function (o) { return o.magasin; }).filter(function (v, i, a) { return a.indexOf(v) === i; })) +
      '<div class="grid2">' + A.field('Contenance du paquet (g)', '<input id="o-pack" type="number" inputmode="numeric" placeholder="ex. 1000">') +
      A.field('Prix du paquet (€)', A.numIn('o-prix', '')) + '</div>' +
      '<label class="btn ghost file"><input type="file" accept="image/*" capture="environment" id="o-photo">📷 Lire l’étiquette de prix</label><div id="o-out"></div>' +
      '<button class="btn primary big" id="o-save">' + (admin ? 'Enregistrer' : 'Envoyer à l’admin') + '</button></div>' +
      (offers.length ? '<div class="panel"><div class="panel-title">Prix connus</div><ul class="shop">' + offers.map(function (o, i) {
        return '<li><div class="stock-row"><span class="s-name">' + esc(o.ing) + '<small>' + esc(o.magasin) + ' · ' + g(o.pack) + ' · ' + esc(A.dayFr(o.date)) + '</small></span>' +
          '<span class="s-qty">' + euro(o.prix) + '<small>' + euro(o.prix / o.pack * 1000) + '/kg</small></span>' +
          (admin ? '<button class="btn ghost step" data-odel="' + i + '" aria-label="Supprimer">✕</button>' : '') + '</div></li>';
      }).join('') + '</ul></div>' : '') + '</section>';
    return { tab: 'plus', html: html, bind: function (el) {
      $('#o-photo', el).onchange = function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        A.act('lecture d’une étiquette de prix', async function () {
          var img = await A.shrink(f, 1600, 0.85);
          var r = await A.Api.call('ocr', { token: S.token, image: img.b64, mime: 'image/jpeg', kind: 'prix' });
          var flat = String(r.text || '').replace(/\s+/g, ' ');
          var p = flat.match(/(\d+[.,]\d{2})\s*€/), w = flat.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
          if (p) $('#o-prix', el).value = p[1];
          if (w) $('#o-pack', el).value = Math.round(C.num(w[1]) * (/kg/i.test(w[2]) ? 1000 : 1));
          $('#o-out', el).innerHTML = '<div class="notice' + (p && w ? '' : ' warn') + '">' + (p && w ? 'Lu : ' + esc(w[0]) + ' pour ' + esc(p[0]) + '. Vérifie.' : 'Prix ou contenance non trouvés : saisis-les à la main.') + '</div>';
        });
      };
      $('#o-save', el).onclick = function () {
        var o = { ing: $('#o-ing', el).value.trim(), magasin: $('#o-mag', el).value.trim(), pack: C.num($('#o-pack', el).value), prix: C.num($('#o-prix', el).value) };
        if (!C.find(S.idx, o.ing)) { A.toast('Choisis un ingrédient de la liste (nom exact).'); return; }
        if (!o.magasin || !o.pack || !o.prix) { A.toast('Magasin, contenance et prix sont obligatoires.'); return; }
        A.act('prix en magasin', async function () {
          var r = await A.Api.call('propose', { token: S.token, type: 'prix', title: o.ing + ' — ' + o.magasin, data: { offer: o } });
          await A.refreshStrict(); A.toast(r.applied ? 'Prix enregistré' : 'Prix envoyé à l’admin. Merci !');
        });
      };
      $$('[data-odel]', el).forEach(function (b) {
        b.onclick = function () {
          var o = offers[Number(b.getAttribute('data-odel'))];
          if (!confirm('Supprimer le prix de ' + o.ing + ' chez ' + o.magasin + ' ?')) return;
          A.act('suppression d’un prix', async function () { await A.Api.call('deleteOffer', { token: S.token, ing: o.ing, magasin: o.magasin }); await A.refreshStrict(); });
        };
      });
    } };
  });

  /* ================= Mes propositions ================= */
  A.route(/^#\/mes-propositions$/, function () {
    var list = (S.data.myProposals || []).slice().reverse();
    var cls = { 'en attente': '', 'acceptée': 'ok', 'refusée': 'warn' };
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Mes propositions</h1>' +
      (list.length ? '<ul class="shop">' + list.map(function (p) {
        return '<li><div class="stock-row"><span class="s-name">' + esc(p.title || p.type) + '<small>' + esc(p.type) + ' · ' + esc(A.dayFr(p.date)) +
          (p.reply ? ' · « ' + esc(p.reply) + ' »' : '') + '</small></span><span class="badge ' + (cls[p.statut] || '') + '">' + esc(p.statut) + '</span></div></li>';
      }).join('') + '</ul>' : '<p>Aucune proposition pour l’instant.</p>') +
      '<div class="actions"><a class="btn big" href="#/proposer">Proposer une recette</a><a class="btn big" href="#/ingredient/nouveau">Proposer un ingrédient</a>' +
      '<a class="btn big" href="#/proposer-prix">Proposer un prix</a></div></section>' };
  });

  /* ================= Tableau de bord admin ================= */
  A.route(/^#\/admin$/, function () {
    if (!A.isAdmin()) return A.redirect('#/plus');
    var D = S.dash;
    var tab = Store.get('adminTab', 'valider');
    var tabs = [['valider', 'À valider'], ['pop', 'Populaires'], ['users', 'Utilisateurs'], ['qualite', 'Qualité']];
    var body = '';
    if (!D) body = '<p class="muted">Chargement…</p>';
    else if (tab === 'valider') {
      body = D.pending.length ? D.pending.map(function (p, i) { return proposalCard(p, i); }).join('') : '<p>Rien à valider. 👍</p>';
    } else if (tab === 'pop') {
      body = '<table class="qty"><thead><tr><th>Recette</th><th>Prévue</th><th>Note</th><th>♥</th></tr></thead><tbody>' + D.popular.map(function (r) {
        return '<tr><td><a href="#/recette/' + enc(r.name) + '">' + esc(r.name) + '</a></td><td>' + r.planned + '</td><td>' + (r.avg ? fmt(r.avg, 1) + ' (' + r.votes + ')' : '—') + '</td><td>' + r.favs + '</td></tr>';
      }).join('') + '</tbody></table><p class="muted small">« Prévue » = nombre de repas planifiés (toutes semaines), hors restes.</p>';
    } else if (tab === 'users') {
      var u = D.users;
      body = '<div class="macros"><div class="m"><span>Comptes</span><b>' + u.total + '</b></div><div class="m"><span>Actifs 7 j</span><b>' + u.active7 + '</b></div>' +
        '<div class="m"><span>Actifs 30 j</span><b>' + u.active30 + '</b></div><div class="m"><span>Nouveaux 30 j</span><b>' + u.new30 + '</b></div>' +
        '<div class="m"><span>Foyers</span><b>' + u.foyers + '</b></div><div class="m"><span>Inscriptions</span><b>' + (u.signupOpen ? 'ouvertes' : 'fermées') + '</b></div></div>' +
        '<a class="btn big" href="#/comptes">Gérer les comptes</a>';
    } else {
      var q = D.quality, sec = function (t, list, link) {
        return '<div class="panel"><div class="panel-title">' + t + ' (' + list.length + ')</div>' + (list.length ? '<p class="small">' + list.slice(0, 40).map(function (n) {
          return link ? '<a href="' + link(n) + '">' + esc(n) + '</a>' : esc(n);
        }).join(' · ') + '</p>' : '<p class="muted small">Rien à signaler.</p>') + '</div>';
      };
      body = sec('Ingrédients sans prix', q.noPrice, function (n) { return '#/ingredient/' + enc(n); }) +
        sec('Ingrédients sans rôle ou rayon', q.noRole, function (n) { return '#/ingredient/' + enc(n); }) +
        sec('Recettes avec un problème (colonne Contrôle)', q.badRecipes) +
        sec('Recettes sans photo', q.noPhoto, function (n) { return '#/recette/' + enc(n); }) +
        sec('Ingrédients utilisés dans aucune recette', q.unused, function (n) { return '#/ingredient/' + enc(n); });
    }
    var html = '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><div class="row between"><h1>Tableau de bord</h1><button class="btn small ghost" id="d-reload">Actualiser</button></div>' +
      '<div class="seg" role="tablist">' + tabs.map(function (t) {
        var n = t[0] === 'valider' && D ? ' (' + D.pending.length + ')' : '';
        return '<button class="seg-b' + (tab === t[0] ? ' on' : '') + '" data-tab2="' + t[0] + '" role="tab" aria-selected="' + (tab === t[0]) + '">' + t[1] + n + '</button>';
      }).join('') + '</div>' + body + '</section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var load = function () { A.act('lecture du tableau de bord', async function () { S.dash = await A.Api.call('dashboard', { token: S.token }); A.render(); }); };
      if (!D) load();
      $('#d-reload', el).onclick = function () { S.dash = null; A.render(); };
      $$('[data-tab2]', el).forEach(function (b) { b.onclick = function () { Store.set('adminTab', b.getAttribute('data-tab2')); A.render(); }; });
      $$('[data-decide]', el).forEach(function (b) {
        b.onclick = function () {
          var p = D.pending[Number(b.getAttribute('data-i'))], yes = b.getAttribute('data-decide') === 'oui';
          var reply = yes ? '' : prompt('Raison du refus (visible par la personne, facultatif) :', '');
          if (reply === null) return;
          A.act(yes ? 'validation d’une proposition' : 'refus d’une proposition', async function () {
            await A.Api.call('decide', { token: S.token, n: p.n, accept: yes, reply: reply || (yes ? 'Merci !' : '') }, { tries: 1 });
            S.dash = null; await A.refreshStrict(); A.toast(yes ? 'Ajouté au catalogue' : 'Proposition refusée');
          }, false);
        };
      });
    } };
  });

  function proposalCard(p, i) {
    var d = p.data || {}, body = '';
    if (p.type === 'recette' && d.recipe) {
      var ix = idxWith(d.ingredients || []);
      var t = C.recipeTotals({ lines: d.recipe.lines.map(function (l) { return { ing: l.ing, qty: C.num(l.qty) || 0 }; }), portions: d.recipe.portions || 1 }, ix).portion;
      body = '<p class="small">' + esc([d.recipe.categorie, d.recipe.objectif, d.recipe.portions + ' portion(s)'].filter(Boolean).join(' · ')) + '</p>' +
        '<ul class="small">' + d.recipe.lines.map(function (l) {
          var isNew = (d.ingredients || []).some(function (x) { return x.name === l.ing; });
          return '<li>' + esc(l.ing) + ' : ' + g(l.qty) + (isNew ? ' <span class="badge warn">nouvel ingrédient</span>' : '') + '</li>';
        }).join('') + '</ul>' + A.macroTable(t, 'Par portion') +
        ((d.ingredients || []).length ? '<p class="small"><b>Nouveaux ingrédients</b> (pour 100 g) : ' + d.ingredients.map(function (x) {
          return esc(x.name) + ' — ' + fmt(x.kcal) + ' kcal, P ' + fmt(x.p, 1) + ', G ' + fmt(x.g, 1) + ', L ' + fmt(x.l, 1) + (C.num(x.prix) !== null ? ', ' + euro(x.prix) + '/kg' : ', prix manquant');
        }).join(' ; ') + '</p>' : '') +
        (d.recipe.steps && d.recipe.steps.length ? '<details><summary>Étapes</summary><ol>' + d.recipe.steps.map(function (s) { return '<li>' + esc(s.text) + (s.timer ? ' (' + s.timer + ' min)' : '') + '</li>'; }).join('') + '</ol></details>' : '');
    } else if (p.type === 'ingrédient' && d.ingredient) {
      var x = d.ingredient;
      body = '<p class="small">Pour 100 g : ' + fmt(x.kcal) + ' kcal, P ' + fmt(x.p, 1) + ', G ' + fmt(x.g, 1) + ', L ' + fmt(x.l, 1) + ', F ' + fmt(x.f, 1) +
        (C.num(x.prix) !== null ? ' · ' + euro(x.prix) + '/kg' : ' · prix manquant') + ' · ' + esc(x.role || '') + ' · ' + esc(x.rayon || '') + (x.allergenes ? ' · ' + esc(x.allergenes) : '') + '</p>';
    } else if (p.type === 'prix' && d.offer) {
      body = '<p class="small">' + esc(d.offer.ing) + ' chez ' + esc(d.offer.magasin) + ' : ' + g(d.offer.pack) + ' pour ' + euro(d.offer.prix) + ' (' + euro(d.offer.prix / d.offer.pack * 1000) + '/kg)</p>';
    } else if (p.type === 'photo') {
      body = '<p class="small">Recette : ' + esc(d.recipe) + '</p>' + (d.image ? '<img class="hero" alt="Photo proposée" src="data:image/jpeg;base64,' + d.image + '">' : '');
    }
    return '<div class="panel"><div class="panel-title">' + esc(p.type) + ' · ' + esc(p.title) + '</div><p class="muted small">par ' + esc(p.by) + ' le ' + esc(A.dayFr(p.date)) + '</p>' + body +
      '<div class="row wrap"><button class="btn primary" data-decide="oui" data-i="' + i + '">Accepter</button><button class="btn ghost" data-decide="non" data-i="' + i + '">Refuser</button></div></div>';
  }

  /* ================= Comptes (admin) ================= */
  A.route(/^#\/comptes$/, function () {
    if (!A.isAdmin()) return A.redirect('#/plus');
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Comptes utilisateurs</h1>' +
      '<div id="signup-box"></div><div id="acc-list"><p class="muted">Chargement…</p></div>' +
      '<form id="acc-form" class="panel"><div class="panel-title">Créer un compte</div>' +
      A.field('Identifiant', '<input id="n-id" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" required>', 'Lettres, chiffres, point ou tiret, sans espace ni accent.') +
      A.field('Prénom', '<input id="n-pname" autocomplete="off" required>') +
      A.field('E-mail (facultatif)', '<input id="n-mail" type="email" autocapitalize="none" autocomplete="off">') +
      A.field('Mot de passe provisoire', '<input id="n-pw" autocomplete="new-password" minlength="8" required>', '8 caractères minimum. La personne pourra le changer dans Mon compte.') +
      A.field('Rôle', '<select id="n-role"><option value="client">Client</option><option value="admin">Admin</option></select>') +
      '<button class="btn primary big" type="submit">Créer le compte</button></form></section>',
      bind: function (el) {
        var load = function () {
          A.act('lecture des comptes', async function () {
            var r = await A.Api.call('listAccounts', { token: S.token });
            var sb = $('#signup-box', el); if (!sb) return;
            sb.innerHTML = '<div class="panel"><div class="panel-title">Inscriptions libres</div><p>' + (r.signupOpen ? 'Ouvertes : toute personne qui a le lien peut créer un compte.' : 'Fermées : seuls les comptes créés ici peuvent se connecter.') + '</p>' +
              '<button class="btn" id="su-toggle">' + (r.signupOpen ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions') + '</button></div>';
            $('#su-toggle', el).onclick = function () {
              A.act('inscriptions', async function () { await A.Api.call('setSignup', { token: S.token, open: !r.signupOpen }); load(); });
            };
            $('#acc-list', el).innerHTML = '<ul class="shop">' + r.accounts.map(function (a) {
              var self = a.id === S.me.id;
              return '<li><div class="acc"><div><b>' + esc(a.id) + '</b> · ' + esc(a.name) +
                ' <span class="badge ' + (a.role === 'admin' ? 'ok' : '') + '">' + a.role + '</span>' + (a.active ? '' : ' <span class="badge warn">désactivé</span>') +
                '<small>' + (a.email ? esc(a.email) + ' · ' : '') + (a.foyer ? 'foyer ' + esc(a.foyer) + ' · ' : '') +
                (a.lastLogin ? 'connecté le ' + esc(A.dayFr(String(a.lastLogin).slice(0, 10))) : 'jamais connecté') + '</small></div>' +
                '<div class="row wrap"><button class="btn small" data-reset="' + esc(a.id) + '">Nouveau mot de passe</button>' +
                (self ? '' : '<button class="btn small ghost" data-active="' + esc(a.id) + '" data-v="' + (a.active ? '0' : '1') + '">' + (a.active ? 'Désactiver' : 'Réactiver') + '</button>' +
                  '<button class="btn small ghost" data-role="' + esc(a.id) + '" data-v="' + (a.role === 'admin' ? 'client' : 'admin') + '">' + (a.role === 'admin' ? 'Passer client' : 'Passer admin') + '</button>') +
                '</div></div></li>';
            }).join('') + '</ul>';
            $$('[data-reset]', el).forEach(function (b) {
              b.onclick = function () {
                var pw = prompt('Nouveau mot de passe pour « ' + b.getAttribute('data-reset') + ' » (8 caractères minimum) :');
                if (!pw) return;
                A.act('réinitialisation du mot de passe', async function () {
                  await A.Api.call('resetPassword', { token: S.token, id: b.getAttribute('data-reset'), password: pw }, { tries: 1 }); A.toast('Mot de passe changé. Donne-le à la personne.'); load();
                }, false);
              };
            });
            $$('[data-active],[data-role]', el).forEach(function (b) {
              b.onclick = function () {
                var acc = b.hasAttribute('data-active') ? { id: b.getAttribute('data-active'), active: b.getAttribute('data-v') === '1' } : { id: b.getAttribute('data-role'), role: b.getAttribute('data-v') };
                A.act('modification du compte', async function () { await A.Api.call('updateAccount', { token: S.token, account: acc }); A.toast('Compte modifié'); load(); });
              };
            });
          });
        };
        load();
        $('#acc-form', el).onsubmit = function (e) {
          e.preventDefault();
          var acc = { id: $('#n-id').value.trim().toLowerCase(), name: $('#n-pname').value.trim(), email: $('#n-mail').value.trim(), password: $('#n-pw').value, role: $('#n-role').value };
          if (!/^[a-z0-9._-]{3,30}$/.test(acc.id)) { A.toast('Identifiant : 3 à 30 lettres/chiffres, sans espace ni accent.'); return; }
          if (acc.password.length < 8) { A.toast('Mot de passe : 8 caractères minimum.'); return; }
          A.act('création d’un compte', async function () {
            await A.Api.call('createAccount', { token: S.token, account: acc }, { tries: 1 }); A.toast('Compte « ' + acc.id + ' » créé'); $('#acc-form', el).reset(); load();
          }, false);
        };
      } };
  });

  /* ================= Gestion de la base (admin) ================= */
  A.route(/^#\/gestion$/, function () {
    if (!A.isAdmin()) return A.redirect('#/plus');
    var noRoles = !S.data.hasRoleColumns;
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Gestion de la base</h1>' +
      (noRoles ? '<div class="notice warn">Les colonnes Rôle et Rayon n’existent pas encore dans l’onglet Ingrédients.</div>' : '') +
      '<div class="stack">' +
      '<a class="btn primary big" href="#/ingredient/photo">📷 Nouvel ingrédient par photo</a>' +
      '<a class="btn big" href="#/ingredient/nouveau">Nouvel ingrédient à la main</a>' +
      '<a class="btn big" href="#/proposer">Nouvelle recette</a>' +
      '<a class="btn big" href="#/ingredients">Ingrédients : prix, rôle, rayon, allergènes</a>' +
      '<a class="btn big" href="#/proposer-prix">Prix en magasin (paquets)</a>' +
      '<button class="btn big" id="g-setup">' + (noRoles ? 'Ajouter Rôle et Rayon au Sheet' : 'Compléter Rôle et Rayon vides') + '</button>' +
      '<a class="btn big" href="#/comptes">Comptes utilisateurs</a></div></section>',
      bind: function () {
        $('#g-setup').onclick = function () {
          A.act('installation des colonnes', async function () { var r = await A.Api.call('setup', { token: S.token }); await A.refreshStrict(); A.toast(r.message || 'Fait'); });
        };
      } };
  });

  A.route(/^#\/ingredients$/, function () {
    if (!A.isAdmin()) return A.redirect('#/plus');
    var list = S.data.ingredients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/gestion">‹ Gestion</a><h1>Ingrédients</h1>' +
      '<input id="i-search" class="search" type="search" placeholder="Rechercher" aria-label="Rechercher">' +
      '<div class="stack">' + list.map(function (i) {
        return '<a class="card" data-name="' + esc(i.name) + '" href="#/ingredient/' + enc(i.name) + '"><div class="card-title">' + esc(i.name) + '</div>' +
          '<div class="macros-inline">' + fmt(i.kcal) + ' kcal · P ' + fmt(i.p, 1) + ' · G ' + fmt(i.g, 1) + ' · L ' + fmt(i.l, 1) + ' /100 g</div>' +
          '<div class="small">' + (C.num(i.prix) === null ? '<span class="badge warn">Prix manquant</span>' : euro(i.prix) + ' /kg') +
          ' · ' + esc(C.roleOf(i)) + (i.role ? '' : ' (proposé)') + ' · ' + esc(C.rayonOf(i)) + (i.allergenes ? ' · ' + esc(i.allergenes) : '') + '</div></a>';
      }).join('') + '</div></section>',
      bind: function (el) {
        var inp = $('#i-search', el);
        inp.oninput = function () { var v = C.norm(inp.value); $$('.card', el).forEach(function (c) { c.hidden = v && C.norm(c.getAttribute('data-name')).indexOf(v) < 0; }); };
      } };
  });

  A.route(/^#\/modifier-recette\/(.+)$/, function (name) {
    var r = A.recipeByName(name);
    if (!r || !A.isAdmin()) return A.redirect('#/recettes');
    var names = S.data.ingredients.map(function (i) { return i.name; });
    return { tab: 'recettes', html: '<section class="screen"><a class="back" href="#/recette/' + enc(r.name) + '">‹ ' + esc(r.name) + '</a>' +
      '<h1>Modifier les quantités</h1><p class="muted">Quantités pour toute la recette (' + (r.portions || 1) + ' portion(s)). Les plannings et listes de tout le monde se recalculent.</p>' +
      r.lines.map(function (l, i) {
        return '<div class="line-row"><span class="grow">' + esc(l.ing) + '</span><input type="number" inputmode="numeric" class="qty-in" data-q="' + i + '" value="' + esc(l.qty) + '" aria-label="Quantité en g">' +
          '<button class="btn ghost step" data-del="' + i + '" aria-label="Retirer ' + esc(l.ing) + '">✕</button></div>';
      }).join('') +
      '<div class="panel"><div class="panel-title">Ajouter un ingrédient</div><div class="line-row">' +
      '<input id="m-ing" list="ing-names" placeholder="Nom exact" aria-label="Ingrédient"><input id="m-qty" type="number" inputmode="numeric" class="qty-in" placeholder="g" aria-label="Quantité"></div>' +
      datalist('ing-names', names) + '<button class="btn" id="m-add">Ajouter</button></div></section>',
      bind: function (el) {
        $$('[data-q]', el).forEach(function (inp) {
          inp.onchange = function () {
            var l = r.lines[Number(inp.getAttribute('data-q'))], q = C.num(inp.value);
            if (q === null) return;
            A.act('modification d’une quantité', async function () { await A.Api.call('updateLine', { token: S.token, row: l.row, recipe: r.name, ing: l.ing, qty: q }); await A.refreshStrict(); A.toast('Quantité enregistrée'); });
          };
        });
        $$('[data-del]', el).forEach(function (b) {
          b.onclick = function () {
            var l = r.lines[Number(b.getAttribute('data-del'))];
            if (!confirm('Retirer ' + l.ing + ' de la recette ?')) return;
            A.act('retrait d’un ingrédient de recette', async function () { await A.Api.call('deleteLine', { token: S.token, row: l.row, recipe: r.name, ing: l.ing }); await A.refreshStrict(); A.toast('Retiré'); });
          };
        });
        $('#m-add', el).onclick = function () {
          var ing = $('#m-ing', el).value.trim(), q = C.num($('#m-qty', el).value);
          if (!C.find(S.idx, ing) || !q) { A.toast('Nom exact et quantité requis.'); return; }
          A.act('ajout d’un ingrédient à une recette', async function () { await A.Api.call('addLine', { token: S.token, recipe: r.name, line: { ing: ing, qty: q } }); await A.refreshStrict(); A.toast('Ajouté'); });
        };
      } };
  });
})(window.App);
