# NOTES — comment l'appli est construite (v2)

## En une phrase
Une page web installable (PWA) hébergée gratuitement sur GitHub Pages, qui parle à un serveur
**Google Apps Script** attaché à ton Google Sheet. Le Sheet reste la seule base de vérité.
Le détail de ce qui a été décidé est dans [CAHIER.md](CAHIER.md).

```
Téléphone (appli, hors ligne + file d'attente)  ──HTTPS──▶  Apps Script (s'exécute avec TON compte)  ──▶  Google Sheet (privé)
          GitHub Pages                                      comptes, jetons, calculs du foyer             + OCR Drive, Gmail, sauvegardes
```

## Choix techniques (et pourquoi)
| Besoin | Choix | Coût |
|---|---|---|
| Lire/écrire le Sheet sans compte Google pour les utilisateurs | Apps Script « Application Web », exécuté en tant que toi, accès « Tout le monde » | 0 € |
| Comptes (inscription libre), rôles client/admin | Onglet **Comptes** (empreinte HMAC-SHA256 salée × 300) ; jeton signé `id\|expiration\|sel\|signature` (60 jours), revérifié à chaque appel | 0 € |
| Mot de passe oublié | Code à 6 chiffres envoyé avec `MailApp` (Gmail de l'admin, 100 e-mails/jour) ; empreinte du code en cache 15 min, 5 essais | 0 € |
| Même calcul partout | `web/calc.js` est copié dans le serveur par `build.sh` : le serveur calcule les repas de chaque membre du foyer avec SES objectifs, sans jamais les renvoyer | 0 € |
| Hors ligne | Copie des données dans `localStorage` + **file d'attente** (`Api.Sync`) : planning, cases cochées, stock, poids, avis, « cuisiné » sont envoyés au retour du réseau | 0 € |
| Mode démo fidèle | `web/demo-server.js` = le vrai serveur exécuté dans le navigateur sur un faux Sheet (`demo.js`) | 0 € |
| Photos de recettes | Réduites dans le téléphone (≤ 640 px, ≤ 44 000 caractères base64), stockées dans l'onglet **Photos**, chargées à la demande | 0 € |
| Code-barres | Scan en direct (caméra + cadre, code confirmé 2 fois) ou photo → lecteur intégré du téléphone (Android) ou bibliothèque gratuite ZXing chargée à la demande (iPhone) → fiche Open Food Facts (API publique gratuite, sans clé) ; valeurs surlignées et modifiables | 0 € |
| Prix pendant les courses | Bouton € par article (saisie ou photo d’étiquette) et ticket de caisse (photo, image ou PDF → OCR → `parseReceipt`) ; propositions de prix validées par l’admin | 0 € |
| Lecture d’étiquette | OCR de Google Drive (service avancé Drive API) ; fichier temporaire supprimé aussitôt ; 30 photos/jour max par utilisateur | 0 € |
| Sauvegarde | Déclencheur Apps Script chaque dimanche : copie du Sheet dans Drive, 8 gardées | 0 € |
| Notifications | Pastilles dans l'appli seulement (pas de push : il faudrait un service externe) | 0 € |

Aucun service payant n'est utilisé.

## Structure du code
```
build.sh               fabrique apps-script/Code.gs et web/demo-server.js (à relancer après toute modif
                       de apps-script/server.gs ou web/calc.js)
apps-script/
  server.gs            SOURCE du serveur (actions, comptes, foyers, plannings, avis, propositions…)
  Code.gs              FABRIQUÉ = server.gs + calc.js : c'est le fichier à coller dans Apps Script
  appsscript.json      manifeste : Drive API, droits (Sheet, Drive, déclencheurs, Gmail), accès Web
web/                   publié sur GitHub Pages (branche gh-pages)
  index.html, style.css (mode sombre automatique), sw.js, manifest.webmanifest, icons/
  store.js             mémoire du téléphone (try/catch)
  calc.js              TOUS les calculs : protéines fixes, alternatives, remplacements, objectifs
                       (Mifflin-St Jeor), tendance du poids, paquets/magasins, liste du foyer,
                       exclusions, semaine automatique, cru/cuit, textes dictés, étiquettes
  api.js               appels au serveur (essais répétés) + file d'attente hors ligne
  app.js               cœur : session, données, navigation, connexion/inscription/oubli, Plus, minuteurs
  screens-recettes.js  catalogue (filtres), fiche (avis, photo, remplacer), cuisine, session batch
  screens-semaine.js   semaine (jours/moments, proposition auto, restes), courses, stock
  screens-compte.js    objectifs, poids (courbe), foyer, mon compte (e-mail, mot de passe, suppression)
  screens-admin.js     propositions (recette, ingrédient, prix), tableau de bord, comptes, gestion
  demo-data.js, demo.js, demo-server.js   mode démo
  guide.html, confidentialite.html
tests/
  tests.html           143 tests : calculs + serveur simulé (comptes, inscription, oubli, foyer,
                       planning, cuisine, avis, propositions, suppression, colonnes calculées intactes)
  audit.js             contrôle d'affichage mobile
```

## Le Sheet
- Onglets d'origine intacts. Colonnes ajoutées **à la fin** : Ingrédients **N « Allergènes »**,
  Stock cuisine **E « Foyer »**, Profils **H→O** (sexe, année, taille, séances, métier, g/kg, allergies, exclus).
- Onglets ajoutés par *Installer / vérifier* : Comptes, Foyers, Plannings, Courses, Poids, Avis,
  Propositions, Prix magasin, Photos (en-têtes en gras, première ligne figée).
- **Jamais** d'écriture dans Recettes G–Q, T ni Lignes_recette D–I (test automatique).
- « Première ligne vide » = première ligne dont la colonne A est vide. Les suppressions vident la ligne
  (pas de décalage), la ligne vide est réutilisée ensuite.
- Stock sans colonne Foyer (ancienne version) = stock du premier admin ; il suit l'admin dans son foyer.

## Comptes et droits
- Toute action demande un jeton, sauf : connexion, inscription, mot de passe oublié.
- **Client** : catalogue, son profil/poids/planning, son foyer (stock, courses, cuisine), avis, propositions.
- **Admin** : en plus, ajout direct au catalogue, validation des propositions, tableau de bord, comptes,
  inscriptions ouvertes/fermées, suppression de commentaires, prix en magasin.
- Objectifs et poids : jamais renvoyés à quelqu'un d'autre (le serveur ne renvoie que `profile` de la personne
  connectée ; `foyerWeek` renvoie des quantités, pas les cibles).
- Prénom unique (clé du profil). 5 essais faux → compte bloqué 15 min. Changer/réinitialiser le mot de passe coupe les autres connexions.
- Dernier admin : ne peut ni se retirer ses droits ni supprimer son compte.

## Foyer, planning, courses
- Plannings : une ligne par repas (semaine, personne, recette, jour, moment, kcal, cuisiné, reste, version, id).
  L'appli envoie le planning complet d'une semaine (remplacé côté serveur) ; « cuisiné » ne se perd jamais.
- Liste de courses = besoins de tous les repas non cuisinés et non « restes » du foyer − stock, arrondis aux
  paquets du magasin le moins cher au kilo (onglet Prix magasin), sinon prix au kg de l'onglet Ingrédients.
- « J'ai fini mes courses » : le coché (paquets entiers) est ajouté au stock du foyer.
- « C'est cuisiné » : repas marqués, quantités crues retirées du stock (seulement les ingrédients présents),
  portions en plus → repas « reste » dans le planning de la personne.
- Une recette modifiée par l'admin : tout est recalculé (les plannings ne stockent que recette + kcal, sauf
  version modifiée choisie par la personne).

