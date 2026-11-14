/**
 * Serveur de l'appli recettes : lit et écrit dans CE Google Sheet.
 * À coller dans Extensions > Apps Script du Sheet, puis déployer en « Application Web »
 * (Exécuter en tant que : moi ; Accès : tout le monde).
 *
 * Règles respectées :
 *  - noms d'onglets et ordre des colonnes inchangés ;
 *  - aucune écriture dans les colonnes calculées (Recettes G–Q et T, Lignes_recette D–I) ;
 *  - écriture uniquement sur la première ligne vide (colonne A vide) ;
 *  - code secret et jetons uniquement ici (Propriétés du script), jamais dans le navigateur.
 */

var TABS = {
  ING: 'Ingrédients', REC: 'Recettes', LIG: 'Lignes_recette',
  ETA: 'Étapes', STO: 'Stock cuisine', PRO: 'Profils'
};
var TOKEN_DAYS = 60;
var MAX_FAILS = 5;          // essais de code faux avant blocage
var LOCK_SECONDS = 15 * 60; // durée du blocage

/* ===================== Menu dans le Sheet ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Appli recettes')
    .addItem('1. Installer / vérifier', 'installer')
    .addItem('2. Définir le code secret', 'definirCodeSecret')
    .addToUi();
}

function installer() {
  var ss = SpreadsheetApp.getActive();
  [TABS.ING, TABS.REC, TABS.LIG, TABS.ETA, TABS.STO].forEach(function (n) {
    if (!ss.getSheetByName(n)) throw new Error('Onglet introuvable : ' + n);
  });
  var r = setup_();
  var msg = 'Installation OK.\n' + r.message;
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_CODE')) {
    msg += '\n\nÉtape suivante : menu Appli recettes > 2. Définir le code secret.';
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function definirCodeSecret() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Code secret', 'Choisis un code (au moins 6 caractères). Il débloque les modifications dans l’appli.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var code = res.getResponseText().trim();
  if (code.length < 6) { ui.alert('Code trop court (6 caractères minimum).'); return; }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_CODE', code);
  props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid()); // déconnecte les anciens appareils
  ui.alert('Code enregistré. Les appareils déjà débloqués devront ressaisir le code.');
}

/* ===================== Points d'entrée Web ===================== */

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, code: 'REQUETE', error: 'Requête illisible.' }); }
  return handle_(body);
}

function handle_(req) {
  try {
    var action = req.action || 'data';
    var out;
    switch (action) {
      case 'ping': out = { pong: true }; break;
      case 'data': out = getData_(); break;
      case 'unlock': out = unlock_(req.code); break;
      case 'check': out = { admin: isAdmin_(req.token) }; break;
      case 'saveProfile': out = withLock_(function () { return saveProfile_(req.profile); }); break;
      default:
        requireAdmin_(req.token);
        out = withLock_(function () { return adminAction_(action, req); });
    }
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, code: err.code || 'ERREUR', error: String(err.message || err) });
  }
}

