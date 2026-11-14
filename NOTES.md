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
| Comptes avec identifiant + mot de passe, rôles client / admin | Onglet **Comptes** (empreinte HMAC-SHA256 salée × 300, jamais le mot de passe) ; l'appli reçoit un jeton signé `id|expiration|sel|signature` (60 jours), revérifié à chaque appel (compte actif, rôle, mot de passe inchangé) | 0 € |
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
  tests.html         80 tests : calculs (dont 528,75 kcal / 44,3 g / 2,11 €) + serveur Apps Script simulé
  audit.js           contrôle d'affichage mobile (débordement, boutons < 44 px, texte < 12 px)
```

## Règles du Sheet respectées par le serveur
- Onglets et colonnes inchangés. Seuls ajouts : colonnes **L « Rôle »** et **M « Rayon »** dans Ingrédients
  (bouton « Ajouter Rôle et Rayon » ou menu *Installer*), et un onglet **Profils** (prénom, kcal/jour,
  protéines/jour, objectif, repas/jour, marge %).
- Écritures uniquement dans les colonnes de saisie : Comptes A–H, Ingrédients A–M, Recettes A–F + R, S, U,
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

## Comptes et droits
- Toutes les actions demandent un jeton de connexion, même la lecture (`data`). Sans compte : aucune donnée.
- **Client** : lit les recettes, ne voit et ne modifie que **son** profil (forcé côté serveur), change son mot de passe.
- **Admin** : tout, plus la gestion de la base et des comptes (`listAccounts`, `createAccount`, `updateAccount`,
  `resetPassword`). Un admin ne peut pas se retirer ses propres droits. « Vue client » dans Plus masque les
  écrans admin sans se déconnecter.
- 5 mots de passe faux pour un identifiant → ce compte est bloqué 15 minutes (CacheService).
- Réinitialiser ou changer un mot de passe change le sel : les autres connexions de ce compte sont coupées.
- Premier compte admin : menu du Sheet *Appli recettes › 2. Créer ou réinitialiser mon compte admin*.

## Se connecter au Sheet / redéployer
- L'ID de l'application Web est inscrit dans `web/api.js` (`DEFAULT_API`) : l'appli installée s'y relie seule.
  Ce n'est pas un secret (sans compte, rien n'est renvoyé). Un lien `…/#api=<ID>` ou *Paramètres de connexion*
  permet d'utiliser un autre serveur.
- **Modifier le serveur** : colle le nouveau `Code.gs` dans Apps Script, puis *Déployer › Gérer les
  déploiements › ✏️ › Version : Nouvelle version › Déployer* (l'URL reste la même).
- **Modifier l'appli** : change les fichiers de `web/`, augmente `VERSION` dans `app.js` et `CACHE` dans
  `sw.js`, puis publie : `git add -A && git commit -m "…" && git push && git subtree push --prefix web origin gh-pages`.
- **Tester en local** : servir le dossier du projet (ex. `python -m http.server`), ouvrir
  `/tests/tests.html` (doit afficher 0 échec) et `/web/index.html?demo=1` (mode démo, comptes `admin` ou `client`, mot de passe `demo1234`).

## Limites connues
- Le dépôt GitHub est public (obligatoire pour GitHub Pages gratuit) : il ne contient ni secret ni
  l'adresse de ton Sheet ; l'ID du serveur y figure mais ne donne accès à rien sans compte.
- Pas de « mot de passe oublié » par e-mail : l'admin en redonne un dans *Comptes utilisateurs*.
- La lecture d'étiquette dépend de la netteté de la photo ; les valeurs sont toujours à valider.
- La dictée « 🎤 » dépend du navigateur (Chrome Android oui, Safari iPhone : utiliser le micro du clavier).
- Le plan de la semaine, les versions « alternatives » choisies et les cases cochées restent dans le téléphone
  (par profil), pas dans le Sheet.