## Publier
- **Serveur** : `sh build.sh`, recoller `apps-script/Code.gs`, puis *Déployer › Gérer les déploiements › ✏️ ›
  Nouvelle version*.
- **Appli** : augmenter `VERSION` (app.js) et `CACHE` (sw.js), puis
  `git add -A && git commit -m "…" && git push && git subtree push --prefix web origin gh-pages`.
- **Tester** : servir le dossier, ouvrir `/tests/tests.html` (0 échec) et `/web/index.html?demo=1`
  (comptes `admin` / `client`, mot de passe `demo1234`).

## Limites connues
- Dépôt GitHub public (obligatoire pour Pages gratuit) : aucun secret dedans ; l'ID du serveur ne donne accès à rien sans compte.
- Inscription libre : toute personne ayant le lien peut créer un compte client (l'admin peut fermer les inscriptions ou désactiver un compte).
- Pas de vérification de l'adresse e-mail à l'inscription.
- Photos limitées à ~33 Ko (qualité réduite) pour tenir dans une case du Sheet.
- Lecture d'étiquette : dépend de la netteté ; valeurs toujours à valider.
- Dictée « 🎤 » : Chrome Android oui ; sur iPhone, utiliser le micro du clavier.
- Les autres membres du foyer apparaissent dans la liste après « Actualiser » (pas de temps réel).
