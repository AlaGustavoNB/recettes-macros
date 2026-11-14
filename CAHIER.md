# Cahier des charges — version multi-utilisateurs (v2)

Décidé avec l'utilisateur le 14/11/2026. Tout est gratuit, en français, g / kcal / €.
Le Sheet reste la seule base de vérité. Règles d'origine inchangées (onglets et colonnes
existants intacts, jamais d'écriture dans Recettes G–Q/T ni Lignes_recette D–I, première ligne vide).

## Comptes
- Inscription libre, sans validation, depuis l'écran de connexion : prénom, e-mail, identifiant,
  mot de passe (×2), case « J'accepte la page de confidentialité ». Compte client créé et connecté.
- L'admin peut fermer/rouvrir les inscriptions (Comptes utilisateurs).
- Connexion avec identifiant OU e-mail. Le prénom est la clé du profil : unique.
- Mot de passe oublié : code à 6 chiffres envoyé par e-mail (Gmail de l'admin, MailApp), valable 15 min.
- Chacun peut supprimer son compte (compte, profil, poids, plannings, avis ; foyer supprimé s'il est vide).
- Page de confidentialité courte (données, lieu, accès, suppression).

## Ce qui est commun / personnel
- Commun : catalogue de recettes (et ingrédients, prix, photos, notes moyennes + commentaires).
- Personnel : objectifs, poids, calcul des recettes, planning de la semaine.
- Foyer : rejoint par un code ; liste de courses commune = somme des repas de chaque membre
  (chacun calculé selon SES objectifs, côté serveur) ; stock cuisine commun ; cases cochées communes.
  Personne seule = foyer d'une personne.
- Objectifs et poids visibles par la personne seule (pas par le foyer, pas dans l'appli admin).

## Objectifs
- Saisie : sexe, année de naissance, taille, poids, séances de sport/semaine, métier
  (assis / debout / physique), objectif (sèche / maintien / masse), protéines en g/kg (modifiable).
- L'appli propose kcal et protéines (Mifflin-St Jeor × activité ; sèche −20 %, masse +10 %),
  la personne peut corriger. Cibles glucides/lipides affichées (lipides 0,9 g/kg, glucides = reste).
- Même cible tous les jours.
- Poids saisi quand on veut ; moyenne par semaine ; après 3 semaines, si la tendance ne suit pas
  l'objectif, l'appli PROPOSE d'ajuster les kcal (±100), la personne valide.
- Allergies (liste) + ingrédients exclus → recettes concernées masquées.

## Recettes
- Ajout direct par l'admin ; les autres proposent (formulaire complet, nouveaux ingrédients
  compris, photo d'étiquette possible) → validation admin.
- Prix : les utilisateurs proposent un prix par magasin (taille du paquet + prix) → validation admin.
- Photos : proposées par tous, validées par l'admin. Stockées dans le Sheet (onglet Photos).
- Favoris, notes 1–5 avec moyenne visible, commentaires visibles par tous (publiés direct,
  supprimables par l'admin).
- Filtres : catégorie, objectif, temps de prépa, coût, favoris ; tri par note, prot./€, kcal.
- Remplacer un ingrédient à la volée (même rôle, kcal et protéines conservées).
- Quand l'admin modifie une recette, plannings et listes se recalculent (nouvelle version).

## Semaine
- Les deux modes : « 3 fois poulet-riz » ET placement facultatif jour × créneau (midi/soir/collation).
- Semaine suivante : planning vide (pas de reconduction).
- « Propose-moi une semaine » (favoris, notes, exclusions, variété).
- Restes : portions cuisinées en plus → repas « reste », non comptés dans les courses.

## Courses
- Liste du foyer, stock retranché, triée par rayon.
- Paquets par magasin (onglet Prix magasin : conditionnement + prix paquet) ; magasin le moins
  cher au kg choisi ; nombre de paquets et prix réel. Sinon prix au kg de l'onglet Ingrédients.
- Cases cochées enregistrées ; « J'ai fini mes courses » ajoute le coché au stock du foyer.
- Partager la liste (WhatsApp/SMS via le partage du téléphone).
- Hors ligne : on coche, on modifie le planning ; synchronisation automatique au retour du réseau.

## Cuisine
- Portions selon le planning du foyer (repas non cuisinés de la recette), pesée guidée
  (un ingrédient à la fois), minuteurs, répartition après cuisson par personne.
- Session de cuisine (batch) : tous les repas de la semaine regroupés.
- « C'est cuisiné » : repas marqués cuisinés, quantités retirées du stock, restes créés.

## Admin
- Tableau de bord : à valider, recettes populaires, utilisateurs actifs, qualité des données.
- Vue client / vue admin.
- Sauvegarde hebdomadaire automatique du Sheet (dossier Drive, 8 dernières gardées).
- Pastilles dans l'appli (pas de notifications push).

## Divers
- Mode sombre automatique.
- Nom de l'appli : 3 propositions à faire à l'utilisateur.

## Nouveaux onglets / colonnes (ajoutés à la fin, jamais insérés)
- Comptes : Identifiant | Prénom | Rôle | Actif | Créé le | Dernière connexion | Empreinte | Sel | E-mail | Foyer
- Profils (+ H→O) : Sexe | Année de naissance | Taille (cm) | Séances/semaine | Métier | Protéines g/kg | Allergies | Ingrédients exclus
- Ingrédients (+ N) : Allergènes
- Stock cuisine (+ E) : Foyer
- Foyers : Code | Nom | Créé par | Créé le
- Plannings : Semaine | Identifiant | Recette | Jour | Créneau | kcal | Cuisiné | Reste | Version
- Courses : Semaine | Foyer | Cochés | Terminées le | Mis à jour
- Poids : Identifiant | Date | Poids (kg)
- Avis : Recette | Identifiant | Favori | Note | Commentaire | Date
- Propositions : N° | Type | Statut | Par | Date | Titre | Données | Réponse
- Prix magasin : Ingrédient | Magasin | Conditionnement (g) | Prix paquet (€) | Date | Par
- Photos : Recette | Image | Par | Date
