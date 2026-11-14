/* Stockage sur le téléphone (copie hors ligne). Tout est protégé par try/catch :
   en navigation privée l'appli marche quand même, sans mémoire. */
(function (root) {
  'use strict';
  var P = 'recettes.';
  var mem = {};
  root.Store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(P + k); return v === null ? def : JSON.parse(v); }
      catch (e) { return k in mem ? mem[k] : def; }
    },
    set: function (k, v) {
      mem[k] = v;
      try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) { delete mem[k]; try { localStorage.removeItem(P + k); } catch (e) {} }
  };
})(window);
