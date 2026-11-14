# Installation pas à pas (débutant)

Durée : environ 15 minutes, une seule fois. Tout est gratuit.

## Étape 1 — Brancher le Google Sheet (5 min)

1. Ouvre ton Google Sheet de recettes sur un ordinateur.
2. Menu **Extensions › Apps Script**. Un nouvel onglet s'ouvre.
3. À gauche, clique sur **Code.gs**. Efface tout le texte, puis colle tout le contenu du fichier
   `apps-script/Code.gs`. Clique sur l'icône **disquette** (Enregistrer).
4. Clique sur la **roue dentée** (Paramètres du projet) à gauche, coche
   **« Afficher le fichier manifeste "appsscript.json" dans l'éditeur »**.
5. Reviens dans l'éditeur (icône `< >`), ouvre **appsscript.json**, efface tout, colle le contenu du fichier
   `apps-script/appsscript.json`, enregistre. (Ça active la lecture de photo gratuite de Google Drive.)

## Étape 2 — Autoriser Google une seule fois (2 min)

1. Retourne sur l'onglet du **Sheet** et recharge la page (F5). Un menu **Appli recettes** apparaît en haut
   (attends quelques secondes).
2. Clique **Appli recettes › 1. Installer / vérifier**.
3. Google demande une autorisation : **Continuer**, choisis ton compte.
4. Écran « Google n'a pas validé cette application » : c'est normal, c'est ton propre script.
   Clique **Paramètres avancés**, puis **Accéder à … (non sécurisé)**, puis **Autoriser**.
5. Relance **Appli recettes › 1. Installer / vérifier**. Un message confirme : colonnes Rôle et Rayon
   ajoutées, onglet Profils créé. Vérifie les rôles proposés dans les colonnes L et M et corrige-les si besoin.

## Étape 3 — Créer ton compte admin (1 min)

1. **Appli recettes › 2. Créer ou réinitialiser mon compte admin**.
2. Tape ton identifiant (ex. `nacim`), le prénom de ton profil (ex. `Nacim`), puis un mot de passe
   d'au moins 8 caractères. Le mot de passe n'est jamais stocké en clair : l'onglet **Comptes** ne garde
   qu'une empreinte.
3. Mot de passe admin oublié : refais cette étape avec le même identifiant.
4. Les comptes de tes proches se créent ensuite dans l'appli : **Plus › Comptes utilisateurs**.

## Étape 4 — Publier le serveur (2 min)

1. Dans l'onglet Apps Script, bouton bleu **Déployer › Nouveau déploiement**.
2. Roue dentée à côté de « Sélectionner le type » › **Application Web**.
3. Description : `v1`. **Exécuter en tant que : Moi**. **Qui a accès : Tout le monde**.
4. **Déployer**. Copie l'**URL de l'application Web** (elle se termine par `/exec`).
   Ton Sheet reste privé : seule l'appli, via ce script, peut le lire.

## Étape 5 — Se connecter et inviter ses proches

1. L'appli est déjà reliée à ton serveur (son identifiant est dans `web/api.js`, `DEFAULT_API`) :
   ouvre **https://alagustavonb.github.io/recettes-macros/** et connecte-toi avec ton compte admin.
2. **Plus › Comptes utilisateurs** : crée un compte par personne (identifiant, prénom du profil, mot de passe
   provisoire, rôle client).
3. Envoie-lui le lien de l'appli, son identifiant et son mot de passe. Elle se connecte, règle ses cibles,
   installe l'appli sur l'écran d'accueil et peut changer son mot de passe dans **Plus › Mon compte**.

Sans identifiant ni mot de passe, le serveur ne renvoie aucune donnée : le lien seul ne suffit plus.

Si tu refais un **Nouveau déploiement** (nouvelle URL `/exec`), il faut mettre à jour `DEFAULT_API` dans
`web/api.js` (demande à Claude) ; en attendant, chacun peut coller l'URL dans **Connexion › Paramètres de connexion**.

## Plus tard : mettre à jour le serveur

Après avoir recollé un nouveau `Code.gs` : **Déployer › Gérer les déploiements › ✏️ (crayon) ›
Version : Nouvelle version › Déployer**. Le lien ne change pas.

## Si quelque chose ne marche pas
- Dans l'appli, le message d'erreur dit quoi faire. **Copier le rapport d'erreur**, puis colle-le dans Claude Code.
- « Réponse inattendue du serveur Google » : vérifie l'étape 4 (accès **Tout le monde**).
- « Service Drive API non activé » : refais l'étape 1.5, ou dans Apps Script : **Services › + › Drive API › Ajouter**.