function adminAction_(action, req) {
  switch (action) {
    case 'setup': return setup_();
    case 'addIngredient': return addIngredient_(req.ingredient);
    case 'updateIngredient': return updateIngredient_(req.row, req.name, req.ingredient);
    case 'addRecipe': return addRecipe_(req.recipe);
    case 'addLine': return addLines_(req.recipe, [req.line]);
    case 'updateLine': return updateLine_(req.row, req.recipe, req.ing, req.qty);
    case 'deleteLine': return deleteLine_(req.row, req.recipe, req.ing);
    case 'setStock': return setStock_(req.items);
    case 'ocr': return ocr_(req.image, req.mime);
    default: throw err_('ACTION', 'Action inconnue : ' + action);
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('OCCUPE', 'Le Sheet est occupé, réessaie dans quelques secondes.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Accès administrateur ===================== */

function unlock_(code) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw err_('BLOQUE', 'Trop d’essais. Réessaie dans 15 minutes.');
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty('ADMIN_CODE');
  if (!real) throw err_('PAS_DE_CODE', 'Aucun code secret défini. Dans le Sheet : menu Appli recettes > Définir le code secret.');
  if (String(code || '') !== real) {
    cache.put('fails', String(fails + 1), LOCK_SECONDS);
    throw err_('CODE_FAUX', 'Code incorrect.');
  }
  cache.remove('fails');
  var exp = Date.now() + TOKEN_DAYS * 86400000;
  return { token: exp + '.' + sign_(String(exp)), expires: exp };
}

function sign_(s) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', secret); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret));
}

function isAdmin_(token) {
  if (!token) return false;
  var parts = String(token).split('.');
  if (parts.length !== 2) return false;
  if (Number(parts[0]) < Date.now()) return false;
  return sign_(parts[0]) === parts[1];
}

function requireAdmin_(token) {
  if (!isAdmin_(token)) throw err_('NON_AUTORISE', 'Modifications verrouillées : saisis ton code secret.');
}

/* ===================== Lecture ===================== */

function sheet_(name) {
  var s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw err_('ONGLET', 'Onglet introuvable : ' + name);
  return s;
}

function rows_(name, ncol) {
  var s = sheet_(name);
  var last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, ncol).getValues().map(function (v, i) { v.row = i + 2; return v; });
}

function n_(v) { return v === '' || v === null ? null : (typeof v === 'number' ? v : Number(String(v).replace(',', '.'))); }
function s_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v == null ? '' : v); }

function getData_() {
  var ingredients = rows_(TABS.ING, 13).filter(function (r) { return s_(r[0]).trim(); }).map(function (r) {
    return { row: r.row, name: s_(r[0]), etat: s_(r[1]), kcal: n_(r[2]), p: n_(r[3]), g: n_(r[4]), l: n_(r[5]),
      f: n_(r[6]), prix: n_(r[7]), magasin: s_(r[8]), source: s_(r[9]), remarque: s_(r[10]),
      role: s_(r[11]), rayon: s_(r[12]) };
  });
  var lines = rows_(TABS.LIG, 3).filter(function (r) { return s_(r[0]).trim(); });
  var steps = rows_(TABS.ETA, 4).filter(function (r) { return s_(r[0]).trim(); });
  var recipes = rows_(TABS.REC, 21).filter(function (r) { return s_(r[0]).trim(); }).map(function (r) {
    var name = s_(r[0]);
    return { row: r.row, name: name, portions: n_(r[1]), categorie: s_(r[2]), objectif: s_(r[3]),
      prepa: n_(r[4]), cuisson: n_(r[5]), favori: s_(r[17]), statut: s_(r[18]), controle: s_(r[19]), notes: s_(r[20]),
      sheet: { kcal: n_(r[11]), p: n_(r[12]), g: n_(r[13]), l: n_(r[14]), coutPortion: n_(r[16]) },
      lines: lines.filter(function (l) { return s_(l[0]) === name; })
        .map(function (l) { return { row: l.row, ing: s_(l[1]), qty: n_(l[2]) }; }),
      steps: steps.filter(function (x) { return s_(x[0]) === name; })
        .map(function (x) { return { n: n_(x[1]), text: s_(x[2]), timer: n_(x[3]) }; })
        .sort(function (a, b) { return (a.n || 0) - (b.n || 0); }) };
  });
  var stock = rows_(TABS.STO, 4).filter(function (r) { return s_(r[0]).trim(); }).map(function (r) {
    return { row: r.row, ing: s_(r[0]), qty: n_(r[1]), date: s_(r[2]), remarque: s_(r[3]) };
  });
  var profiles = [];
  if (SpreadsheetApp.getActive().getSheetByName(TABS.PRO)) {
    profiles = rows_(TABS.PRO, 7).filter(function (r) { return s_(r[0]).trim(); }).map(function (r) {
      return { row: r.row, name: s_(r[0]), kcal: n_(r[1]), prot: n_(r[2]), objectif: s_(r[3]),
        repas: n_(r[4]), marge: n_(r[5]), maj: s_(r[6]) };
    });
  }
  return { ingredients: ingredients, recipes: recipes, stock: stock, profiles: profiles,
    hasRoleColumns: s_(sheet_(TABS.ING).getRange(1, 12).getValue()) !== '',
    fetchedAt: new Date().toISOString() };
}

