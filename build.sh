#!/bin/sh
# Fabrique les fichiers dérivés. À relancer après toute modification de
# apps-script/server.gs ou web/calc.js :
#  - apps-script/Code.gs  : le fichier à coller dans Apps Script (serveur + calculs partagés) ;
#  - web/demo-server.js   : le même serveur, exécuté dans le navigateur pour le mode démo.
cd "$(dirname "$0")"
cat apps-script/server.gs web/calc.js > apps-script/Code.gs
{
  echo '/* FICHIER FABRIQUÉ PAR build.sh : ne pas modifier à la main.'
  echo '   Mode démo : le VRAI serveur (apps-script/server.gs) exécuté dans le navigateur'
  echo '   sur un faux Sheet gardé dans le téléphone (voir demo.js). */'
  echo 'window.makeDemoServer = function (env) {'
  echo '  var SpreadsheetApp = env.SpreadsheetApp, PropertiesService = env.PropertiesService, CacheService = env.CacheService,'
  echo '    LockService = env.LockService, Utilities = env.Utilities, ContentService = env.ContentService, Session = env.Session,'
  echo '    Logger = env.Logger, MailApp = env.MailApp, ScriptApp = env.ScriptApp, DriveApp = env.DriveApp,'
  echo '    DocumentApp = env.DocumentApp, Drive = undefined, Calc = window.Calc;'
  cat apps-script/server.gs
  echo '  return { handle: function (req) { return JSON.parse(handle_(req).s); },'
  echo '    internal: { createAccount_: createAccount_, findAccount_: findAccount_, saveProfile_: saveProfile_, ensureAll_: ensureAll_,'
  echo '      setup_: setup_, createFoyer_: createFoyer_, joinFoyer_: joinFoyer_, setAvis_: setAvis_, addWeight_: addWeight_,'
  echo '      upsertOffer_: upsertOffer_, propose_: propose_ } };'
  echo '};'
} > web/demo-server.js
echo "apps-script/Code.gs : $(wc -l < apps-script/Code.gs) lignes ; web/demo-server.js : $(wc -l < web/demo-server.js) lignes"
