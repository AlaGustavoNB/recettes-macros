/* Écrans : objectifs, poids, foyer, mon compte. */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, Store = A.Store, $ = A.$, $$ = A.$$, esc = A.esc, fmt = A.fmt;

  function lastWeight() { var w = S.data.weights || []; return w.length ? w[w.length - 1].kg : null; }

  /* ================= Objectifs ================= */
  // Mêmes limites que le serveur : vérifiées avant l'envoi, avec un message clair par case.
  var LIMITS = [
    { id: 'p-annee', key: 'annee', min: 1920, max: 2015, label: 'Année de naissance', ex: '1995' },
    { id: 'p-taille', key: 'taille', min: 100, max: 250, label: 'Taille', ex: '175 (en cm)' },
    { id: 'p-poids', key: 'poids', min: 25, max: 400, label: 'Poids', ex: '72 (en kg)' },
    { id: 'p-seances', key: 'seances', min: 0, max: 21, label: 'Séances de sport', ex: '3' },
    { id: 'p-gkg', key: 'protGkg', min: 0.8, max: 3.5, label: 'Protéines par kg de poids', ex: '2' },
    { id: 'p-kcal', key: 'kcal', min: 800, max: 8000, label: 'kcal par jour', ex: '2200' },
    { id: 'p-prot', key: 'prot', min: 20, max: 500, label: 'Protéines par jour', ex: '140 (en g)' },
    { id: 'p-repas', key: 'repas', min: 1, max: 8, label: 'Repas par jour', ex: '3' }
  ];
  function outOfRange(v) {
    return LIMITS.filter(function (l) { var x = C.num(v[l.key]); return x !== null && (x < l.min || x > l.max); });
  }
  // Protéines par kg saisies comme un total par jour (ex. 110) : on propose de les déplacer.
  function gkgLooksDaily(v) { var x = C.num(v.protGkg); return x !== null && x > 3.5 && x >= 20 && x <= 500; }

  A.route(/^#\/profil$/, function () {
    var p = A.prof() || { objectif: 'Maintien', repas: 3, marge: 10 };
    var first = !A.prof();
    var draft = Store.get(A.pk('profDraft'), null) || {};
    var v = Object.assign({}, p, { poids: lastWeight() }, draft);
    var sel = function (id, cur, opts) {
      return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    };
    var tg = C.targets(v);
    var split = C.macroSplit(v.kcal, v.prot, v.poids);
    var alls = C.splitList(v.allergies).map(C.norm);
    var names = S.data.ingredients.map(function (i) { return i.name; });
    var html = '<section class="screen">' + (first ? '' : '<a class="back" href="#/plus">‹ Plus</a>') +
      '<h1>' + (first ? 'Bienvenue ' + esc(S.me.name) + ' !' : 'Mes objectifs') + '</h1>' +
      (first ? '<p>Règle tes objectifs : les quantités de chaque recette seront calculées pour toi. Ils ne sont visibles que par toi.</p>' : '<p class="muted">Visibles par toi seul.</p>') +
      '<div class="panel"><div class="panel-title">1. Toi</div><div class="grid2">' +
      A.field('Sexe', sel('p-sexe', v.sexe, [['', '—'], ['F', 'Femme'], ['H', 'Homme']])) +
      A.field('Année de naissance', '<input id="p-annee" type="number" inputmode="numeric" min="1920" max="2015" value="' + esc(v.annee || '') + '">') +
      A.field('Taille (cm)', '<input id="p-taille" type="number" inputmode="numeric" value="' + esc(v.taille || '') + '">') +
      A.field('Poids (kg)', A.numIn('p-poids', v.poids)) +
      A.field('Séances de sport / semaine', '<input id="p-seances" type="number" inputmode="numeric" min="0" max="21" value="' + esc(v.seances == null ? '' : v.seances) + '">') +
      A.field('Métier', sel('p-metier', v.metier, [['', '—'], ['assis', 'Plutôt assis'], ['debout', 'Debout / marche'], ['physique', 'Physique']])) +
      A.field('Objectif', sel('p-obj', v.objectif, [['Sèche', 'Sèche (perdre du gras)'], ['Maintien', 'Maintien'], ['Masse', 'Masse (prendre du muscle)']])) +
      A.field('Protéines par kg de poids', A.numIn('p-gkg', v.protGkg, ' placeholder="ex. 2"'), 'Entre 0,8 et 3,5 g par kilo (pas le total du jour). Vide = 2 en sèche, 1,6 en maintien, 1,8 en masse.') +
      '</div>' +
      (gkgLooksDaily(v) ? '<div class="notice warn" id="p-gkg-warn"><b>' + fmt(C.num(v.protGkg)) + '</b> g par kilo, c’est trop : tu voulais sûrement <b>' + fmt(C.num(v.protGkg)) +
        ' g de protéines par jour</b> ?<br><button class="btn small" id="p-gkg-move">Oui, le mettre dans « Protéines par jour »</button></div>'
        : (outOfRange({ protGkg: v.protGkg }).length ? '<div class="notice warn">Protéines par kg : mets une valeur entre 0,8 et 3,5 (ex. 2).</div>' : '')) +
      (tg ? '<div class="notice">Proposition : <b>' + fmt(tg.kcal) + ' kcal</b> et <b>' + fmt(tg.prot) + ' g de protéines</b> par jour ' +
        '<span class="muted small">(métabolisme ' + fmt(tg.bmr) + ' kcal × activité ' + String(tg.factor).replace('.', ',') + (C.norm(v.objectif) === 'seche' ? ' − 20 %' : C.norm(v.objectif) === 'masse' ? ' + 10 %' : '') + ')</span>' +
        '<br><button class="btn small" id="p-use">Utiliser ces valeurs</button></div>'
        : '<p class="muted small">Remplis sexe, année, taille et poids pour obtenir une proposition.</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">2. Mes cibles par jour</div><div class="grid2">' +
      A.field('kcal par jour', '<input id="p-kcal" type="number" inputmode="numeric" value="' + esc(v.kcal || '') + '">') +
      A.field('Protéines par jour (g)', '<input id="p-prot" type="number" inputmode="numeric" value="' + esc(v.prot || '') + '">') +
      A.field('Repas par jour', '<input id="p-repas" type="number" inputmode="numeric" min="1" max="8" value="' + esc(v.repas || 3) + '">') +
      A.field('Marge sur les protéines', sel('p-marge', C.num(v.marge) === 5 ? 5 : 10, [[10, '10 %'], [5, '5 %']])) + '</div>' +
      (split ? '<p class="muted small">À titre indicatif : environ ' + fmt(split.lip) + ' g de lipides et ' + fmt(split.glu) + ' g de glucides par jour.</p>' : '') + '</div>' +
      '<div class="panel"><div class="panel-title">3. Ce que je ne mange pas</div>' +
      '<div class="checks">' + C.ALLERGENES.map(function (a) {
        return '<label class="toggle"><input type="checkbox" data-all="' + esc(a) + '"' + (alls.indexOf(C.norm(a)) >= 0 ? ' checked' : '') + '> ' + esc(a) + '</label>';
      }).join('') + '</div>' +
      A.field('Ingrédients précis à exclure', '<input id="p-exclus" list="ing-names" value="' + esc(C.splitList(v.exclus).join(' ; ')) + '" placeholder="ex. Brocoli cuit ; Cabillaud cru">', 'Séparés par « ; ». Les recettes concernées sont masquées.') +
      '<datalist id="ing-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
      '<button class="btn primary big" id="p-save">Enregistrer</button></section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var read = function () {
        return { sexe: $('#p-sexe').value, annee: C.num($('#p-annee').value), taille: C.num($('#p-taille').value), poids: C.num($('#p-poids').value),
          seances: C.num($('#p-seances').value), metier: $('#p-metier').value, objectif: $('#p-obj').value, protGkg: C.num($('#p-gkg').value),
          kcal: C.num($('#p-kcal').value), prot: C.num($('#p-prot').value), repas: C.num($('#p-repas').value) || 3, marge: C.num($('#p-marge').value),
          allergies: $$('[data-all]', el).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-all'); }),
          exclus: C.splitList($('#p-exclus').value) };
      };
      // Le calcul proposé se met à jour quand on change les infos.
      ['#p-sexe', '#p-annee', '#p-taille', '#p-poids', '#p-seances', '#p-metier', '#p-obj', '#p-gkg'].forEach(function (s) {
        $(s, el).addEventListener('change', function () { Store.set(A.pk('profDraft'), read()); A.render(); });
      });
      var use = $('#p-use', el);
      if (use) use.onclick = function () { $('#p-kcal').value = tg.kcal; $('#p-prot').value = tg.prot; Store.set(A.pk('profDraft'), read()); A.toast('Valeurs proposées reprises : corrige si besoin'); };
      var mv = $('#p-gkg-move', el);
      if (mv) mv.onclick = function () {
        var d = read(); d.prot = C.num(d.protGkg); d.protGkg = null;
        Store.set(A.pk('profDraft'), d); A.render(); A.toast('Mis dans « Protéines par jour »');
      };
      $('#p-save', el).onclick = function () {
        var np = read();
        $$('.field input', el).forEach(function (i) { i.classList.remove('bad'); });
        var bads = outOfRange(np);
        if (bads.length) {
          var b = bads[0], inp = $('#' + b.id, el);
          if (inp) { inp.classList.add('bad'); inp.focus(); inp.scrollIntoView({ block: 'center' }); }
          A.toast(b.label + ' : entre ' + fmt(b.min, 1) + ' et ' + fmt(b.max, 1) + ' (ex. ' + b.ex + ').');
          return;
        }
        if (!np.kcal || !np.prot) { A.toast('kcal et protéines par jour sont obligatoires (utilise la proposition si besoin).'); return; }
        var bad = np.exclus.filter(function (n) { return !C.find(S.idx, n); });
        if (bad.length && !confirm('Pas trouvé dans les ingrédients (nom exact) : ' + bad.join(', ') + '. Enregistrer quand même ?')) return;
        A.act('enregistrement des objectifs', async function () {
          await A.Api.call('saveProfile', { token: S.token, profile: np });
          if (np.poids && np.poids !== lastWeight()) await A.Api.call('addWeight', { token: S.token, date: C.isoDay(new Date()), kg: np.poids });
          Store.del(A.pk('profDraft'));
          await A.loadData(); S.fw = {};
          A.toast('Objectifs enregistrés'); A.go(first ? '#/recettes' : '#/plus');
        });
      };
    } };
  });

  /* ================= Poids ================= */
  function chart(weeks) {
    if (weeks.length < 2) return '';
    var W = 320, H = 140, pad = 28;
    var ys = weeks.map(function (w) { return w.avg; });
    var min = Math.min.apply(null, ys) - 0.5, max = Math.max.apply(null, ys) + 0.5;
    var x = function (i) { return pad + i * (W - pad - 10) / (weeks.length - 1); };
    var y = function (v) { return H - 20 - (v - min) / (max - min) * (H - 40); };
    var pts = weeks.map(function (w, i) { return x(i).toFixed(1) + ',' + y(w.avg).toFixed(1); }).join(' ');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Évolution du poids moyen par semaine">' +
      '<text x="2" y="' + (y(max - 0.5) + 4).toFixed(0) + '" class="ax">' + fmt(max - 0.5, 1) + '</text>' +
      '<text x="2" y="' + (y(min + 0.5) + 4).toFixed(0) + '" class="ax">' + fmt(min + 0.5, 1) + '</text>' +
      '<polyline points="' + pts + '" class="line"/>' +
      weeks.map(function (w, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(w.avg).toFixed(1) + '" r="3.5" class="dot"><title>' + A.dayFr(w.week) + ' : ' + fmt(w.avg, 1) + ' kg</title></circle>'; }).join('') +
      '<text x="' + x(0) + '" y="' + (H - 4) + '" class="ax">' + esc(A.dayFr(weeks[0].week)) + '</text>' +
      '<text x="' + (x(weeks.length - 1) - 40) + '" y="' + (H - 4) + '" class="ax">' + esc(A.dayFr(weeks[weeks.length - 1].week)) + '</text></svg>';
  }

  A.route(/^#\/poids$/, function () {
    var p = A.prof() || {}, ws = S.data.weights || [];
    var tr = C.weightTrend(ws, p.objectif, p.kcal);
    var html = '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Mon poids</h1>' +
      '<p class="muted">Visible par toi seul. Pèse-toi quand tu veux (idéalement le matin) : l’appli fait une moyenne par semaine.</p>' +
      '<div class="panel"><div class="row">' + A.field('Date', '<input id="w-date" type="date" value="' + C.isoDay(new Date()) + '">') +
      A.field('Poids (kg)', A.numIn('w-kg', '')) + '</div><button class="btn primary big" id="w-add">Ajouter</button></div>' +
      (tr.suggestion ? '<div class="notice warn"><b>Proposition :</b> ' + esc(tr.suggestion.why) + ' Passer de ' + fmt(p.kcal) + ' à <b>' + fmt(tr.suggestion.kcal) + ' kcal</b> par jour ?' +
        '<div class="row wrap"><button class="btn" id="w-apply">Appliquer</button><button class="btn ghost" id="w-skip">Pas maintenant</button></div></div>' : '') +
      (tr.rate !== null ? '<p>Tendance : <b>' + (tr.rate > 0 ? '+' : '') + fmt(tr.rate, 2) + ' %</b> par semaine (objectif ' + esc(p.objectif || '—') + ').</p>' :
        '<p class="muted small">La tendance et les propositions d’ajustement apparaissent après 3 semaines de mesures.</p>') +
      chart(tr.weeks) +
      (ws.length ? '<ul class="shop">' + ws.slice().reverse().slice(0, 30).map(function (w) {
        return '<li><div class="stock-row"><span class="s-name">' + esc(A.dayFr(w.date)) + '</span><span class="s-qty">' + fmt(w.kg, 1) + ' kg</span>' +
          '<button class="btn ghost step" data-wdel="' + esc(w.date) + '" aria-label="Supprimer">✕</button></div></li>';
      }).join('') + '</ul>' : '<p>Aucune mesure pour l’instant.</p>') + '</section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var skipped = Store.get(A.pk('skipAdjust'), '');
      $('#w-add', el).onclick = function () {
        var d = $('#w-date', el).value, kg = C.num($('#w-kg', el).value);
        if (!d || !kg || kg < 25 || kg > 400) { A.toast('Indique un poids valide en kg.'); return; }
        S.data.weights = (S.data.weights || []).filter(function (w) { return w.date !== d; }).concat([{ date: d, kg: kg }])
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        A.saveData(); A.Sync.push('poids:' + d, 'addWeight', { date: d, kg: kg }); A.toast('Poids enregistré'); A.render();
      };
      $$('[data-wdel]', el).forEach(function (b) {
        b.onclick = function () {
          var d = b.getAttribute('data-wdel');
          S.data.weights = S.data.weights.filter(function (w) { return w.date !== d; }); A.saveData();
          A.Sync.push('poids:' + d, 'deleteWeight', { date: d }); A.render();
        };
      });
      var ap = $('#w-apply', el);
      if (ap) ap.onclick = function () {
        A.act('ajustement des kcal', async function () {
          var np = Object.assign({}, p, { kcal: tr.suggestion.kcal });
          await A.Api.call('saveProfile', { token: S.token, profile: np }); await A.loadData(); S.fw = {};
          A.toast('Objectif passé à ' + fmt(tr.suggestion.kcal) + ' kcal'); A.render();
        });
      };
      var sk = $('#w-skip', el); if (sk) sk.onclick = function () { Store.set(A.pk('skipAdjust'), tr.weeks[tr.weeks.length - 1].week); A.render(); };
      if (skipped && tr.suggestion && tr.weeks.length && skipped === tr.weeks[tr.weeks.length - 1].week) { var n = $('.notice.warn', el); if (n) n.hidden = true; }
    } };
  });

  /* ================= Foyer ================= */
  A.route(/^#\/foyer$/, function () {
    var f = S.data.foyer;
    var html = '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Mon foyer</h1>' +
      '<p class="muted">Un foyer partage une liste de courses, des cases cochées et un stock cuisine. Chacun garde ses objectifs (invisibles des autres) : ' +
      'les quantités de chaque repas sont calculées pour la personne qui le mange.</p>' +
      (f ? '<div class="panel"><div class="panel-title">' + esc(f.name) + '</div>' +
        '<p>Code à donner pour rejoindre : <b class="code">' + esc(f.code) + '</b></p>' +
        '<div class="row wrap"><button class="btn" id="f-copy">Copier le code</button>' + (navigator.share ? '<button class="btn" id="f-share">Envoyer le code</button>' : '') + '</div>' +
        '<p><b>Membres :</b> ' + f.members.map(function (m) { return esc(m.name); }).join(', ') + '</p>' +
        '<button class="btn ghost big" id="f-leave">Quitter le foyer</button></div>'
        : '<div class="panel"><div class="panel-title">Créer un foyer</div>' +
        A.field('Nom du foyer', '<input id="f-name" maxlength="40" placeholder="ex. Maison, Coloc">') +
        '<button class="btn primary big" id="f-create">Créer</button></div>' +
        '<div class="panel"><div class="panel-title">Rejoindre un foyer</div>' +
        A.field('Code reçu', '<input id="f-code" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ex. K7M2QX">') +
        '<button class="btn big" id="f-join">Rejoindre</button></div>') + '</section>';
    return { tab: 'plus', html: html, bind: function (el) {
      var after = async function (msg) { await A.Sync.flush(); await A.loadData(); S.fw = {}; A.toast(msg); A.render(); };
      var cr = $('#f-create', el);
      if (cr) cr.onclick = function () { A.act('création du foyer', async function () { await A.Api.call('createFoyer', { token: S.token, name: $('#f-name', el).value.trim() }); await after('Foyer créé : donne le code aux autres'); }); };
      var jn = $('#f-join', el);
      if (jn) jn.onclick = function () {
        var code = $('#f-code', el).value.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) { A.toast('Le code fait 6 caractères.'); return; }
        A.act('rejoindre un foyer', async function () { await A.Api.call('joinFoyer', { token: S.token, code: code }); await after('Bienvenue dans le foyer !'); }, false);
      };
      var cp = $('#f-copy', el); if (cp) cp.onclick = function () { A.copyText(f.code).then(function () { A.toast('Code copié'); }); };
      var sh = $('#f-share', el);
      if (sh) sh.onclick = function () { navigator.share({ title: 'Rejoins mon foyer', text: 'Code du foyer « ' + f.name + ' » dans La Juste Assiette : ' + f.code + '\n' + location.origin + location.pathname }).catch(function () {}); };
      var lv = $('#f-leave', el);
      if (lv) lv.onclick = function () {
        if (!confirm('Quitter le foyer ? Le stock reste au foyer' + (f.members.length === 1 ? ' (et sera supprimé : tu es le dernier membre)' : '') + '.')) return;
        A.act('quitter le foyer', async function () { await A.Api.call('leaveFoyer', { token: S.token }); await after('Tu as quitté le foyer'); });
      };
    } };
  });

  /* ================= Inviter des proches (QR code) ================= */
  var APP_URL = 'https://alagustavonb.github.io/recettes-macros/';
  function posterPng() {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = 920; c.height = 1180;
        c.getContext('2d').drawImage(img, 0, 0, 920, 1180);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('image')); }, 'image/png');
      };
      img.onerror = function () { reject(A.Api.ApiError('Image indisponible.', 'PHOTO')); };
      // L'icône est intégrée dans l'affiche pour qu'elle apparaisse aussi dans l'image enregistrée.
      Promise.all([fetch('qr-affiche.svg').then(function (r) { return r.text(); }), fetch('icons/icon-192.png').then(function (r) { return r.blob(); })])
        .then(function (res) {
          var fr = new FileReader();
          fr.onload = function () {
            var svg = res[0].replace(/(xlink:)?href="icons\/icon-192\.png"/g, function (m, x) { return (x || '') + 'href="' + fr.result + '"'; });
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          };
          fr.readAsDataURL(res[1]);
        }, reject);
    });
  }
  A.route(/^#\/inviter$/, function () {
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Inviter des proches</h1>' +
      '<p>Fais scanner ce code avec l’appareil photo de leur téléphone : l’appli s’ouvre, ils créent leur compte puis l’installent sur l’écran d’accueil.</p>' +
      '<div class="qr-box"><img src="qr-appli.svg" alt="QR code qui ouvre ' + esc(APP_URL) + '" width="280" height="280"></div>' +
      '<p class="muted small center">' + esc(APP_URL.replace('https://', '')) + '</p>' +
      '<div class="stack"><button class="btn primary big" id="q-img">Envoyer l’image du QR code</button>' +
      '<button class="btn big" id="q-share">Partager le lien</button>' +
      '<button class="btn ghost big" id="q-copy">Copier le lien</button></div>' +
      (S.data.foyer ? '<p class="muted small">Pour partager aussi vos courses, donne-leur ensuite le code du foyer : <b class="code small-code">' + esc(S.data.foyer.code) + '</b> (Plus › Mon foyer).</p>' : '') +
      '</section>',
      bind: function (el) {
        $('#q-copy', el).onclick = function () { A.copyText(APP_URL).then(function () { A.toast('Lien copié'); }); };
        $('#q-share', el).onclick = function () {
          if (navigator.share) navigator.share({ title: 'La Juste Assiette', text: 'Rejoins-moi sur La Juste Assiette (recettes, courses, portions calculées pour toi) :', url: APP_URL }).catch(function () {});
          else A.copyText(APP_URL).then(function () { A.toast('Lien copié : colle-le dans un message'); });
        };
        $('#q-img', el).onclick = function () {
          A.act('préparation de l’image du QR code', async function () {
            var blob = await posterPng();
            var file = new File([blob], 'la-juste-assiette-qr.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'La Juste Assiette' }).catch(function () {});
            } else {
              var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
              document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
              A.toast('Image enregistrée');
            }
          });
        };
      } };
  });

  /* ================= Mon compte ================= */
  A.route(/^#\/compte$/, function () {
    return { tab: 'plus', html: '<section class="screen"><a class="back" href="#/plus">‹ Plus</a><h1>Mon compte</h1>' +
      '<p>Identifiant : <b>' + esc(S.me.id) + '</b> · prénom : <b>' + esc(S.me.name) + '</b></p>' +
      '<form id="e-form" class="panel"><div class="panel-title">E-mail</div>' +
      A.field('Adresse e-mail', '<input id="e-mail" type="email" autocomplete="email" autocapitalize="none" value="' + esc(S.me.email || '') + '" required>', 'Pour recevoir un code si tu oublies ton mot de passe.') +
      '<button class="btn" type="submit">Enregistrer l’e-mail</button></form>' +
      '<form id="a-form" class="panel"><div class="panel-title">Changer mon mot de passe</div>' +
      A.field('Mot de passe actuel', '<input id="a-old" type="password" autocomplete="current-password" required>') +
      A.field('Nouveau mot de passe', '<input id="a-new" type="password" autocomplete="new-password" minlength="8" required>', '8 caractères minimum') +
      A.field('Nouveau mot de passe (encore)', '<input id="a-new2" type="password" autocomplete="new-password" required>') +
      '<button class="btn primary" type="submit">Changer le mot de passe</button></form>' +
      '<button class="btn ghost big" id="a-out">Se déconnecter</button>' +
      '<details class="panel danger"><summary>Supprimer mon compte</summary>' +
      '<p>Supprime définitivement ton compte, tes objectifs, ton poids, tes plannings et tes avis. Tes recettes déjà acceptées restent au catalogue.' +
      (S.data.foyer ? ' Tu quittes aussi le foyer.' : '') + ' Impossible d’annuler.</p>' +
      A.field('Mot de passe pour confirmer', '<input id="d-pw" type="password" autocomplete="current-password">') +
      '<button class="btn danger big" id="d-go">Supprimer définitivement</button></details>' +
      '<p class="center"><a href="confidentialite.html">Page de confidentialité</a></p></section>',
      bind: function () {
        $('#a-out').onclick = function () { A.logout('Déconnecté'); };
        $('#e-form').onsubmit = function (e) {
          e.preventDefault();
          A.act('enregistrement de l’e-mail', async function () {
            var r = await A.Api.call('setEmail', { token: S.token, email: $('#e-mail').value.trim() });
            A.setSession(S.token, Object.assign({}, S.me, { email: r.email })); A.toast('E-mail enregistré');
          }, false);
        };
        $('#a-form').onsubmit = function (e) {
          e.preventDefault();
          var o = $('#a-old').value, n1 = $('#a-new').value;
          if (n1.length < 8) { A.toast('8 caractères minimum.'); return; }
          if (n1 !== $('#a-new2').value) { A.toast('Les deux nouveaux mots de passe sont différents.'); return; }
          A.act('changement de mot de passe', async function () {
            var r = await A.Api.call('changePassword', { token: S.token, oldPassword: o, newPassword: n1 }, { tries: 1 });
            A.setSession(r.token, S.me); A.toast('Mot de passe changé'); A.go('#/plus');
          }, false);
        };
        $('#d-go').onclick = function () {
          var pw = $('#d-pw').value;
          if (!pw) { A.toast('Saisis ton mot de passe pour confirmer.'); return; }
          if (!confirm('Supprimer définitivement ton compte ? Impossible d’annuler.')) return;
          A.act('suppression du compte', async function () {
            await A.Api.call('deleteMe', { token: S.token, password: pw }, { tries: 1 });
            A.logout('Compte supprimé. Au revoir !');
          }, false);
        };
      } };
  });
})(window.App);
