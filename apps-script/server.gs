/**
 * Serveur de l'appli La Juste Assiette : lit et écrit dans CE Google Sheet.
 * À coller dans Extensions > Apps Script du Sheet (fichier Code.gs), puis déployer en
 * « Application Web » (Exécuter en tant que : moi ; Accès : tout le monde).
 *
 * NE PAS MODIFIER Code.gs À LA MAIN : il est fabriqué par build.sh à partir de
 * apps-script/server.gs + web/calc.js (les mêmes calculs que l'appli).
 *
 * Règles respectées :
 *  - onglets et colonnes existants inchangés ; nouvelles colonnes ajoutées à la fin ;
 *  - aucune écriture dans les colonnes calculées (Recettes G–Q et T, Lignes_recette D–I) ;
 *  - écriture sur la première ligne vide (colonne A vide) ;
 *  - mots de passe jamais stockés en clair ; jetons signés avec un secret des Propriétés du script.
 */

var TABS = {
  ING: 'Ingrédients', REC: 'Recettes', LIG: 'Lignes_recette', ETA: 'Étapes', STO: 'Stock cuisine',
  PRO: 'Profils', CPT: 'Comptes', FOY: 'Foyers', PLA: 'Plannings', CRS: 'Courses', POI: 'Poids',
  AVI: 'Avis', PRP: 'Propositions', PRX: 'Prix magasin', PHO: 'Photos', TCK: 'Tickets'
};
// En-têtes des onglets créés par l'appli (et colonnes ajoutées aux onglets existants).
var HEADS = {
  'Comptes': ['Identifiant', 'Prénom (profil)', 'Rôle', 'Actif', 'Créé le', 'Dernière connexion',
    'Empreinte mot de passe (ne pas modifier)', 'Sel (ne pas modifier)', 'E-mail', 'Foyer'],
  'Profils': ['Prénom', 'kcal cibles / jour', 'Protéines cibles / jour (g)', 'Objectif', 'Repas par jour',
    'Marge protéines (%)', 'Mis à jour le', 'Sexe', 'Année de naissance', 'Taille (cm)', 'Séances sport / semaine',
    'Métier', 'Protéines (g/kg)', 'Allergies', 'Ingrédients exclus'],
  'Foyers': ['Code', 'Nom', 'Créé par', 'Créé le'],
  'Plannings': ['Semaine (lundi)', 'Identifiant', 'Recette', 'Jour', 'Créneau', 'kcal / portion', 'Cuisiné', 'Reste', 'Version (ne pas modifier)', 'Id'],
  'Courses': ['Semaine (lundi)', 'Foyer', 'Cochés', 'Terminées le', 'Mis à jour le'],
  'Poids': ['Identifiant', 'Date', 'Poids (kg)'],
  'Avis': ['Recette', 'Identifiant', 'Favori', 'Note (1-5)', 'Commentaire', 'Date'],
  'Propositions': ['N°', 'Type', 'Statut', 'Par', 'Date', 'Titre', 'Données (ne pas modifier)', 'Réponse'],
  'Prix magasin': ['Ingrédient', 'Magasin', 'Conditionnement (g)', 'Prix du paquet (€)', 'Date', 'Par'],
  'Photos': ['Recette', 'Image (ne pas modifier)', 'Par', 'Date'],
  'Tickets': ['N°', 'Date', 'Par', 'Écran', 'Erreur', 'Rapport', 'Commentaire', 'Statut', 'Réponse']
};
var EXTRA_COLS = { 'Ingrédients': { 14: 'Allergènes' }, 'Stock cuisine': { 5: 'Foyer' } };

var TOKEN_DAYS = 365; // connexion gardée un an, renouvelée à chaque utilisation
var MAX_FAILS = 5;
var LOCK_SECONDS = 15 * 60;
var HASH_ROUNDS = 300;
var MAX_SIGNUPS_PER_HOUR = 20;
var BACKUP_FOLDER = 'Sauvegardes recettes';
var BACKUP_KEEP = 8;
var JOURS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
var CRENEAUX = ['midi', 'soir', 'collation', 'matin'];

/* ===================== Menu dans le Sheet ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Appli recettes')
    .addItem('1. Installer / vérifier', 'installer')
    .addItem('2. Créer ou réinitialiser mon compte admin', 'creerCompteAdmin')
    .addItem('3. Faire une sauvegarde maintenant', 'sauvegardeHebdo')
    .addToUi();
}

function installer() {
  var ss = SpreadsheetApp.getActive();
  [TABS.ING, TABS.REC, TABS.LIG, TABS.ETA, TABS.STO].forEach(function (n) {
    if (!ss.getSheetByName(n)) throw new Error('Onglet introuvable : ' + n);
  });
  var r = setup_();
  var msg = 'Installation OK.\n' + r.message;
  try { msg += '\n' + installTrigger_(); } catch (e) { msg += '\nSauvegarde automatique non installée : ' + e.message; }
  if (!accounts_().some(function (a) { return a.role === 'admin'; })) {
    msg += '\n\nÉtape suivante : menu Appli recettes > 2. Créer ou réinitialiser mon compte admin.';
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function creerCompteAdmin() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Compte admin (1/3)', 'Identifiant de connexion (lettres, chiffres, point ou tiret ; ex. nacim) :', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var id = normId_(r1.getResponseText());
  if (!id) { ui.alert('Identifiant invalide (3 à 30 caractères : lettres, chiffres, point, tiret).'); return; }
  var r2 = ui.prompt('Compte admin (2/3)', 'Prénom du profil associé (ex. Nacim) :', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var name = r2.getResponseText().trim();
  if (!name) { ui.alert('Prénom obligatoire.'); return; }
  var r3 = ui.prompt('Compte admin (3/3)', 'Mot de passe (8 caractères minimum). Il ne sera pas visible ensuite : note-le.', ui.ButtonSet.OK_CANCEL);
  if (r3.getSelectedButton() !== ui.Button.OK) return;
  try {
    withLock_(function () {
      ensureAll_();
      var existing = findAccount_(id);
      if (existing) {
        setPassword_(existing.row, r3.getResponseText());
        sheet_(TABS.CPT).getRange(existing.row, 2, 1, 3).setValues([[name, 'admin', 'Oui']]);
      } else {
        createAccount_({ id: id, name: name, role: 'admin', password: r3.getResponseText() });
      }
    });
    ui.alert('Compte admin « ' + id + ' » prêt. Connecte-toi dans l’appli avec cet identifiant et ce mot de passe.');
  } catch (e) { ui.alert(e.message); }
}

/* ===================== Points d'entrée Web ===================== */

function doGet(e) { return handle_((e && e.parameter) || {}); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, code: 'REQUETE', error: 'Requête illisible.' }); }
  return handle_(body);
}

// Actions qui ne font que lire : elles profitent de la mémoire d'un appel (READ_CACHE).
var READ_ONLY = { data: 1, check: 1, foyerWeek: 1, photos: 1, barcode: 1, signupInfo: 1, ping: 1, dashboard: 1, listAccounts: 1 };

function handle_(req) {
  try {
    var action = req.action || 'data';
    var out, me;
    SS_CACHE = null;
    READ_CACHE = READ_ONLY[action] ? {} : null;
    var PUBLIC = {
      ping: function () { return { pong: true }; },
      login: function () { return withLock_(function () { return login_(req.id, req.password); }); },
      signupInfo: function () { return { open: signupOpen_() }; },
      signup: function () { return withLock_(function () { return signup_(req.account); }); },
      forgot: function () { return forgot_(req.email); },
      resetWithCode: function () { return withLock_(function () { return resetWithCode_(req.email, req.code, req.password); }); },
      ticket: function () { return withLock_(function () { return ticket_(req.token, req.ticket); }); }
    };
    if (PUBLIC[action]) out = PUBLIC[action]();
    else {
      me = auth_(req.token);
      var USER = {
        data: function () {
          var d = getData_(me); d.me = publicMe_(me);
          var fresh = renewToken_(req.token, me); if (fresh) d.token = fresh; // rester connecté tant qu'on utilise l'appli
          return d;
        },
        check: function () { return { me: publicMe_(me) }; },
        changePassword: function () { return withLock_(function () { return changePassword_(me, req.oldPassword, req.newPassword); }); },
        setEmail: function () { return withLock_(function () { return setEmail_(me, req.email); }); },
        deleteMe: function () { return withLock_(function () { return deleteMe_(me, req.password); }); },
        saveProfile: function () { return withLock_(function () { return saveProfile_(me, req.profile); }); },
        addWeight: function () { return withLock_(function () { return addWeight_(me, req.date, req.kg); }); },
        deleteWeight: function () { return withLock_(function () { return deleteWeight_(me, req.date); }); },
        createFoyer: function () { return withLock_(function () { return createFoyer_(me, req.name); }); },
        joinFoyer: function () { return withLock_(function () { return joinFoyer_(me, req.code); }); },
        leaveFoyer: function () { return withLock_(function () { return leaveFoyer_(me); }); },
        savePlan: function () { return withLock_(function () { return savePlan_(me, req.week, req.rows); }); },
        foyerWeek: function () { return foyerWeek_(me, req.week); },
        saveChecks: function () { return withLock_(function () { return saveChecks_(me, req.week, req.checked); }); },
        finishShopping: function () { return withLock_(function () { return finishShopping_(me, req.week, req.items); }); },
        cooked: function () { return withLock_(function () { return cooked_(me, req.week, req.ids, req.used, req.leftovers); }); },
        setStock: function () { return withLock_(function () { return setStock_(me, req.items); }); },
        setAvis: function () { return withLock_(function () { return setAvis_(me, req.recipe, req.avis); }); },
        propose: function () { return withLock_(function () { return propose_(me, req.type, req.title, req.data); }); },
        photos: function () { return photos_(req.names); },
        barcode: function () { return offLookup_(req.code); },
        ocr: function () { checkOcrQuota_(me); return ocr_(req.image, req.mime); }
      };
      if (USER[action]) out = USER[action]();
      else {
        if (me.role !== 'admin') throw err_('NON_AUTORISE', 'Action réservée à l’admin.');
        out = withLock_(function () { return adminAction_(action, req, me); });
      }
    }
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, code: err.code || 'ERREUR', error: String(err.message || err) });
  }
}

