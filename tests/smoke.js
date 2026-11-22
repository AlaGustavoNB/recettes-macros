/* Parcours automatique de l'appli en mode démo (vérification rapide avant chaque publication).
   Usage : ouvrir /web/index.html?demo=1 à 360 px de large, puis dans la console :
     fetch('/tests/smoke.js').then(r => r.text()).then(eval); await smoke()
   Renvoie, pour chaque écran et chaque rôle : erreurs affichées, erreurs JavaScript, défauts mobiles. */
window.smoke = async function () {
  var w = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var jsErrors = [];
  window.addEventListener('error', function (e) { jsErrors.push(String(e.message)); });
  if (!window.audit) eval(await fetch('/tests/audit.js').then(function (r) { return r.text(); }));
  localStorage.clear();
  App.Store.set('demo', true);
  var E = encodeURIComponent, out = { problems: [], screens: 0 };
  async function login(id) {
    App.logout(); await w(300);
    App.go('#/login'); await w(300);
    document.querySelector('#l-id').value = id; document.querySelector('#l-pw').value = 'demo1234';
    document.querySelector('#l-form').requestSubmit();
    for (var i = 0; i < 40 && !App.S.data; i++) await w(100);
    await w(300);
  }
  async function visit(role, h) {
    location.hash = h; await w(450);
    out.screens++;
    var box = document.querySelector('#errorbox');
    var a = audit();
    var pb = [];
    if (!box.hidden) pb.push('erreur affichée : ' + box.innerText.split('\n')[0]);
    if (a.issues.length) pb.push('mobile : ' + a.issues.slice(0, 3).join(' ; '));
    if (!document.querySelector('h1')) pb.push('écran vide');
    if (pb.length) out.problems.push(role + ' ' + h + ' → ' + pb.join(' | '));
    box.hidden = true;
  }
  var common = ['#/recettes', '#/recette/' + E('Tacos bœuf (démo)'), '#/cuisine/' + E('Tacos bœuf (démo)'), '#/semaine', '#/courses',
    '#/ticket', '#/session', '#/profil', '#/poids', '#/foyer', '#/compte', '#/stock', '#/inviter', '#/proposer', '#/ingredient/nouveau', '#/plus'];
  await login('client');
  for (var i = 0; i < common.length; i++) await visit('client', common[i]);
  ['#/admin', '#/gestion', '#/comptes'].forEach(function () {});
  await login('admin');
  var admin = common.concat(['#/admin', '#/gestion', '#/comptes', '#/ingredients', '#/proposer-prix', '#/modifier-recette/' + E('Tacos bœuf (démo)')]);
  for (var j = 0; j < admin.length; j++) await visit('admin', admin[j]);
  ['valider', 'tickets', 'pop', 'users', 'qualite'].forEach(function () {});
  for (var t of ['valider', 'tickets', 'pop', 'users', 'qualite']) { App.Store.set('adminTab', t); App.S.dash = null; await visit('admin', '#/plus'); await visit('admin', '#/admin'); await w(400); }
  App.logout();
  out.jsErrors = jsErrors;
  out.ok = !out.problems.length && !jsErrors.length;
  return out;
};