/* ===================== Écriture ===================== */

// Première ligne dont la colonne A est vide (les lignes en dessous peuvent contenir des formules).
function firstEmptyRow_(sheet, maxRow) {
  var last = Math.max(sheet.getLastRow(), 2);
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === '') return i + 2;
  var r = last + 1;
  if (maxRow && r > maxRow) throw err_('PLEIN', 'L’onglet « ' + sheet.getName() + ' » est plein (lignes de formules prévues jusqu’à ' + maxRow + '). Prolonge les formules dans le Sheet.');
  return r;
}

function normName_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function checkNumber_(v, label, min, max) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  if (!isFinite(n) || n < min || n > max) throw err_('VALEUR', label + ' invalide : ' + v);
  return n;
}

function ingredientRow_(ing) {
  var name = String(ing.name || '').trim();
  if (!name) throw err_('VALEUR', 'Le nom de l’ingrédient est obligatoire.');
  var kcal = checkNumber_(ing.kcal, 'kcal', 0, 900);
  var p = checkNumber_(ing.p, 'Protéines', 0, 100), g = checkNumber_(ing.g, 'Glucides', 0, 100);
  var l = checkNumber_(ing.l, 'Lipides', 0, 100), f = checkNumber_(ing.f, 'Fibres', 0, 100);
  if (kcal === '' || p === '' || g === '' || l === '') throw err_('VALEUR', 'kcal, protéines, glucides et lipides sont obligatoires.');
  var prix = checkNumber_(ing.prix, 'Prix au kg', 0, 1000);
  return [name, ing.etat || '', kcal, p, g, l, f === '' ? 0 : f, prix, ing.magasin || '', ing.source || '',
    ing.remarque || (prix === '' ? 'Prix manquant' : ''), ing.role || '', ing.rayon || ''];
}

function addIngredient_(ing) {
  var s = sheet_(TABS.ING);
  var row = ingredientRow_(ing);
  var existing = rows_(TABS.ING, 1).filter(function (r) { return normName_(r[0]) === normName_(row[0]); })[0];
  if (existing) throw err_('DOUBLON', 'Cet ingrédient existe déjà : « ' + s_(existing[0]) + ' » (ligne ' + existing.row + ').');
  var r = firstEmptyRow_(s, 0);
  s.getRange(r, 1, 1, 13).setValues([row]);
  return { row: r, name: row[0] };
}

function updateIngredient_(rowNum, name, ing) {
  var s = sheet_(TABS.ING);
  rowNum = Number(rowNum);
  if (!(rowNum >= 2) || s_(s.getRange(rowNum, 1).getValue()) !== name) {
    throw err_('DECALE', 'Le Sheet a changé depuis la dernière lecture. Actualise puis recommence.');
  }
  var row = ingredientRow_(Object.assign({}, ing, { name: name })); // le nom ne change jamais ici
  s.getRange(rowNum, 2, 1, 12).setValues([row.slice(1)]);
  return { row: rowNum };
}

function ingredientNames_() {
  var set = {};
  rows_(TABS.ING, 1).forEach(function (r) { set[s_(r[0])] = true; });
  return set;
}

