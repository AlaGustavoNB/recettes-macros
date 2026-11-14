/* Vérification d'affichage mobile : débordements, cibles tactiles < 44 px, texte < 12 px.
   Usage dans la console : fetch('/tests/audit.js').then(r=>r.text()).then(eval); puis audit() */
window.audit = function () {
  var W = document.documentElement.clientWidth, issues = [];
  if (document.documentElement.scrollWidth > W) issues.push('défilement horizontal ' + document.documentElement.scrollWidth + '>' + W);
  document.querySelectorAll('main *, nav *, #errorbox *').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || el.closest('[hidden]') || el.closest('datalist')) return;
    if (r.right > W + 0.5 || r.left < -0.5) issues.push('déborde: ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' ' + (el.textContent || '').slice(0, 30));
    if (el.matches('button, a.btn, input, select, textarea, nav a, a.back, summary')) {
      if (el.matches('input[type=checkbox]')) {
        var lab = el.closest('label');
        if (r.height >= 28 && lab && lab.getBoundingClientRect().height >= 44) return;
      }
      if (el.matches('input[type=file]')) return;
      if (r.height < 44 || r.width < 44) issues.push('petit: ' + el.tagName + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (el.textContent || el.value || '').slice(0, 25));
    }
    var cs = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && parseFloat(cs.fontSize) < 12) issues.push('texte petit ' + cs.fontSize + ': ' + el.textContent.slice(0, 20));
  });
  return { hash: location.hash, w: W, issues: issues.slice(0, 15) };
};
