# Installation pas à pas (débutant)

Durée : environ 15 minutes, une seule fois. Tout est gratuit.

## Mettre à jour vers la version 2 (si le script est déjà installé)

1. Ouvre le Sheet › **Extensions › Apps Script**.
2. **Code.gs** : efface tout, colle le contenu de `apps-script/Code.gs`, enregistre.
3. **appsscript.json** : efface tout, colle le contenu de `apps-script/appsscript.json`, enregistre.
   (La v2 demande 3 autorisations de plus : copier le Sheet pour la sauvegarde, créer le déclencheur
   du dimanche, envoyer l'e-mail « mot de passe oublié » depuis ton Gmail.)
4. Retourne sur le Sheet, recharge (F5), puis **Appli recettes › 1. Installer / vérifier**.
   Google redemande l'autorisation : accepte comme la première fois (Paramètres avancés › Accéder à…).
   Les nouveaux onglets (Foyers, Plannings, Courses, Poids, Avis, Propositions, Prix magasin, Photos)
   et les nouvelles colonnes sont ajoutés à la fin. Rien d'existant n'est déplacé.
5. **Déployer › Gérer les déploiements › ✏️ › Version : Nouvelle version › Déployer**. Le lien ne change pas.

## Première installation

### Étape 1 — Brancher le Google Sheet (5 min)
1. Ouvre ton Google Sheet de recettes sur un ordinateur.
2. Menu **Extensions › Apps Script**. Un nouvel onglet s'ouvre.
3. À gauche, clique sur **Code.gs**. Efface tout, colle tout le contenu de `apps-script/Code.gs`.
   Clique sur l'icône **disquette** (Enregistrer).
4. **Roue dentée** (Paramètres du projet) à gauche › coche
   **« Afficher le fichier manifeste "appsscript.json" dans l'éditeur »**.
5. Reviens dans l'éditeur (icône `< >`), ouvre **appsscript.json**, efface tout, colle le contenu de
   `apps-script/appsscript.json`, enregistre.

### Étape 2 — Autoriser Google une seule fois (2 min)
1. Retourne sur l'onglet du **Sheet** et recharge la page (F5). Un menu **Appli recettes** apparaît.
2. **Appli recettes › 1. Installer / vérifier**.
3. Google demande une autorisation : **Continuer**, choisis ton compte.
4. « Google n'a pas validé cette application » : c'est normal, c'est ton propre script.
   **Paramètres avancés › Accéder à … (non sécurisé) › Autoriser**.
5. Relance **1. Installer / vérifier** : un message liste ce qui a été ajouté et confirme la
   sauvegarde automatique du dimanche.

### Étape 3 — Créer ton compte admin (1 min)
1. **Appli recettes › 2. Créer ou réinitialiser mon compte admin**.
2. Identifiant (ex. `nacim`), prénom (ex. `Nacim`), mot de passe (8 caractères minimum).
   Le mot de passe n'est jamais stocké en clair.
3. Mot de passe admin oublié : refais cette étape avec le même identifiant.

### Étape 4 — Publier le serveur (2 min)
1. Dans Apps Script : **Déployer › Nouveau déploiement** › roue dentée › **Application Web**.
2. **Exécuter en tant que : Moi**. **Qui a accès : Tout le monde**. **Déployer**.
3. Copie l'URL (elle se termine par `/exec`). Si elle est différente de celle inscrite dans
   `web/api.js` (`DEFAULT_API`), demande à Claude de la mettre à jour.

### Étape 5 — Ouvrir l'appli et inviter
1. Ouvre **https://alagustavonb.github.io/recettes-macros/** et connecte-toi avec ton compte admin.
2. Envoie ce lien à tes proches : chacun **crée son compte** (prénom, e-mail, identifiant, mot de passe),
   règle ses objectifs, puis installe l'appli sur l'écran d'accueil.
3. Pour partager une liste de courses : l'un crée un **foyer** (Plus › Mon foyer) et donne le code aux autres.
4. Tu peux fermer les inscriptions libres dans **Plus › Comptes utilisateurs**.

## Plus tard : mettre à jour le serveur
Après avoir recollé un nouveau `Code.gs` : **Déployer › Gérer les déploiements › ✏️ ›
Version : Nouvelle version › Déployer**. Le lien ne change pas.

## Sauvegardes
Chaque dimanche vers 3 h, une copie du Sheet est faite dans le dossier Drive **« Sauvegardes recettes »**
(les 8 dernières sont gardées). Pour en faire une tout de suite : **Appli recettes › 3. Faire une sauvegarde
maintenant**. Pour restaurer : ouvre la copie voulue et copie-colle les onglets nécessaires.

## Si quelque chose ne marche pas
- Dans l'appli, le message d'erreur dit quoi faire. **Copier le rapport d'erreur**, puis colle-le dans Claude Code.
- « Réponse inattendue du serveur Google » : vérifie l'étape 4 (accès **Tout le monde**) et la nouvelle version.
- « Onglet introuvable » : **Appli recettes › 1. Installer / vérifier**.
- « Service Drive API non activé » : dans Apps Script : **Services › + › Drive API › Ajouter**.
- L'e-mail « mot de passe oublié » n'arrive pas : regarde les indésirables ; Gmail gratuit permet 100 e-mails par jour.