function adminAction_(action, req, me) {
  switch (action) {
    case 'listAccounts': return { accounts: accounts_().map(publicAccount_), signupOpen: signupOpen_() };
    case 'createAccount': return createAccount_(req.account);
    case 'updateAccount': return updateAccount_(req.account, me);
    case 'resetPassword': return resetPassword_(req.id, req.password);
    case 'setSignup':
      PropertiesService.getScriptProperties().setProperty('SIGNUP_OPEN', req.open ? 'oui' : 'non');
      return { signupOpen: signupOpen_() };
    case 'dashboard': return dashboard_();
    case 'resolveTicket': return resolveTicket_(req.n, req.reply);
    case 'decide': return decide_(me, req.n, req.accept, req.reply, req.data);
    case 'deleteComment': return deleteComment_(req.recipe, req.id);
    case 'setPhoto': return setPhoto_(req.recipe, req.image, me.id);
    case 'setOffer': return upsertOffer_(req.offer, me.id);
    case 'deleteOffer': return deleteOffer_(req.ing, req.magasin);
    case 'setup': return setup_();
    case 'addIngredient': return addIngredient_(req.ingredient);
    case 'updateIngredient': return updateIngredient_(req.row, req.name, req.ingredient);
    case 'addRecipe': return addRecipe_(req.recipe);
    case 'addLine': return addLines_(req.recipe, [req.line]);
    case 'updateLine': return updateLine_(req.row, req.recipe, req.ing, req.qty);
    case 'deleteLine': return deleteLine_(req.row, req.recipe, req.ing);
    default: throw err_('ACTION', 'Action inconnue : ' + action);
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('OCCUPE', 'Le Sheet est occupé, réessaie dans quelques secondes.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Accès au Sheet ===================== */

/* Mémoire d'un seul appel (vitesse) : pour les actions de LECTURE, chaque onglet n'est lu
   qu'une fois. Désactivée pour les actions qui écrivent (comportement inchangé). */
var READ_CACHE = null, SS_CACHE = null;
function ss_() { return SS_CACHE || (SS_CACHE = SpreadsheetApp.getActive()); }
function sheetOrNull_(name) {
  if (READ_CACHE && READ_CACHE.hasOwnProperty('#' + name)) return READ_CACHE['#' + name];
  var s = ss_().getSheetByName(name);
  if (READ_CACHE) READ_CACHE['#' + name] = s;
  return s;
}
function sheet_(name) {
  var s = sheetOrNull_(name);
  if (!s) throw err_('ONGLET', 'Onglet introuvable : ' + name + '. Dans le Sheet : menu Appli recettes > 1. Installer / vérifier.');
  if (READ_CACHE) delete READ_CACHE[name]; // l'onglet va peut-être être modifié : on le relira
  return s;
}
function has_(name) { return !!sheetOrNull_(name); }

function ensureCols_(s, n) {
  var max = s.getMaxColumns();
  if (max < n) s.insertColumnsAfter(max, n - max);
}

// Lignes de données (à partir de la ligne 2), complétées par des cases vides si l'onglet est plus étroit.
function rows_(name, ncol) {
  if (READ_CACHE && READ_CACHE[name] && READ_CACHE[name].ncol >= ncol) return READ_CACHE[name].rows;
  var s = sheetOrNull_(name);
  if (!s) return [];
  var last = s.getLastRow();
  // En mode lecture, toutes les colonnes utiles sont lues d'un coup (une seule lecture par onglet).
  var want = READ_CACHE ? Math.max(ncol, 21) : ncol;
  var rows = [];
  if (last >= 2) {
    var nc = Math.min(want, s.getMaxColumns());
    rows = s.getRange(2, 1, last - 1, nc).getValues().map(function (v, i) {
      while (v.length < want) v.push('');
      v.row = i + 2; return v;
    });
  }
  if (READ_CACHE) READ_CACHE[name] = { ncol: want, rows: rows };
  return rows;
}
function filled_(name, ncol) { return rows_(name, ncol).filter(function (r) { return s_(r[0]).trim(); }); }
function clearRow_(name, row, ncol) { sheet_(name).getRange(row, 1, 1, ncol).clearContent(); }

function n_(v) { return v === '' || v === null || v === undefined ? null : (typeof v === 'number' ? v : Number(String(v).replace(',', '.'))); }
function s_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v == null ? '' : v); }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function firstEmptyRow_(sheet, maxRow) {
  var last = Math.max(sheet.getLastRow(), 2);
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === '') return i + 2;
  var r = last + 1;
  if (maxRow && r > maxRow) throw err_('PLEIN', 'L’onglet « ' + sheet.getName() + ' » est plein (lignes de formules prévues jusqu’à ' + maxRow + '). Prolonge les formules dans le Sheet.');
  return r;
}
function appendRow_(name, values) {
  var s = sheet_(name);
  ensureCols_(s, values.length);
  var r = firstEmptyRow_(s, 0);
  s.getRange(r, 1, 1, values.length).setValues([values]);
  return r;
}

function normName_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function checkNumber_(v, label, min, max) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < min || n > max) throw err_('VALEUR', label + ' invalide : ' + v);
  return n;
}
function checkWeek_(w) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w || ''))) throw err_('VALEUR', 'Semaine invalide.');
  return String(w);
}
function cleanText_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 500); }

/* ===================== Installation (onglets et colonnes) ===================== */

function ensureTab_(name) {
  var ss = ss_(), s = ss.getSheetByName(name), head = HEADS[name];
  if (!s) {
    s = ss.insertSheet(name);
    ensureCols_(s, head.length);
    s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    s.setFrozenRows(1);
    return true;
  }
  // Colonnes ajoutées dans une version plus récente : en-têtes complétés à la fin.
  ensureCols_(s, head.length);
  var cur = s.getRange(1, 1, 1, head.length).getValues()[0];
  for (var i = 0; i < head.length; i++) if (!s_(cur[i])) s.getRange(1, i + 1).setValue(head[i]).setFontWeight('bold');
  return false;
}
function ensureAll_() {
  var created = [];
  ['Profils', 'Comptes', 'Foyers', 'Plannings', 'Courses', 'Poids', 'Avis', 'Propositions', 'Prix magasin', 'Photos', 'Tickets'].forEach(function (n) {
    if (ensureTab_(n)) created.push(n);
  });
  Object.keys(EXTRA_COLS).forEach(function (tab) {
    var s = sheet_(tab);
    Object.keys(EXTRA_COLS[tab]).forEach(function (c) {
      c = Number(c); ensureCols_(s, c);
      if (!s_(s.getRange(1, c).getValue())) s.getRange(1, c).setValue(EXTRA_COLS[tab][c]).setFontWeight('bold');
    });
  });
  return created;
}

function setup_() {
  var s = sheet_(TABS.ING);
  var head = s.getRange(1, 12, 1, 2).getValues()[0];
  var added = false;
  if (!head[0] || !head[1]) {
    s.getRange(1, 12, 1, 2).setValues([['Rôle', 'Rayon']]);
    s.getRange(1, 1).copyFormatToRange(s, 12, 13, 1, 1);
    added = true;
  }
  var created = ensureAll_();
  var roles = SpreadsheetApp.newDataValidation().requireValueInList(['protéine', 'glucide', 'lipide', 'légume', 'autre'], true).setAllowInvalid(true).build();
  var rayons = SpreadsheetApp.newDataValidation().requireValueInList(['viandes', 'féculents', 'légumes', 'épicerie', 'autre'], true).setAllowInvalid(true).build();
  var maxR = Math.max(s.getMaxRows(), 2);
  s.getRange(2, 12, maxR - 1, 1).setDataValidation(roles);
  s.getRange(2, 13, maxR - 1, 1).setDataValidation(rayons);
  var filled = 0;
  rows_(TABS.ING, 13).forEach(function (r) {
    if (!s_(r[0]).trim()) return;
    var role = s_(r[11]) || suggestRole_(n_(r[2]), n_(r[3]), n_(r[4]), n_(r[5]));
    var rayon = s_(r[12]) || suggestRayon_(role);
    if (!s_(r[11]) || !s_(r[12])) { s.getRange(r.row, 12, 1, 2).setValues([[role, rayon]]); filled++; }
  });
  return { message: (added ? 'Colonnes Rôle et Rayon ajoutées. ' : 'Colonnes Rôle et Rayon déjà présentes. ') +
    filled + ' ingrédient(s) complété(s) avec une valeur par défaut, à corriger si besoin.' +
    (created.length ? ' Onglets créés : ' + created.join(', ') + '.' : '') };
}

// Même règle que calc.js (suggestRole).
function suggestRole_(k, p, g, l) { return Calc.suggestRole({ kcal: k, p: p, g: g, l: l }); }
function suggestRayon_(role) { return Calc.suggestRayon(role); }

/* ===================== Sauvegarde hebdomadaire ===================== */

function installTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sauvegardeHebdo'; });
  if (!exists) ScriptApp.newTrigger('sauvegardeHebdo').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  return 'Sauvegarde automatique : chaque dimanche vers 3 h (dossier Drive « ' + BACKUP_FOLDER + ' », ' + BACKUP_KEEP + ' dernières gardées).';
}
function sauvegardeHebdo() {
  var ss = ss_();
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' — sauvegarde ' + today_(), folder);
  var files = [], f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (x) { x.setTrashed(true); });
  try { SpreadsheetApp.getUi().alert('Sauvegarde faite dans le dossier Drive « ' + BACKUP_FOLDER + ' ».'); } catch (e) { /* déclencheur automatique */ }
}

/* ===================== Comptes ===================== */

function normId_(s) { var id = String(s || '').trim().toLowerCase(); return /^[a-z0-9._-]{3,30}$/.test(id) ? id : ''; }
function normEmail_(s) {
  var e = String(s || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : '';
}
function signupOpen_() { return PropertiesService.getScriptProperties().getProperty('SIGNUP_OPEN') !== 'non'; }

function accounts_() {
  return filled_(TABS.CPT, 10).map(function (r) {
    return { row: r.row, id: s_(r[0]).trim().toLowerCase(), name: s_(r[1]).trim(),
      role: s_(r[2]).trim().toLowerCase() === 'admin' ? 'admin' : 'client',
      active: s_(r[3]).trim().toLowerCase() !== 'non', created: s_(r[4]), lastLogin: s_(r[5]),
      hash: s_(r[6]), salt: s_(r[7]), email: s_(r[8]).trim().toLowerCase(), foyer: s_(r[9]).trim().toUpperCase() };
  });
}
function findAccount_(id) {
  id = String(id || '').trim().toLowerCase();
  return accounts_().filter(function (a) { return a.id === id; })[0] || null;
}
function findByEmail_(email) {
  email = normEmail_(email);
  return email ? accounts_().filter(function (a) { return a.email === email; })[0] || null : null;
}
function publicAccount_(a) {
  return { id: a.id, name: a.name, role: a.role, active: a.active, created: a.created, lastLogin: a.lastLogin, email: a.email, foyer: a.foyer };
}
function publicMe_(me) { return { id: me.id, name: me.name, role: me.role, email: me.email, foyer: me.foyer }; }

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', secret); }
  return secret;
}
function hmac_(s, key) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, key)); }
function hash_(password, salt) {
  var h = String(password);
  for (var i = 0; i < HASH_ROUNDS; i++) h = hmac_(h + '|' + i, salt);
  return h;
}
function checkPassword_(p) {
  p = String(p || '');
  if (p.length < 8) throw err_('VALEUR', 'Mot de passe trop court (8 caractères minimum).');
  if (p.length > 100) throw err_('VALEUR', 'Mot de passe trop long.');
  return p;
}
function setPassword_(row, password) {
  var salt = Utilities.getUuid();
  sheet_(TABS.CPT).getRange(row, 7, 1, 2).setValues([[hash_(checkPassword_(password), salt), salt]]);
}

function nameTaken_(name, exceptId) {
  var k = normName_(name);
  if (accounts_().some(function (x) { return x.id !== exceptId && normName_(x.name) === k; })) return true;
  return false;
}

function createAccount_(a) {
  ensureAll_();
  a = a || {};
  var id = normId_(a.id);
  if (!id) throw err_('VALEUR', 'Identifiant invalide : 3 à 30 caractères (lettres, chiffres, point, tiret), sans espace ni accent.');
  var name = cleanText_(a.name, 40);
  if (!name) throw err_('VALEUR', 'Le prénom du profil est obligatoire.');
  if (findAccount_(id)) throw err_('DOUBLON', 'Cet identifiant est déjà pris.');
  var email = '';
  if (a.email) {
    email = normEmail_(a.email);
    if (!email) throw err_('VALEUR', 'Adresse e-mail invalide.');
    if (findByEmail_(email)) throw err_('DOUBLON', 'Un compte existe déjà avec cette adresse e-mail.');
  }
  checkPassword_(a.password);
  var r = appendRow_(TABS.CPT, [id, name, a.role === 'admin' ? 'admin' : 'client', 'Oui', new Date(), '', '', '', email, '']);
  setPassword_(r, a.password);
  return { row: r, id: id };
}

// Inscription libre depuis l'appli : toujours un compte client, profil au prénom choisi.
function signup_(a) {
  if (!signupOpen_()) throw err_('INSCRIPTION_FERMEE', 'Les inscriptions sont fermées. Demande un compte à l’admin.');
  a = a || {};
  if (!a.consent) throw err_('VALEUR', 'Merci d’accepter la page de confidentialité.');
  if (!normEmail_(a.email)) throw err_('VALEUR', 'Adresse e-mail invalide.');
  var name = cleanText_(a.name, 40);
  if (!name) throw err_('VALEUR', 'Prénom obligatoire (40 caractères maximum).');
  var taken = nameTaken_(name, null) || filled_(TABS.PRO, 1).some(function (r) { return normName_(r[0]) === normName_(name); });
  if (taken) throw err_('DOUBLON', 'Ce prénom est déjà pris : ajoute l’initiale de ton nom (ex. ' + name + ' L.).');
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('signups') || 0);
  if (n >= MAX_SIGNUPS_PER_HOUR) throw err_('BLOQUE', 'Trop d’inscriptions en ce moment. Réessaie dans une heure.');
  createAccount_({ id: a.id, name: name, role: 'client', password: a.password, email: a.email });
  cache.put('signups', String(n + 1), 3600);
  return login_(a.id, a.password);
}

function updateAccount_(a, me) {
  var acc = findAccount_(a && a.id);
  if (!acc) throw err_('INTROUVABLE', 'Compte introuvable.');
  var role = a.role === undefined ? acc.role : (a.role === 'admin' ? 'admin' : 'client');
  var active = a.active === undefined ? acc.active : !!a.active;
  if (acc.id === me.id && (role !== 'admin' || !active)) throw err_('VALEUR', 'Tu ne peux pas retirer tes propres droits admin.');
  sheet_(TABS.CPT).getRange(acc.row, 3, 1, 2).setValues([[role, active ? 'Oui' : 'Non']]);
  return { id: acc.id };
}
function resetPassword_(id, password) {
  var acc = findAccount_(id);
  if (!acc) throw err_('INTROUVABLE', 'Compte introuvable.');
  setPassword_(acc.row, password); // nouveau sel : les anciennes connexions de ce compte sont coupées
  return { id: acc.id };
}
function changePassword_(me, oldPassword, newPassword) {
  var acc = findAccount_(me.id);
  if (!acc || hash_(String(oldPassword || ''), acc.salt) !== acc.hash) throw err_('MDP_FAUX', 'Mot de passe actuel incorrect.');
  setPassword_(acc.row, newPassword);
  return { token: makeToken_(findAccount_(me.id)) };
}
function setEmail_(me, email) {
  var e = normEmail_(email);
  if (!e) throw err_('VALEUR', 'Adresse e-mail invalide.');
  var other = findByEmail_(e);
  if (other && other.id !== me.id) throw err_('DOUBLON', 'Un compte existe déjà avec cette adresse e-mail.');
  sheet_(TABS.CPT).getRange(me.row, 9).setValue(e);
  return { email: e };
}

// Jeton renouvelé automatiquement s'il a plus d'une semaine : on reste connecté tant qu'on ouvre l'appli
// au moins une fois par an. « Se déconnecter » ou un changement de mot de passe y mettent fin.
function renewToken_(token, acc) {
  var exp = Number(String(token || '').split('|')[1]) || 0;
  return exp - Date.now() < (TOKEN_DAYS - 7) * 86400000 ? makeToken_(acc) : null;
}
function makeToken_(acc) {
  var exp = Date.now() + TOKEN_DAYS * 86400000;
  var payload = acc.id + '|' + exp + '|' + acc.salt.slice(0, 8);
  return payload + '|' + hmac_(payload, secret_());
}

function login_(id, password) {
  id = String(id || '').trim().toLowerCase();
  if (!id || !password) throw err_('VALEUR', 'Saisis ton identifiant et ton mot de passe.');
  var cache = CacheService.getScriptCache();
  var key = 'fails:' + id;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) throw err_('BLOQUE', 'Trop d’essais. Réessaie dans 15 minutes.');
  if (!accounts_().length) throw err_('PAS_DE_COMPTE', 'Aucun compte n’existe encore. Dans le Sheet : menu Appli recettes > 2. Créer ou réinitialiser mon compte admin.');
  var acc = findAccount_(id) || (id.indexOf('@') > 0 ? findByEmail_(id) : null);
  if (!acc || !acc.active || !acc.salt || hash_(String(password), acc.salt) !== acc.hash) {
    cache.put(key, String(fails + 1), LOCK_SECONDS);
    throw err_('MDP_FAUX', 'Identifiant ou mot de passe incorrect.');
  }
  cache.remove(key);
  sheet_(TABS.CPT).getRange(acc.row, 6).setValue(new Date());
  return { token: makeToken_(acc), me: publicMe_(acc) };
}

function auth_(token) {
  var p = String(token || '').split('|');
  var fail = err_('NON_CONNECTE', 'Connexion expirée : reconnecte-toi.');
  if (p.length !== 4) throw fail;
  if (hmac_(p[0] + '|' + p[1] + '|' + p[2], secret_()) !== p[3]) throw fail;
  if (Number(p[1]) < Date.now()) throw fail;
  var acc = findAccount_(p[0]);
  if (!acc || !acc.active || acc.salt.slice(0, 8) !== p[2]) throw fail;
  return acc;
}

