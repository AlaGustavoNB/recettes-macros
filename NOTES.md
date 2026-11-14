# NOTES — comment l'appli est construite

## En une phrase
Une page web statique installable (PWA) hébergée gratuitement sur GitHub Pages, qui parle à un petit
serveur **Google Apps Script** attaché à ton Google Sheet. Le Sheet reste la seule base de vérité.

```
Téléphone (appli web, hors ligne)  ──HTTPS──▶  Apps Script (s'exécute avec TON compte)  ──▶  Google Sheet (privé)
         GitHub Pages                                code secret + jetons ici                 + OCR Google Drive
```

## Choix techniques (et pourquoi)
| Besoin | Choix | Coût |
|---|---|---|
| Lire/écrire le Sheet sans compte Google pour tes proches | Apps Script « Application Web », exécuté en tant que toi, accès « Tout le monde » | 0 € |
| Code secret jamais dans le navigateur | Stocké dans les Propriétés du script ; l'appli reçoit un jeton signé (HMAC, 60 jours) | 0 € |
| Appli installable + hors ligne | PWA : `manifest.webmanifest` + service worker `sw.js` + copie des données dans `localStorage` | 0 € |
| Hébergement | GitHub Pages (dépôt public : le code ne contient aucun secret ni l'adresse du Sheet) | 0 € |
| Lecture d'étiquette | OCR de Google Drive (service avancé Drive API) appelé par Apps Script ; fichier temporaire supprimé aussitôt | 0 € |
| Planning dicté | Analyse du texte dans le téléphone (aucune IA payante) ; dictée par le micro du navigateur ou du clavier | 0 € |

Aucun service payant n'est utilisé. Si un jour tu veux une lecture d'étiquette plus fiable via une IA
(payante), il faudra le décider explicitement : rien n'est branché.

## Structure du code
```
apps-script/
  Code.gs            serveur : lecture, écritures, code secret, OCR, menu « Appli recettes » du Sheet
  appsscript.json    manifeste : service Drive API, droits demandés, accès de l'application Web
web/                 ce qui est mis en ligne (GitHub Pages, branche gh-pages)
  index.html         coquille de l'appli
  style.css          design sobre, cibles tactiles ≥ 48 px
  store.js           mémoire du téléphone (localStorage, protégé par try/catch)
  calc.js            TOUS les calculs, sans réseau : macros, protéines fixes, alternatives,
                     cru/cuit, planning en texte libre, liste de courses, lecture d'étiquette/prix
  api.js             appels au serveur (3 essais avec attente croissante) + serveur de démo local
  app.js             écrans (routage par #/…), minuteurs, rapport d'erreur
  demo-data.js       données fictives pour le mode démo (dont la recette d'exemple du fichier)
  sw.js              service worker (cache de l'appli pour le hors-ligne)
  guide.html         mode d'emploi affiché dans l'appli
  manifest.webmanifest, icons/
tests/
  tests.html         63 tests : calculs (dont 528,75 kcal / 44,3 g / 2,11 €) + serveur Apps Script simulé
  audit.js           contrôle d'affichage mobile (débordement, boutons < 44 px, texte < 12 px)
```

## Règles du Sheet respectées par le serveur
- Onglets et colonnes inchangés. Seuls ajouts : colonnes **L « Rôle »** et **M « Rayon »** dans Ingrédients
  (bouton « Ajouter Rôle et Rayon » ou menu *Installer*), et un onglet **Profils** (prénom, kcal/jour,
  protéines/jour, objectif, repas/jour, marge %).
- Écritures uniquement dans les colonnes de saisie : Ingrédients A–M, Recettes A–F + R, S, U,
  Lignes_recette A–C, Étapes A–D, Stock cuisine A–D. **Jamais** dans Recettes G–Q, T ni Lignes_recette D–I
  (vérifié par un test automatique).
- « Première ligne vide » = première ligne dont la colonne A est vide (les lignes de formules
  pré-remplies jusqu'à 201 / 501 comptent comme libres).
- Avant de modifier une ligne existante, le serveur vérifie que son contenu n'a pas bougé (sinon
  « Le Sheet a changé… Actualise »).
- Noms comparés au caractère près entre onglets ; doublons détectés en ignorant majuscules/accents.

## Le calcul « protéines fixes » (calc.js → `adjust`)
- Par portion : ingrédients de rôle *protéine*, *légume*, *autre* = fixes ; *glucide* et *lipide* = ajustés
  ensemble par un même facteur `s` pour atteindre les kcal voulues.
- Limite basse : `s ≥ 0,25` (on ne descend pas sous 25 % des féculents/matières grasses). En dessous :
  avertissement + alternatives, jamais de baisse silencieuse des protéines. Limite haute : `s ≤ 4`.
- Protéines comparées à la cible du profil par repas (protéines/jour ÷ repas/jour), marge 10 % ou 5 %.
- Alternatives (`alternatives`) : remplacer UN ingrédient par un autre de même rôle (ou le retirer),
  en résolvant protéines = protéines d'origine et kcal = cible ; seules celles dans la marge sont gardées.
- Le rôle vient de la colonne L ; si elle est vide, il est proposé d'après les macros (`suggestRole`,
  même règle dans Code.gs).

## Se connecter au Sheet / redéployer
- Le lien partagé est `https://<compte>.github.io/<dépôt>/#api=<ID>` : l'ID de l'application Web Apps Script
  est mémorisé dans le téléphone puis retiré de l'adresse. On peut aussi le coller dans *Plus › Connexion au Sheet*.
- **Modifier le serveur** : colle le nouveau `Code.gs` dans Apps Script, puis *Déployer › Gérer les
  déploiements › ✏️ › Version : Nouvelle version › Déployer* (l'URL reste la même).
- **Modifier l'appli** : change les fichiers de `web/`, augmente `VERSION` dans `app.js` et `CACHE` dans
  `sw.js`, puis publie : `git add -A && git commit -m "…" && git push && git subtree push --prefix web origin gh-pages`.
- **Tester en local** : servir le dossier du projet (ex. `python -m http.server`), ouvrir
  `/tests/tests.html` (doit afficher 0 échec) et `/web/index.html?demo=1` (mode démo, code `demo123`).

## Limites connues
- Le dépôt GitHub est public (obligatoire pour GitHub Pages gratuit) : il ne contient ni secret ni
  l'adresse de ton Sheet, mais toute personne qui a **le lien complet** peut lire les recettes (pas les modifier).
- La lecture d'étiquette dépend de la netteté de la photo ; les valeurs sont toujours à valider.
- La dictée « 🎤 » dépend du navigateur (Chrome Android oui, Safari iPhone : utiliser le micro du clavier).
- Le plan de la semaine, les versions « alternatives » choisies et les cases cochées restent dans le téléphone
  (par profil), pas dans le Sheet.