function addRecipe_(rec) {
  var name = String(rec && rec.name || '').trim();
  if (!name) throw err_('VALEUR', 'Le nom de la recette est obligatoire.');
  var portions = checkNumber_(rec.portions, 'Portions', 1, 100);
  if (portions === '') throw err_('VALEUR', 'Le nombre de portions est obligatoire.');
  var exists = rows_(TABS.REC, 1).some(function (r) { return normName_(r[0]) === normName_(name); });
  if (exists) throw err_('DOUBLON', 'Une recette porte déjà ce nom.');
  var names = ingredientNames_();
  (rec.lines || []).forEach(function (l) {
    if (!names[l.ing]) throw err_('INTROUVABLE', 'Ingrédient introuvable (au caractère près) : ' + l.ing);
  });
  var s = sheet_(TABS.REC);
  var r = firstEmptyRow_(s, 201);
  // Colonnes de saisie seulement : A–F puis R, S, U.
  s.getRange(r, 1, 1, 6).setValues([[name, portions, rec.categorie || '', rec.objectif || '',
    checkNumber_(rec.prepa, 'Prépa', 0, 1000), checkNumber_(rec.cuisson, 'Cuisson', 0, 1000)]]);
  s.getRange(r, 18, 1, 2).setValues([[rec.favori || 'Non', rec.statut || 'À tester']]);
  s.getRange(r, 21).setValue(rec.notes || '');
  addLines_(name, rec.lines || [], true);
  var e = sheet_(TABS.ETA);
  (rec.steps || []).forEach(function (st, i) {
    if (!String(st.text || '').trim()) return;
    var er = firstEmptyRow_(e, 0);
    e.getRange(er, 1, 1, 4).setValues([[name, i + 1, st.text, checkNumber_(st.timer, 'Minuteur', 0, 1440)]]);
  });
  return { row: r };
}

function addLines_(recipe, lines, skipCheck) {
  if (!skipCheck) {
    var known = rows_(TABS.REC, 1).some(function (r) { return s_(r[0]) === recipe; });
    if (!known) throw err_('INTROUVABLE', 'Recette introuvable : ' + recipe);
    var names = ingredientNames_();
    lines.forEach(function (l) { if (!names[l.ing]) throw err_('INTROUVABLE', 'Ingrédient introuvable : ' + l.ing); });
  }
  var s = sheet_(TABS.LIG);
  var rowsAdded = [];
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
  var s = sheet_(TABS.LIG);
  var r = checkLine_(s, rowNum, recipe, ing);
  var q = checkNumber_(qty, 'Quantité', 0, 100000);
  if (q === '') throw err_('VALEUR', 'Quantité manquante.');
  s.getRange(r, 3).setValue(q);
  return { row: r };
}

function deleteLine_(rowNum, recipe, ing) {
  var s = sheet_(TABS.LIG);
  var r = checkLine_(s, rowNum, recipe, ing);
  s.getRange(r, 1, 1, 3).clearContent(); // les formules D–I restent en place
  return { row: r };
}

function setStock_(items) {
  var s = sheet_(TABS.STO);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var existing = rows_(TABS.STO, 1);
  (items || []).forEach(function (it) {
    var q = checkNumber_(it.qty, 'Quantité en stock', 0, 1000000);
    var found = existing.filter(function (r) { return s_(r[0]) === it.ing; })[0];
    var r = found ? found.row : firstEmptyRow_(s, 0);
    s.getRange(r, 1, 1, 3).setValues([[it.ing, q === '' ? 0 : q, today]]);
    if (it.remarque !== undefined) s.getRange(r, 4).setValue(it.remarque);
    if (!found) existing.push(Object.assign([it.ing], { row: r }));
  });
  return { count: (items || []).length };
}

function saveProfile_(p) {
  var name = String(p && p.name || '').trim();
  if (!name) throw err_('VALEUR', 'Le prénom est obligatoire.');
  ensureProfiles_();
  var s = sheet_(TABS.PRO);
  var row = [name, checkNumber_(p.kcal, 'kcal cibles', 800, 8000), checkNumber_(p.prot, 'Protéines cibles', 20, 500),
    p.objectif || 'Maintien', checkNumber_(p.repas, 'Repas par jour', 1, 8) || 3,
    checkNumber_(p.marge, 'Marge', 1, 10) || 10, new Date()];
  var found = rows_(TABS.PRO, 1).filter(function (r) { return s_(r[0]) === name; })[0];
  var r = found ? found.row : firstEmptyRow_(s, 0);
  s.getRange(r, 1, 1, 7).setValues([row]);
  return { row: r };
}