/* ---------- Mot de passe oublié (code par e-mail, gratuit via Gmail) ---------- */
function resetCodeHash_(id, code) { return hmac_('reset|' + id + '|' + code, secret_()); }
function forgot_(email) {
  var e = normEmail_(email);
  if (!e) throw err_('VALEUR', 'Adresse e-mail invalide.');
  var cache = CacheService.getScriptCache();
  var sent = Number(cache.get('rstm:' + e) || 0);
  if (sent >= 3) throw err_('BLOQUE', 'Trop de demandes. Réessaie dans une heure.');
  cache.put('rstm:' + e, String(sent + 1), 3600);
  var acc = findByEmail_(e);
  if (acc && acc.active) {
    var code = String(100000 + Math.floor(Math.random() * 900000));
    cache.put('rst:' + acc.id, resetCodeHash_(acc.id, code), 900);
    cache.put('rstn:' + acc.id, '0', 900);
    MailApp.sendEmail({ to: e, subject: 'La Juste Assiette : ton code pour changer de mot de passe',
      body: 'Bonjour ' + acc.name + ',\n\nTon code : ' + code + '\nIl est valable 15 minutes.\n\n' +
        'Ton identifiant : ' + acc.id + '\n\nSi tu n’as rien demandé, ignore ce message.' });
  }
  // Même réponse que l'adresse existe ou non (on ne révèle pas qui a un compte).
  return { sent: true };
}
function resetWithCode_(email, code, password) {
  var acc = findByEmail_(email);
  var cache = CacheService.getScriptCache();
  var bad = err_('CODE_FAUX', 'Code incorrect ou expiré. Redemande un code.');
  if (!acc) throw bad;
  var tries = Number(cache.get('rstn:' + acc.id) || 0);
  var h = cache.get('rst:' + acc.id);
  if (!h || tries >= 5) throw bad;
  if (resetCodeHash_(acc.id, String(code || '').trim()) !== h) { cache.put('rstn:' + acc.id, String(tries + 1), 900); throw bad; }
  setPassword_(acc.row, password);
  cache.remove('rst:' + acc.id);
  return login_(acc.id, password);
}

/* ---------- Suppression de son compte ---------- */
function deleteMe_(me, password) {
  var acc = findAccount_(me.id);
  if (!acc || hash_(String(password || ''), acc.salt) !== acc.hash) throw err_('MDP_FAUX', 'Mot de passe incorrect.');
  if (acc.role === 'admin' && !accounts_().some(function (a) { return a.role === 'admin' && a.active && a.id !== acc.id; })) {
    throw err_('VALEUR', 'Tu es le seul admin : crée un autre admin avant de supprimer ton compte.');
  }
  if (acc.foyer) leaveFoyer_(acc);
  else {
    filled_(TABS.STO, 5).forEach(function (r) { if (s_(r[4]) === '@' + acc.id) clearRow_(TABS.STO, r.row, 5); });
    filled_(TABS.CRS, 5).forEach(function (r) { if (s_(r[1]) === '@' + acc.id) clearRow_(TABS.CRS, r.row, 5); });
  }
  filled_(TABS.PLA, 10).forEach(function (r) { if (s_(r[1]) === acc.id) clearRow_(TABS.PLA, r.row, 10); });
  filled_(TABS.POI, 3).forEach(function (r) { if (s_(r[0]) === acc.id) clearRow_(TABS.POI, r.row, 3); });
  filled_(TABS.AVI, 6).forEach(function (r) { if (s_(r[1]) === acc.id) clearRow_(TABS.AVI, r.row, 6); });
  filled_(TABS.PRO, 15).forEach(function (r) { if (s_(r[0]) === acc.name) clearRow_(TABS.PRO, r.row, 15); });
  filled_(TABS.PRP, 8).forEach(function (r) { if (s_(r[3]) === acc.id) sheet_(TABS.PRP).getRange(r.row, 4).setValue('(compte supprimé)'); });
  clearRow_(TABS.CPT, acc.row, 10);
  return { deleted: true };
}

/* ===================== Catalogue et données ===================== */

function catalog_() {
  var ingredients = filled_(TABS.ING, 14).map(function (r) {
    return { row: r.row, name: s_(r[0]), etat: s_(r[1]), kcal: n_(r[2]), p: n_(r[3]), g: n_(r[4]), l: n_(r[5]),
      f: n_(r[6]), prix: n_(r[7]), magasin: s_(r[8]), source: s_(r[9]), remarque: s_(r[10]),
      role: s_(r[11]), rayon: s_(r[12]), allergenes: s_(r[13]) };
  });
  var lines = filled_(TABS.LIG, 3);
  var steps = filled_(TABS.ETA, 4);
  var recipes = filled_(TABS.REC, 21).map(function (r) {
    var name = s_(r[0]);
    return { row: r.row, name: name, portions: n_(r[1]), categorie: s_(r[2]), objectif: s_(r[3]),
      prepa: n_(r[4]), cuisson: n_(r[5]), favori: s_(r[17]), statut: s_(r[18]), controle: s_(r[19]), notes: s_(r[20]),
      sheet: { kcal: n_(r[11]), p: n_(r[12]), g: n_(r[13]), l: n_(r[14]), coutPortion: n_(r[16]) },
      lines: lines.filter(function (l) { return s_(l[0]) === name; }).map(function (l) { return { row: l.row, ing: s_(l[1]), qty: n_(l[2]) }; }),
      steps: steps.filter(function (x) { return s_(x[0]) === name; })
        .map(function (x) { return { n: n_(x[1]), text: s_(x[2]), timer: n_(x[3]) }; })
        .sort(function (a, b) { return (a.n || 0) - (b.n || 0); }) };
  });
  return { ingredients: ingredients, recipes: recipes };
}

function profileOf_(name) {
  var r = filled_(TABS.PRO, 15).filter(function (x) { return s_(x[0]) === name; })[0];
  if (!r) return null;
  return { row: r.row, name: s_(r[0]), kcal: n_(r[1]), prot: n_(r[2]), objectif: s_(r[3]), repas: n_(r[4]), marge: n_(r[5]),
    maj: s_(r[6]), sexe: s_(r[7]), annee: n_(r[8]), taille: n_(r[9]), seances: n_(r[10]), metier: s_(r[11]),
    protGkg: n_(r[12]), allergies: s_(r[13]), exclus: s_(r[14]) };
}

// Clé du foyer d'un compte : code du foyer, ou « @identifiant » pour une personne seule.
function key_(acc) { return acc.foyer ? acc.foyer : '@' + acc.id; }
// Ancien stock sans colonne Foyer : il appartient au premier admin.
function legacyKey_() {
  var a = accounts_().filter(function (x) { return x.role === 'admin'; })[0];
  return a ? key_(a) : '';
}
function stockRows_(key) {
  var legacy = legacyKey_();
  return filled_(TABS.STO, 5).filter(function (r) { return (s_(r[4]) || legacy) === key; });
}
function members_(acc) {
  if (!acc.foyer) return [acc];
  return accounts_().filter(function (a) { return a.foyer === acc.foyer && a.active; });
}

