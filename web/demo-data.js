/* Données de DÉMONSTRATION, fictives. La recette « Poulet riz brocoli (exemple) »
   et ses 4 ingrédients reprennent exactement le fichier Base_recettes_macros_prix.xlsx
   (528,75 kcal ; 44,3 g de protéines ; 2,11 € par portion). Le reste est inventé
   pour montrer les fonctions. Jamais utilisé quand l'appli est reliée au Sheet. */
window.DEMO_DATA = {
  ingredients: [
    { row: 2, name: 'Riz basmati cru', etat: 'Cru', kcal: 355, p: 7.5, g: 78, l: 0.9, f: 1.4, prix: 3.6, magasin: 'Exemple', source: 'Exemple approximatif, à vérifier', remarque: 'Prix d’exemple à remplacer', role: '', rayon: '' },
    { row: 3, name: 'Filet de poulet cru', etat: 'Cru', kcal: 110, p: 23, g: 0, l: 1.5, f: 0, prix: 9.5, magasin: 'Exemple', source: 'Exemple approximatif, à vérifier', remarque: 'Prix d’exemple à remplacer', role: '', rayon: '' },
    { row: 4, name: 'Brocoli cuit', etat: 'Cuit', kcal: 35, p: 2.8, g: 4, l: 0.4, f: 3, prix: 2.5, magasin: 'Exemple', source: 'Exemple approximatif, à vérifier', remarque: 'Prix d’exemple à remplacer', role: '', rayon: '' },
    { row: 5, name: 'Huile d\'olive', etat: 'Autre', kcal: 900, p: 0, g: 0, l: 100, f: 0, prix: 8, magasin: 'Exemple', source: 'Exemple approximatif, à vérifier', remarque: 'Prix d’exemple à remplacer', role: '', rayon: '' },
    { row: 6, name: 'Blanc de dinde cru (démo)', etat: 'Cru', kcal: 105, p: 24, g: 0, l: 1, f: 0, prix: 10.9, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 7, name: 'Cabillaud cru (démo)', etat: 'Cru', kcal: 80, p: 18, g: 0, l: 0.7, f: 0, prix: 14.5, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 8, name: 'Pâtes complètes crues (démo)', etat: 'Cru', kcal: 350, p: 13, g: 64, l: 2.5, f: 7, prix: 2.2, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 9, name: 'Patate douce crue (démo)', etat: 'Cru', kcal: 86, p: 1.6, g: 20, l: 0.1, f: 3, prix: 2.9, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 10, name: 'Haricots verts cuits (démo)', etat: 'Cuit', kcal: 30, p: 1.8, g: 4.5, l: 0.2, f: 3.2, prix: null, magasin: 'Démo', source: 'Démo', remarque: 'Prix manquant', role: '', rayon: '' },
    { row: 11, name: 'Bœuf haché 5 % cru (démo)', etat: 'Cru', kcal: 125, p: 21, g: 0, l: 5, f: 0, prix: 12.9, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 12, name: 'Tortilla de blé (démo)', etat: 'Autre', kcal: 310, p: 8.5, g: 52, l: 7, f: 3, prix: 6.5, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 13, name: 'Tomate crue (démo)', etat: 'Cru', kcal: 18, p: 0.9, g: 3, l: 0.2, f: 1.2, prix: 3.2, magasin: 'Démo', source: 'Démo', remarque: '', role: '', rayon: '' },
    { row: 14, name: 'Fromage râpé (démo)', etat: 'Autre', kcal: 380, p: 27, g: 0.5, l: 30, f: 0, prix: 11, magasin: 'Démo', source: 'Démo', remarque: '', role: 'lipide', rayon: 'épicerie' }
  ],
  recipes: [
    { row: 2, name: 'Poulet riz brocoli (exemple)', portions: 1, categorie: 'Déjeuner', objectif: 'Maintien', prepa: 10, cuisson: 20,
      favori: 'Non', statut: 'À tester', controle: 'OK', notes: 'Recette d’exemple : à supprimer ou remplacer',
      lines: [
        { row: 2, ing: 'Riz basmati cru', qty: 75 }, { row: 3, ing: 'Filet de poulet cru', qty: 150 },
        { row: 4, ing: 'Brocoli cuit', qty: 150 }, { row: 5, ing: 'Huile d\'olive', qty: 5 }],
      steps: [
        { n: 1, text: 'Cuire le riz dans l’eau bouillante salée.', timer: 12 },
        { n: 2, text: 'Saisir le poulet coupé en dés avec l’huile d’olive.', timer: 8 },
        { n: 3, text: 'Cuire le brocoli à la vapeur.', timer: 6 },
        { n: 4, text: 'Dresser l’assiette et assaisonner.', timer: null }] },
    { row: 3, name: 'Tacos bœuf (démo)', portions: 4, categorie: 'Dîner', objectif: 'Masse', prepa: 15, cuisson: 10,
      favori: 'Oui', statut: 'Validée', controle: 'OK', notes: 'Démo',
      lines: [
        { row: 6, ing: 'Bœuf haché 5 % cru (démo)', qty: 400 }, { row: 7, ing: 'Tortilla de blé (démo)', qty: 240 },
        { row: 8, ing: 'Tomate crue (démo)', qty: 200 }, { row: 9, ing: 'Fromage râpé (démo)', qty: 60 },
        { row: 10, ing: 'Huile d\'olive', qty: 10 }],
      steps: [
        { n: 1, text: 'Faire revenir le bœuf haché avec l’huile.', timer: 7 },
        { n: 2, text: 'Chauffer les tortillas à la poêle.', timer: 1 },
        { n: 3, text: 'Garnir : bœuf, tomate, fromage.', timer: null }] },
    { row: 4, name: 'Cabillaud patate douce (démo)', portions: 2, categorie: 'Dîner', objectif: 'Sèche', prepa: 10, cuisson: 25,
      favori: 'Non', statut: 'À tester', controle: 'Prix manquant', notes: 'Démo',
      lines: [
        { row: 11, ing: 'Cabillaud cru (démo)', qty: 300 }, { row: 12, ing: 'Patate douce crue (démo)', qty: 400 },
        { row: 13, ing: 'Haricots verts cuits (démo)', qty: 300 }, { row: 14, ing: 'Huile d\'olive', qty: 10 }],
      steps: [
        { n: 1, text: 'Cuire la patate douce en cubes au four à 200 °C.', timer: 25 },
        { n: 2, text: 'Cuire le cabillaud à la poêle.', timer: 6 }] }
  ],
  stock: [
    { row: 2, ing: 'Riz basmati cru', qty: 500, date: '', remarque: 'Stock d’exemple' },
    { row: 3, ing: 'Huile d\'olive', qty: 200, date: '', remarque: 'Stock d’exemple' }
  ],
  profiles: [
    { row: 2, name: 'Moi (démo)', kcal: 2400, prot: 160, objectif: 'Maintien', repas: 4, marge: 10 },
    { row: 3, name: 'Proche (démo)', kcal: 1800, prot: 110, objectif: 'Sèche', repas: 3, marge: 10 }
  ],
  hasRoleColumns: false
};