function ensureProfiles_() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(TABS.PRO)) return false;
  var s = ss.insertSheet(TABS.PRO);
  s.getRange(1, 1, 1, 7).setValues([['Prénom', 'kcal cibles / jour', 'Protéines cibles / jour (g)', 'Objectif',
    'Repas par jour', 'Marge protéines (%)', 'Mis à jour le']]).setFontWeight('bold');
  s.setFrozenRows(1);
  return true;
}

/* Ajoute L « Rôle » et M « Rayon » à la fin d'Ingrédients et propose une valeur
   par défaut d'après les macros (seulement dans les cases vides). */
function setup_() {
  var s = sheet_(TABS.ING);
  var head = s.getRange(1, 12, 1, 2).getValues()[0];
  var added = false;
  if (!head[0] || !head[1]) {
    s.getRange(1, 12, 1, 2).setValues([['Rôle', 'Rayon']]);
    s.getRange(1, 1).copyFormatToRange(s, 12, 13, 1, 1);
    added = true;
  }
  var roles = SpreadsheetApp.newDataValidation().requireValueInList(['protéine', 'glucide', 'lipide', 'légume', 'autre'], true).setAllowInvalid(true).build();
  var rayons = SpreadsheetApp.newDataValidation().requireValueInList(['viandes', 'féculents', 'légumes', 'épicerie', 'autre'], true).setAllowInvalid(true).build();
  var maxR = Math.max(s.getMaxRows(), 2);
  s.getRange(2, 12, maxR - 1, 1).setDataValidation(roles);
  s.getRange(2, 13, maxR - 1, 1).setDataValidation(rayons);
  var data = rows_(TABS.ING, 13);
  var filled = 0;
  data.forEach(function (r) {
    if (!s_(r[0]).trim()) return;
    var role = s_(r[11]) || suggestRole_(n_(r[2]), n_(r[3]), n_(r[4]), n_(r[5]));
    var rayon = s_(r[12]) || suggestRayon_(role);
    if (!s_(r[11]) || !s_(r[12])) { s.getRange(r.row, 12, 1, 2).setValues([[role, rayon]]); filled++; }
  });
  var createdProfiles = ensureProfiles_();
  return { message: (added ? 'Colonnes Rôle et Rayon ajoutées. ' : 'Colonnes Rôle et Rayon déjà présentes. ') +
    filled + ' ingrédient(s) complété(s) avec une valeur par défaut, à corriger si besoin.' +
    (createdProfiles ? ' Onglet Profils créé.' : '') };
}

// Même règle que calc.js (suggestRole) : garder les deux synchronisées.
function suggestRole_(k, p, g, l) {
  k = k || 0; p = p || 0; g = g || 0; l = l || 0;
  if (k <= 0) return 'autre';
  var sp = 4 * p / k, sg = 4 * g / k, sl = 9 * l / k;
  if (sp >= 0.4 && p >= 10) return 'protéine';
  if (sl >= 0.6) return 'lipide';
  if (k < 70 && g < 12) return 'légume';
  if (sg >= 0.5) return 'glucide';
  if (sp >= 0.3) return 'protéine';
  return 'autre';
}
function suggestRayon_(role) {
  return { 'protéine': 'viandes', 'glucide': 'féculents', 'légume': 'légumes', 'lipide': 'épicerie' }[role] || 'épicerie';
}

/* ===================== Lecture de photo (OCR Google Drive, gratuit) ===================== */
// Nécessite le service avancé « Drive API » (Services > + > Drive API).
function ocr_(base64, mime) {
  if (!base64) throw err_('VALEUR', 'Aucune image reçue.');
  if (typeof Drive === 'undefined') throw err_('DRIVE', 'Le service Drive API n’est pas activé dans Apps Script (Services > + > Drive API).');
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', 'etiquette.jpg');
  var file = Drive.Files.create({ name: 'ocr-etiquette-temporaire', mimeType: 'application/vnd.google-apps.document' },
    blob, { ocrLanguage: 'fr', fields: 'id' });
  try {
    var text = DocumentApp.openById(file.id).getBody().getText();
    return { text: text };
  } finally {
    try { Drive.Files.remove(file.id); } catch (e) { /* fichier temporaire : sans gravité */ }
  }
}