function getData_(me) {
  var cat = catalog_();
  var key = key_(me);
  var stock = stockRows_(key).map(function (r) { return { row: r.row, ing: s_(r[0]), qty: n_(r[1]), date: s_(r[2]), remarque: s_(r[3]) }; });
  var weights = filled_(TABS.POI, 3).filter(function (r) { return s_(r[0]) === me.id; })
    .map(function (r) { return { date: s_(r[1]), kg: n_(r[2]) }; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var foyer = null;
  if (me.foyer) {
    var f = filled_(TABS.FOY, 4).filter(function (r) { return s_(r[0]).toUpperCase() === me.foyer; })[0];
    foyer = { code: me.foyer, name: f ? s_(f[1]) : me.foyer, members: members_(me).map(function (a) { return { id: a.id, name: a.name }; }) };
  }
  var weekMin = Calc.isoDay(new Date(Date.now() - 14 * 864e5));
  var plan = filled_(TABS.PLA, 10).filter(function (r) { return s_(r[1]) === me.id && s_(r[0]) >= weekMin; }).map(planRow_);
  var checks = {};
  filled_(TABS.CRS, 5).forEach(function (r) {
    if (s_(r[1]) !== key) return;
    var c = []; try { c = JSON.parse(s_(r[2]) || '[]'); } catch (e) {}
    checks[s_(r[0])] = { checked: c, done: s_(r[3]) };
  });
  var avis = avisSummary_(me);
  var offers = filled_(TABS.PRX, 6).map(function (r) { return { ing: s_(r[0]), magasin: s_(r[1]), pack: n_(r[2]), prix: n_(r[3]), date: s_(r[4]) }; });
  var photos = photoNames_();
  var mine = filled_(TABS.PRP, 8).filter(function (r) { return s_(r[3]) === me.id; }).map(function (r) {
    return { n: n_(r[0]), type: s_(r[1]), statut: s_(r[2]), date: s_(r[4]), title: s_(r[5]), reply: s_(r[7]) };
  });
  var out = { ingredients: cat.ingredients, recipes: cat.recipes, stock: stock, profile: profileOf_(me.name), weights: weights,
    foyer: foyer, plan: plan, checks: checks, avis: avis.recipes, myAvis: avis.mine, offers: offers, photos: photos,
    myProposals: mine, hasRoleColumns: s_(sheetOrNull_(TABS.ING).getRange(1, 12).getValue()) !== '',
    fetchedAt: new Date().toISOString() };
  if (me.role === 'admin') {
    out.pending = filled_(TABS.PRP, 8).filter(function (r) { return s_(r[2]) === 'en attente'; }).length;
    out.signupOpen = signupOpen_();
    out.tickets = filled_(TABS.TCK, 8).filter(function (r) { return s_(r[7]) !== 'résolu'; }).length;
  }
  return out;
}

/* ===================== Profil, poids ===================== */

function saveProfile_(me, p) {
  p = p || {};
  ensureAll_();
  var name = me.name; // chacun ne modifie que son propre profil
  var objectif = ['Sèche', 'Maintien', 'Masse'].indexOf(p.objectif) >= 0 ? p.objectif : 'Maintien';
  var metier = ['assis', 'debout', 'physique'].indexOf(p.metier) >= 0 ? p.metier : '';
  var row = [name, checkNumber_(p.kcal, 'kcal cibles', 800, 8000), checkNumber_(p.prot, 'Protéines cibles', 20, 500),
    objectif, checkNumber_(p.repas, 'Repas par jour', 1, 8) || 3, checkNumber_(p.marge, 'Marge', 1, 10) || 10, new Date(),
    p.sexe === 'F' ? 'F' : (p.sexe === 'H' ? 'H' : ''), checkNumber_(p.annee, 'Année de naissance', 1900, 2025),
    checkNumber_(p.taille, 'Taille', 100, 250), checkNumber_(p.seances, 'Séances', 0, 21), metier,
    checkNumber_(p.protGkg, 'Protéines par kg', 0.8, 3.5), cleanText_(Calc.splitList(p.allergies).join(', '), 300),
    cleanText_(Calc.splitList(p.exclus).join(' ; '), 500)];
  if (row[1] === '' || row[2] === '') throw err_('VALEUR', 'kcal et protéines sont obligatoires.');
  var found = profileOf_(name);
  var s = sheet_(TABS.PRO);
  ensureCols_(s, 15);
  var r = found ? found.row : firstEmptyRow_(s, 0);
  s.getRange(r, 1, 1, 15).setValues([row]);
  return { row: r };
}

function addWeight_(me, date, kg) {
  ensureAll_();
  var d = checkWeek_(date);
  var k = checkNumber_(kg, 'Poids', 25, 400);
  if (k === '') throw err_('VALEUR', 'Poids manquant.');
  var ex = filled_(TABS.POI, 3).filter(function (r) { return s_(r[0]) === me.id && s_(r[1]) === d; })[0];
  if (ex) sheet_(TABS.POI).getRange(ex.row, 3).setValue(k);
  else appendRow_(TABS.POI, [me.id, d, k]);
  return { date: d, kg: k };
}
function deleteWeight_(me, date) {
  filled_(TABS.POI, 3).forEach(function (r) { if (s_(r[0]) === me.id && s_(r[1]) === date) clearRow_(TABS.POI, r.row, 3); });
  return {};
}

/* ===================== Foyers ===================== */

function newCode_() {
  var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', used = {};
  filled_(TABS.FOY, 1).forEach(function (r) { used[s_(r[0]).toUpperCase()] = 1; });
  for (var t = 0; t < 50; t++) {
    var c = '';
    for (var i = 0; i < 6; i++) c += A.charAt(Math.floor(Math.random() * A.length));
    if (!used[c]) return c;
  }
  throw err_('ERREUR', 'Impossible de créer un code, réessaie.');
}
// Le stock et la liste de la personne seule rejoignent le foyer.
function moveKey_(from, to, alsoLegacy) {
  filled_(TABS.STO, 5).forEach(function (r) {
    var k = s_(r[4]);
    if (k === from || (alsoLegacy && !k)) sheet_(TABS.STO).getRange(r.row, 5).setValue(to);
  });
}
function createFoyer_(me, name) {
  ensureAll_();
  if (me.foyer) throw err_('VALEUR', 'Tu fais déjà partie d’un foyer. Quitte-le d’abord.');
  var code = newCode_();
  appendRow_(TABS.FOY, [code, cleanText_(name, 40) || ('Foyer de ' + me.name), me.id, new Date()]);
  sheet_(TABS.CPT).getRange(me.row, 10).setValue(code);
  moveKey_('@' + me.id, code, legacyKey_() === '@' + me.id);
  return { code: code };
}
function joinFoyer_(me, code) {
  code = String(code || '').trim().toUpperCase();
  if (!filled_(TABS.FOY, 1).some(function (r) { return s_(r[0]).toUpperCase() === code; })) throw err_('INTROUVABLE', 'Code de foyer inconnu.');
  if (me.foyer === code) return { code: code };
  if (me.foyer) leaveFoyer_(me);
  sheet_(TABS.CPT).getRange(me.row, 10).setValue(code);
  moveKey_('@' + me.id, code, legacyKey_() === '@' + me.id);
  return { code: code };
}
function leaveFoyer_(me) {
  var code = me.foyer;
  if (!code) return {};
  sheet_(TABS.CPT).getRange(me.row, 10).setValue('');
  var left = accounts_().filter(function (a) { return a.foyer === code; });
  if (!left.length) { // dernier membre : le foyer, son stock et ses listes disparaissent
    filled_(TABS.FOY, 4).forEach(function (r) { if (s_(r[0]).toUpperCase() === code) clearRow_(TABS.FOY, r.row, 4); });
    filled_(TABS.STO, 5).forEach(function (r) { if (s_(r[4]) === code) clearRow_(TABS.STO, r.row, 5); });
    filled_(TABS.CRS, 5).forEach(function (r) { if (s_(r[1]) === code) clearRow_(TABS.CRS, r.row, 5); });
  }
  return {};
}

/* ===================== Planning ===================== */

function planRow_(r) {
  var v = null; try { v = s_(r[8]) ? JSON.parse(s_(r[8])) : null; } catch (e) { v = null; }
  return { row: r.row, week: s_(r[0]), by: s_(r[1]), recipe: s_(r[2]), day: s_(r[3]), slot: s_(r[4]), kcal: n_(r[5]),
    cooked: s_(r[6]) === 'Oui', reste: s_(r[7]) === 'Oui', version: v, id: s_(r[9]) };
}

// Remplace les repas de la personne pour la semaine. Un repas déjà marqué « cuisiné »
// (par un autre membre du foyer) le reste.
function savePlan_(me, week, rows) {
  ensureAll_();
  week = checkWeek_(week);
  rows = (rows || []).slice(0, 60);
  var names = {}; catalog_().recipes.forEach(function (r) { names[r.name] = 1; });
  var existing = filled_(TABS.PLA, 10).filter(function (r) { return s_(r[0]) === week && s_(r[1]) === me.id; });
  var cookedIds = {}; existing.forEach(function (r) { if (s_(r[6]) === 'Oui' && s_(r[9])) cookedIds[s_(r[9])] = 1; });
  var values = rows.map(function (x) {
    if (!names[x.recipe]) throw err_('INTROUVABLE', 'Recette introuvable : ' + x.recipe);
    var id = /^[\w-]{1,40}$/.test(String(x.id || '')) ? String(x.id) : Utilities.getUuid().slice(0, 12);
    var ver = x.version && x.version.length ? JSON.stringify(x.version.slice(0, 30).map(function (v) { return { name: String(v.name), qty: Number(v.qty) || 0 }; })) : '';
    return [week, me.id, x.recipe, JOURS.indexOf(x.day) >= 0 ? x.day : '', CRENEAUX.indexOf(x.slot) >= 0 ? x.slot : '',
      checkNumber_(x.kcal, 'kcal', 50, 5000), (x.cooked || cookedIds[id]) ? 'Oui' : '', x.reste ? 'Oui' : '', ver, id];
  });
  var s = sheet_(TABS.PLA);
  var slots = existing.map(function (r) { return r.row; });
  values.forEach(function (v, i) {
    var r = i < slots.length ? slots[i] : firstEmptyRow_(s, 0);
    s.getRange(r, 1, 1, 10).setValues([v]);
  });
  slots.slice(values.length).forEach(function (r) { clearRow_(TABS.PLA, r, 10); });
  return { count: values.length };
}

// Repas de tout le foyer pour une semaine, chacun calculé selon les objectifs de son auteur.
// Les objectifs eux-mêmes ne sont jamais renvoyés.
function foyerWeek_(me, week) {
  week = checkWeek_(week);
  var cat = catalog_(), idx = Calc.index(cat.ingredients), byName = {};
  cat.recipes.forEach(function (r) { byName[r.name] = r; });
  var mem = members_(me), ids = {}, profs = {};
  mem.forEach(function (a) { ids[a.id] = a; profs[a.id] = profileOf_(a.name); });
  var meals = [], warnings = [];
  filled_(TABS.PLA, 10).forEach(function (r) {
    if (s_(r[0]) !== week || !ids[s_(r[1])]) return;
    var p = planRow_(r), rec = byName[p.recipe];
    if (!rec) { warnings.push('Recette supprimée du catalogue : ' + p.recipe); return; }
    var m = Calc.mealItems(p, rec, idx, profs[p.by]);
    if (m.status === 'error') warnings.push(p.recipe + ' : ' + m.messages[0]);
    meals.push({ id: p.id, by: p.by, byName: ids[p.by].name, recipe: p.recipe, day: p.day, slot: p.slot,
      cooked: p.cooked, reste: p.reste, items: m.items, status: m.status });
  });
  return { week: week, members: mem.map(function (a) { return { id: a.id, name: a.name }; }), meals: meals, warnings: warnings };
}

function saveChecks_(me, week, checked) {
  ensureAll_();
  week = checkWeek_(week);
  var key = key_(me), json = JSON.stringify((checked || []).slice(0, 300).map(String));
  var ex = filled_(TABS.CRS, 5).filter(function (r) { return s_(r[0]) === week && s_(r[1]) === key; })[0];
  if (ex) sheet_(TABS.CRS).getRange(ex.row, 3, 1, 3).setValues([[json, s_(ex[3]), new Date()]]);
  else appendRow_(TABS.CRS, [week, key, json, '', new Date()]);
  return {};
}

// Une seule ligne de stock par ingrédient et par foyer : les doublons éventuels sont additionnés puis effacés.
function stockLine_(key, ing) {
  var rows = stockRows_(key).filter(function (r) { return s_(r[0]) === ing; });
  if (!rows.length) return null;
  var total = rows.reduce(function (t, r) { return t + (n_(r[1]) || 0); }, 0);
  rows.slice(1).forEach(function (r) { clearRow_(TABS.STO, r.row, 5); });
  return { row: rows[0].row, qty: total, remarque: s_(rows[0][3]) };
}
function addStock_(key, ing, delta) {
  var line = stockLine_(key, ing);
  if (line) sheet_(TABS.STO).getRange(line.row, 2, 1, 4).setValues([[Math.max(0, line.qty + delta), today_(), line.remarque, key]]);
  else if (delta > 0) appendRow_(TABS.STO, [ing, delta, today_(), '', key]);
}

function finishShopping_(me, week, items) {
  ensureAll_();
  week = checkWeek_(week);
  var names = {}; catalog_().ingredients.forEach(function (i) { names[i.name] = 1; });
  var key = key_(me);
  (items || []).forEach(function (it) {
    var q = checkNumber_(it.qty, 'Quantité', 0, 1000000);
    if (names[it.ing] && q) addStock_(key, it.ing, q);
  });
  var ex = filled_(TABS.CRS, 5).filter(function (r) { return s_(r[0]) === week && s_(r[1]) === key; })[0];
  if (ex) sheet_(TABS.CRS).getRange(ex.row, 3, 1, 3).setValues([['[]', today_(), new Date()]]);
  else appendRow_(TABS.CRS, [week, key, '[]', today_(), new Date()]);
  return {};
}

// « C'est cuisiné » : repas marqués, stock diminué, restes ajoutés à MON planning.
function cooked_(me, week, ids, used, leftovers) {
  ensureAll_();
  week = checkWeek_(week);
  var mem = {}; members_(me).forEach(function (a) { mem[a.id] = 1; });
  var want = {}; (ids || []).forEach(function (i) { want[String(i)] = 1; });
  var s = sheet_(TABS.PLA), marked = 0;
  filled_(TABS.PLA, 10).forEach(function (r) {
    if (s_(r[0]) === week && mem[s_(r[1])] && want[s_(r[9])]) { s.getRange(r.row, 7).setValue('Oui'); marked++; }
  });
  var key = key_(me);
  (used || []).forEach(function (u) {
    var q = Number(u.qty) || 0;
    if (q > 0 && stockRows_(key).some(function (r) { return s_(r[0]) === u.ing; })) addStock_(key, u.ing, -q);
  });
  var lo = leftovers || {}, n = Math.min(20, Math.max(0, Math.round(Number(lo.portions) || 0)));
  for (var i = 0; i < n; i++) {
    appendRow_(TABS.PLA, [week, me.id, String(lo.recipe), '', '', checkNumber_(lo.kcal, 'kcal', 50, 5000), '', 'Oui',
      lo.version && lo.version.length ? JSON.stringify(lo.version) : '', Utilities.getUuid().slice(0, 12)]);
  }
  return { marked: marked };
}

function setStock_(me, items) {
  ensureAll_();
  var key = key_(me);
  (items || []).forEach(function (it) {
    var q = checkNumber_(it.qty, 'Quantité en stock', 0, 1000000);
    var line = stockLine_(key, it.ing);
    if (line) sheet_(TABS.STO).getRange(line.row, 2, 1, 4).setValues([[q === '' ? 0 : q, today_(), line.remarque, key]]);
    else if (q) appendRow_(TABS.STO, [it.ing, q, today_(), '', key]);
  });
  return { count: (items || []).length };
}

/* ===================== Avis (favoris, notes, commentaires) ===================== */

function avisSummary_(me) {
  var names = {}; accounts_().forEach(function (a) { names[a.id] = a.name; });
  var recipes = {}, mine = {};
  filled_(TABS.AVI, 6).forEach(function (r) {
    var rec = s_(r[0]), by = s_(r[1]), note = n_(r[3]), com = s_(r[4]);
    var x = recipes[rec] = recipes[rec] || { sum: 0, n: 0, favs: 0, comments: [] };
    if (note) { x.sum += note; x.n++; }
    if (s_(r[2]) === 'Oui') x.favs++;
    if (com) x.comments.push({ by: by, name: names[by] || '(compte supprimé)', text: com, date: s_(r[5]), note: note });
    if (by === me.id) mine[rec] = { fav: s_(r[2]) === 'Oui', note: note, comment: com };
  });
  Object.keys(recipes).forEach(function (k) {
    var x = recipes[k]; x.avg = x.n ? Math.round(x.sum / x.n * 10) / 10 : null; delete x.sum;
    x.comments.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  });
  return { recipes: recipes, mine: mine };
}

function setAvis_(me, recipe, a) {
  ensureAll_();
  if (!catalog_().recipes.some(function (r) { return r.name === recipe; })) throw err_('INTROUVABLE', 'Recette introuvable.');
  a = a || {};
  var ex = filled_(TABS.AVI, 6).filter(function (r) { return s_(r[0]) === recipe && s_(r[1]) === me.id; })[0];
  var cur = ex ? { fav: s_(ex[2]) === 'Oui', note: n_(ex[3]), comment: s_(ex[4]) } : { fav: false, note: null, comment: '' };
  if (a.fav !== undefined) cur.fav = !!a.fav;
  if (a.note !== undefined) cur.note = a.note ? checkNumber_(Math.round(a.note), 'Note', 1, 5) : null;
  if (a.comment !== undefined) cur.comment = cleanText_(a.comment, 400);
  var row = [recipe, me.id, cur.fav ? 'Oui' : '', cur.note || '', cur.comment, new Date()];
  if (ex) sheet_(TABS.AVI).getRange(ex.row, 1, 1, 6).setValues([row]);
  else appendRow_(TABS.AVI, row);
  return { avis: cur };
}
function deleteComment_(recipe, id) {
  filled_(TABS.AVI, 6).forEach(function (r) { if (s_(r[0]) === recipe && s_(r[1]) === id) sheet_(TABS.AVI).getRange(r.row, 5).setValue(''); });
  return {};
}

/* ===================== Propositions (validées par l'admin) ===================== */

function propose_(me, type, title, data) {
  ensureAll_();
  if (['recette', 'ingrédient', 'prix', 'photo'].indexOf(type) < 0) throw err_('VALEUR', 'Type de proposition inconnu.');
  var json = JSON.stringify(data || {});
  if (json.length > 48000) throw err_('VALEUR', 'Proposition trop lourde (photo trop grande ?).');
  if (me.role === 'admin') { applyProposal_(type, data || {}, me.id); return { applied: true }; }
  var pend = filled_(TABS.PRP, 8).filter(function (r) { return s_(r[3]) === me.id && s_(r[2]) === 'en attente'; }).length;
  if (pend >= 20) throw err_('BLOQUE', 'Tu as déjà 20 propositions en attente. Attends que l’admin les traite.');
  var n = filled_(TABS.PRP, 1).reduce(function (m, r) { return Math.max(m, n_(r[0]) || 0); }, 0) + 1;
  appendRow_(TABS.PRP, [n, type, 'en attente', me.id, new Date(), cleanText_(title, 120), json, '']);
  return { n: n };
}

function applyProposal_(type, d, by) {
  if (type === 'recette') {
    (d.ingredients || []).forEach(function (ing) {
      var exists = filled_(TABS.ING, 1).some(function (r) { return normName_(r[0]) === normName_(ing.name); });
      if (!exists) addIngredient_(ing);
    });
    return addRecipe_(d.recipe);
  }
  if (type === 'ingrédient') {
    if (d.correction) { // correction des valeurs d'un ingrédient existant (le nom ne change pas)
      var name = String(d.ingredient && d.ingredient.name || '');
      var row = filled_(TABS.ING, 1).filter(function (r) { return s_(r[0]) === name; })[0];
      if (!row) throw err_('INTROUVABLE', 'Ingrédient introuvable : ' + name);
      return updateIngredient_(row.row, name, d.ingredient);
    }
    return addIngredient_(d.ingredient);
  }
  if (type === 'prix') { (d.offers || [d.offer]).forEach(function (o) { upsertOffer_(o, by); }); return {}; }
  if (type === 'photo') return setPhoto_(d.recipe, d.image, by);
  throw err_('VALEUR', 'Type inconnu.');
}

function decide_(admin, n, accept, reply, data) {
  var r = filled_(TABS.PRP, 8).filter(function (x) { return n_(x[0]) === Number(n); })[0];
  if (!r) throw err_('INTROUVABLE', 'Proposition introuvable.');
  if (s_(r[2]) !== 'en attente') throw err_('DECALE', 'Cette proposition a déjà été traitée.');
  var s = sheet_(TABS.PRP), d = data;
  if (!d) { try { d = JSON.parse(s_(r[6]) || '{}'); } catch (e) { d = {}; } }
  if (accept) applyProposal_(s_(r[1]), d, s_(r[3]));
  var keep = s_(r[1]) === 'photo' ? JSON.stringify({ recipe: d.recipe }) : JSON.stringify(d); // l'image n'est gardée qu'une fois
  s.getRange(r.row, 3).setValue(accept ? 'acceptée' : 'refusée');
  s.getRange(r.row, 7, 1, 2).setValues([[keep, cleanText_(reply, 300)]]);
  return { n: Number(n) };
}

function upsertOffer_(o, by) {
  ensureAll_();
  o = o || {};
  if (!filled_(TABS.ING, 1).some(function (r) { return s_(r[0]) === o.ing; })) throw err_('INTROUVABLE', 'Ingrédient introuvable : ' + o.ing);
  var mag = cleanText_(o.magasin, 40);
  if (!mag) throw err_('VALEUR', 'Magasin obligatoire.');
  var pack = checkNumber_(o.pack, 'Conditionnement', 1, 100000), prix = checkNumber_(o.prix, 'Prix du paquet', 0.01, 1000);
  if (pack === '' || prix === '') throw err_('VALEUR', 'Conditionnement et prix du paquet obligatoires.');
  var ex = filled_(TABS.PRX, 6).filter(function (r) { return s_(r[0]) === o.ing && normName_(r[1]) === normName_(mag); })[0];
  var row = [o.ing, mag, pack, prix, today_(), by || ''];
  if (ex) sheet_(TABS.PRX).getRange(ex.row, 1, 1, 6).setValues([row]); else appendRow_(TABS.PRX, row);
  return {};
}
function deleteOffer_(ing, magasin) {
  filled_(TABS.PRX, 6).forEach(function (r) { if (s_(r[0]) === ing && s_(r[1]) === magasin) clearRow_(TABS.PRX, r.row, 6); });
  return {};
}

function setPhoto_(recipe, image, by) {
  ensureAll_();
  if (!catalog_().recipes.some(function (r) { return r.name === recipe; })) throw err_('INTROUVABLE', 'Recette introuvable.');
  image = String(image || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length > 45000) throw err_('VALEUR', 'Image invalide ou trop lourde.');
  var ex = filled_(TABS.PHO, 4).filter(function (r) { return s_(r[0]) === recipe; })[0];
  var row = [recipe, image, by || '', new Date()];
  if (ex) sheet_(TABS.PHO).getRange(ex.row, 1, 1, 4).setValues([row]); else appendRow_(TABS.PHO, row);
  return {};
}
// Noms des recettes qui ont une photo : seule la colonne A est lue (les images sont lourdes).
function photoNames_() {
  var s = sheetOrNull_(TABS.PHO);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(function (r) { return s_(r[0]); }).filter(Boolean);
}
function photos_(names) {
  var want = {}; (names || []).slice(0, 40).forEach(function (n) { want[n] = 1; });
  var out = {};
  filled_(TABS.PHO, 2).forEach(function (r) { if (want[s_(r[0])] && s_(r[1])) out[s_(r[0])] = s_(r[1]); });
  return { photos: out };
}

/* ===================== Tickets d'erreur ===================== */
// Une personne signale une erreur : le ticket est noté dans l'onglet Tickets et l'admin reçoit un e-mail.
// Le rapport ne contient ni mot de passe, ni jeton, ni e-mail (masqués par l'appli avant l'envoi).
function adminEmails_() {
  var list = [];
  try { var own = Session.getEffectiveUser().getEmail(); if (own) list.push(own); } catch (e) { /* droit e-mail absent */ }
  accounts_().forEach(function (a) { if (a.role === 'admin' && a.active && a.email && list.indexOf(a.email) < 0) list.push(a.email); });
  return list;
}
function ticket_(token, t) {
  t = t || {};
  var by = '(non connecté)';
  try { by = auth_(token).id; } catch (e) { /* ticket envoyé depuis l'écran de connexion */ }
  var cache = CacheService.getScriptCache();
  var k = 'tck:' + by, n0 = Number(cache.get(k) || 0);
  if (n0 >= 10) throw err_('BLOQUE', 'Beaucoup de tickets envoyés : l’admin est déjà prévenu. Réessaie plus tard.');
  var msg = cleanText_(t.message, 300), screen = cleanText_(t.screen, 80);
  var dupKey = 'tckd:' + hmac_(by + '|' + msg + '|' + screen, 'ticket').slice(0, 40);
  if (cache.get(dupKey)) return { duplicate: true };
  ensureAll_();
  var n = filled_(TABS.TCK, 1).reduce(function (m, r) { return Math.max(m, n_(r[0]) || 0); }, 0) + 1;
  appendRow_(TABS.TCK, [n, new Date(), by, screen, msg, cleanText_(t.report, 3000), cleanText_(t.comment, 500), 'ouvert', '']);
  cache.put(k, String(n0 + 1), 3600); cache.put(dupKey, '1', 600);
  try {
    var to = adminEmails_();
    if (to.length) MailApp.sendEmail({ to: to.join(','), subject: 'La Juste Assiette : ticket n°' + n + ' de ' + by,
      body: 'Nouveau ticket n°' + n + '\n\nPar : ' + by + '\nÉcran : ' + screen + '\nErreur : ' + msg +
        (t.comment ? '\nCommentaire : ' + cleanText_(t.comment, 500) : '') + '\n\n--- Rapport ---\n' + cleanText_(t.report, 3000).replace(/ \| /g, '\n') +
        '\n\nÀ voir dans l’appli : Plus › Tableau de bord › Tickets.' });
  } catch (e) { /* l'e-mail est un plus : le ticket est déjà enregistré */ }
  return { n: n };
}
function resolveTicket_(n, reply) {
  var r = filled_(TABS.TCK, 9).filter(function (x) { return n_(x[0]) === Number(n); })[0];
  if (!r) throw err_('INTROUVABLE', 'Ticket introuvable.');
  sheet_(TABS.TCK).getRange(r.row, 8, 1, 2).setValues([['résolu', cleanText_(reply, 300)]]);
  return { n: Number(n) };
}
function ticketsList_() {
  return filled_(TABS.TCK, 9).map(function (r) {
    return { n: n_(r[0]), date: s_(r[1]), by: s_(r[2]), screen: s_(r[3]), message: s_(r[4]), report: s_(r[5]),
      comment: s_(r[6]), statut: s_(r[7]) || 'ouvert', reply: s_(r[8]) };
  }).sort(function (a, b) { return ((a.statut === 'résolu') - (b.statut === 'résolu')) || (b.n - a.n); }).slice(0, 60);
}

/* ===================== Tableau de bord admin ===================== */

function dashboard_() {
  var cat = catalog_();
  var pending = filled_(TABS.PRP, 8).filter(function (r) { return s_(r[2]) === 'en attente'; }).map(function (r) {
    var d = {}; try { d = JSON.parse(s_(r[6]) || '{}'); } catch (e) {}
    return { n: n_(r[0]), type: s_(r[1]), by: s_(r[3]), date: s_(r[4]), title: s_(r[5]), data: d };
  });
  var count = {};
  filled_(TABS.PLA, 10).forEach(function (r) { if (s_(r[7]) !== 'Oui') count[s_(r[2])] = (count[s_(r[2])] || 0) + 1; });
  var av = avisSummary_({ id: '' }).recipes;
  var popular = cat.recipes.map(function (r) {
    var a = av[r.name] || {};
    return { name: r.name, planned: count[r.name] || 0, avg: a.avg || null, votes: a.n || 0, favs: a.favs || 0 };
  }).sort(function (a, b) { return b.planned - a.planned || (b.avg || 0) - (a.avg || 0); }).slice(0, 10);
  var acc = accounts_(), now = Date.now();
  var since = function (d) { var t = d ? new Date(d).getTime() : 0; return t ? (now - t) / 864e5 : 9999; };
  var users = { total: acc.length, active7: acc.filter(function (a) { return since(a.lastLogin) <= 7; }).length,
    active30: acc.filter(function (a) { return since(a.lastLogin) <= 30; }).length,
    new30: acc.filter(function (a) { return since(a.created) <= 30; }).length,
    foyers: filled_(TABS.FOY, 1).length, signupOpen: signupOpen_() };
  var used = {}; cat.recipes.forEach(function (r) { r.lines.forEach(function (l) { used[l.ing] = 1; }); });
  var quality = {
    noPrice: cat.ingredients.filter(function (i) { return i.prix === null; }).map(function (i) { return i.name; }),
    noRole: cat.ingredients.filter(function (i) { return !i.role || !i.rayon; }).map(function (i) { return i.name; }),
    badRecipes: cat.recipes.filter(function (r) { return r.controle && r.controle !== 'OK'; }).map(function (r) { return r.name + ' (' + r.controle + ')'; }),
    unused: cat.ingredients.filter(function (i) { return !used[i.name]; }).map(function (i) { return i.name; }),
    noPhoto: (function () { var has = {}; photoNames_().forEach(function (n) { has[n] = 1; }); return cat.recipes.filter(function (r) { return !has[r.name]; }).map(function (r) { return r.name; }); })()
  };
  return { pending: pending, popular: popular, users: users, quality: quality, tickets: ticketsList_() };
}

/* ===================== Écritures du catalogue (admin) ===================== */

function ingredientRow_(ing) {
  var name = cleanText_(ing.name, 80);
  if (!name) throw err_('VALEUR', 'Le nom de l’ingrédient est obligatoire.');
  var kcal = checkNumber_(ing.kcal, 'kcal', 0, 900);
  var p = checkNumber_(ing.p, 'Protéines', 0, 100), g = checkNumber_(ing.g, 'Glucides', 0, 100);
  var l = checkNumber_(ing.l, 'Lipides', 0, 100), f = checkNumber_(ing.f, 'Fibres', 0, 100);
  if (kcal === '' || p === '' || g === '' || l === '') throw err_('VALEUR', 'kcal, protéines, glucides et lipides sont obligatoires.');
  var prix = checkNumber_(ing.prix, 'Prix au kg', 0, 1000);
  return [name, ing.etat || '', kcal, p, g, l, f === '' ? 0 : f, prix, cleanText_(ing.magasin, 40), cleanText_(ing.source, 80),
    cleanText_(ing.remarque, 200) || (prix === '' ? 'Prix manquant' : ''), ing.role || '', ing.rayon || '',
    cleanText_(Calc.splitList(ing.allergenes).join(', '), 200)];
}
function addIngredient_(ing) {
  ensureAll_();
  var s = sheet_(TABS.ING);
  var row = ingredientRow_(ing || {});
  var existing = filled_(TABS.ING, 1).filter(function (r) { return normName_(r[0]) === normName_(row[0]); })[0];
  if (existing) throw err_('DOUBLON', 'Cet ingrédient existe déjà : « ' + s_(existing[0]) + ' » (ligne ' + existing.row + ').');
  ensureCols_(s, 14);
  var r = firstEmptyRow_(s, 0);
  s.getRange(r, 1, 1, 14).setValues([row]);
  return { row: r, name: row[0] };
}
function updateIngredient_(rowNum, name, ing) {
  var s = sheet_(TABS.ING);
  rowNum = Number(rowNum);
  if (!(rowNum >= 2) || s_(s.getRange(rowNum, 1).getValue()) !== name) {
    throw err_('DECALE', 'Le Sheet a changé depuis la dernière lecture. Actualise puis recommence.');
  }
  var row = ingredientRow_(Object.assign({}, ing, { name: name }));
  ensureCols_(s, 14);
  s.getRange(rowNum, 2, 1, 13).setValues([row.slice(1)]);
  return { row: rowNum };
}
function ingredientNames_() { var set = {}; filled_(TABS.ING, 1).forEach(function (r) { set[s_(r[0])] = true; }); return set; }

function addRecipe_(rec) {
  var name = cleanText_(rec && rec.name, 100);
  if (!name) throw err_('VALEUR', 'Le nom de la recette est obligatoire.');
  var portions = checkNumber_(rec.portions, 'Portions', 1, 100);
  if (portions === '') throw err_('VALEUR', 'Le nombre de portions est obligatoire.');
  if (filled_(TABS.REC, 1).some(function (r) { return normName_(r[0]) === normName_(name); })) throw err_('DOUBLON', 'Une recette porte déjà ce nom.');
  var names = ingredientNames_();
  if (!(rec.lines || []).length) throw err_('VALEUR', 'Ajoute au moins un ingrédient.');
  (rec.lines || []).forEach(function (l) { if (!names[l.ing]) throw err_('INTROUVABLE', 'Ingrédient introuvable (au caractère près) : ' + l.ing); });
  var s = sheet_(TABS.REC);
  var r = firstEmptyRow_(s, 201);
  // Colonnes de saisie seulement : A–F puis R, S, U.
  s.getRange(r, 1, 1, 6).setValues([[name, portions, cleanText_(rec.categorie, 40), rec.objectif || '',
    checkNumber_(rec.prepa, 'Prépa', 0, 1000), checkNumber_(rec.cuisson, 'Cuisson', 0, 1000)]]);
  s.getRange(r, 18, 1, 2).setValues([[rec.favori || 'Non', rec.statut || 'À tester']]);
  s.getRange(r, 21).setValue(cleanText_(rec.notes, 300));
  addLines_(name, rec.lines || [], true);
  var e = sheet_(TABS.ETA);
  (rec.steps || []).forEach(function (st, i) {
    if (!String(st.text || '').trim()) return;
    var er = firstEmptyRow_(e, 0);
    e.getRange(er, 1, 1, 4).setValues([[name, i + 1, cleanText_(st.text, 1000), checkNumber_(st.timer, 'Minuteur', 0, 1440)]]);
  });
  return { row: r };
}
function addLines_(recipe, lines, skipCheck) {
  if (!skipCheck) {
    if (!filled_(TABS.REC, 1).some(function (r) { return s_(r[0]) === recipe; })) throw err_('INTROUVABLE', 'Recette introuvable : ' + recipe);
    var names = ingredientNames_();
    lines.forEach(function (l) { if (!names[l.ing]) throw err_('INTROUVABLE', 'Ingrédient introuvable : ' + l.ing); });
  }
  var s = sheet_(TABS.LIG), rowsAdded = [];
  lines.forEach(function (l) {
    var q = checkNumber_(l.qty, 'Quantité', 0, 100000);
    if (q === '') throw err_('VALEUR', 'Quantité manquante pour ' + l.ing);
    var r = firstEmptyRow_(s, 501);
    s.getRange(r, 1, 1, 3).setValues([[recipe, l.ing, q]]); // A–C uniquement
    rowsAdded.push(r);
  });
  return { rows: rowsAdded };
}
function checkLine_(s, rowNum, recipe, ing) {
  rowNum = Number(rowNum);
  var v = rowNum >= 2 ? s.getRange(rowNum, 1, 1, 2).getValues()[0] : [];
  if (s_(v[0]) !== recipe || s_(v[1]) !== ing) throw err_('DECALE', 'Le Sheet a changé depuis la dernière lecture. Actualise puis recommence.');
  return rowNum;
}
function updateLine_(rowNum, recipe, ing, qty) {
  var s = sheet_(TABS.LIG), r = checkLine_(s, rowNum, recipe, ing);
  var q = checkNumber_(qty, 'Quantité', 0, 100000);
  if (q === '') throw err_('VALEUR', 'Quantité manquante.');
  s.getRange(r, 3).setValue(q);
  return { row: r };
}
function deleteLine_(rowNum, recipe, ing) {
  var s = sheet_(TABS.LIG), r = checkLine_(s, rowNum, recipe, ing);
  s.getRange(r, 1, 1, 3).clearContent(); // les formules D–I restent en place
  return { row: r };
}

/* ===================== Code-barres : relais vers Open Food Facts ===================== */
// Utilisé quand le téléphone n'arrive pas à joindre Open Food Facts directement.
// Seul le numéro du code-barres est envoyé ; réponse gardée 6 h en cache.
var OFF_FIELDS = 'product_name,product_name_fr,brands,nutriments,quantity,allergens_tags';
function offLookup_(code) {
  code = String(code || '').replace(/\D/g, '');
  if (!Calc.validEan(code)) throw err_('VALEUR', 'Code-barres non valide.');
  var cache = CacheService.getScriptCache(), key = 'off:' + code, hit = cache.get(key);
  if (hit) return { json: JSON.parse(hit) };
  var hosts = ['https://world.openfoodfacts.org', 'https://fr.openfoodfacts.org'];
  for (var i = 0; i < hosts.length; i++) {
    try {
      var res = UrlFetchApp.fetch(hosts[i] + '/api/v2/product/' + code + '.json?fields=' + OFF_FIELDS,
        { muteHttpExceptions: true, headers: { 'User-Agent': 'LaJusteAssiette/2 (appli personnelle de recettes)' } });
      var st = res.getResponseCode();
      if (st === 404) return { json: { status: 0 } };
      if (st === 200) {
        var txt = res.getContentText();
        try { cache.put(key, txt, 21600); } catch (e) { /* réponse trop grande pour le cache */ }
        return { json: JSON.parse(txt) };
      }
    } catch (e) { /* serveur suivant */ }
  }
  throw err_('OFF', 'Open Food Facts ne répond pas pour le moment.');
}

/* ===================== Lecture de photo (OCR Google Drive, gratuit) ===================== */
function checkOcrQuota_(me) {
  if (me.role === 'admin') return;
  var cache = CacheService.getScriptCache(), k = 'ocr:' + me.id, n = Number(cache.get(k) || 0);
  if (n >= 30) throw err_('BLOQUE', 'Limite de 30 photos par jour atteinte.');
  cache.put(k, String(n + 1), 21600);
}
function ocr_(base64, mime) {
  if (!base64) throw err_('VALEUR', 'Aucune image reçue.');
  if (typeof Drive === 'undefined') throw err_('DRIVE', 'Le service Drive API n’est pas activé dans Apps Script (Services > + > Drive API).');
  if (base64.length > 7000000) throw err_('VALEUR', 'Fichier trop lourd (5 Mo maximum).');
  var isPdf = mime === 'application/pdf';
  if (!isPdf && !/^image\//.test(String(mime || 'image/jpeg'))) throw err_('VALEUR', 'Envoie une photo ou un PDF.');
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', isPdf ? 'ticket.pdf' : 'etiquette.jpg');
  var file = Drive.Files.create({ name: 'ocr-etiquette-temporaire', mimeType: 'application/vnd.google-apps.document' },
    blob, { ocrLanguage: 'fr', fields: 'id' });
  try { return { text: DocumentApp.openById(file.id).getBody().getText() }; }
  finally { try { Drive.Files.remove(file.id); } catch (e) { /* fichier temporaire : sans gravité */ } }
}

/* ===================== Calculs partagés avec l'appli (copie de web/calc.js) ===================== */
