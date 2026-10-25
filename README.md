# Cave & Amis

> Votre cave, vos amis, la bonne bouteille au bon moment.

Application web en français, pensée pour le téléphone et agréable sur ordinateur, pour gérer ses caves à vin, partager une
sélection de bouteilles avec ses amis, organiser des dîners et dégustations, et garder le souvenir des vins dégustés —
avec un **assistant sommelier (Claude)** dont la clé API, unique, reste sur le serveur.

- **Ma cave** : plusieurs caves et emplacements, fiches de vin distinctes des **lots** achetés (prix, dates, rangement, partage
  différents), recherche et filtres (nom, couleur, région, millésime, prix, maturité, emplacement), entrées et sorties avec
  **historique**, correction d'inventaire, **annulation d'une saisie**, protection contre les stocks négatifs et les doubles clics,
  export tableur.
- **Ajout en quelques gestes** : saisie courte (champs avancés repliés) ou **photo d'étiquette** lue par Claude ; formulaire
  pré-rempli à vérifier, informations incertaines signalées, inconnues laissées vides.
- **Amis & Groupes** : recherche des personnes qui l'acceptent, demandes d'ami, invitation par lien ou code, blocage,
  notifications. Chaque lot est **privé**, **partagé avec mes amis** ou **proposable pour un événement**, avec masquage
  indépendant du prix, de la quantité exacte et des notes. **Groupes** (famille, soirées…) avec rôles et invitations : on y rend
  des bouteilles **visibles**, ou on en **met à disposition** une quantité, réservée pour le groupe (« 6 en stock · dont 2 pour
  mes groupes · 4 libres »), jamais comptée deux fois, rendue si l'on quitte le groupe ; seul le propriétaire les ouvre, avec
  l'historique et l'activité du groupe. **Caves gérées à plusieurs** (un couple, une famille) : on y associe une personne de
  ses amis, avec son propre compte ; elle ajoute, boit, corrige et range les bouteilles, chaque mouvement à son nom ; un seul
  stock, un seul propriétaire. **Vie de groupe** : soirées du groupe (bouteilles du groupe suggérées, prises sur la mise à
  disposition et rendues si elles ne sont pas ouvertes), notes de dégustation partagées avec moyennes, envies communes avec
  « je participe », suggestions de Lia d'après les goûts du groupe.
- **Événements** (dîner, dégustation, anniversaire, soirée à thème) : invités et réponses, menu, thème et budget, bouteilles
  proposées ou suggérées, **confirmation par le propriétaire = réservation** (sans sortie de stock), disponibilité tenant compte
  des autres réservations, libération à l'annulation, confirmation après coup des bouteilles bues (stock mis à jour **une seule
  fois**), ordre de service conseillé, souvenirs partagés.
- **Mon carnet** : dégustations (même hors cave), note sur 5, observations guidées facultatives, prix payé (verre, restaurant,
  boutique), « à racheter », favoris, liste d'envies. Le stock ne change que si l'on indique que la bouteille vient de sa cave.
- **Prix** : prix d'achat, prix payé et **prix de marché** présentés séparément ; prix de marché uniquement par recherche web
  avec sources, date, contenance et devise, sinon « prix non vérifié ». Valeur d'achat et valeur de marché du stock, avec la
  part de la cave couverte (un prix inconnu n'est jamais compté comme zéro).
- **Conseils** : moment d'ouverture, garde, température, aération, accords, ordre de service — chaque information indique son
  origine : *source*, *repère général*, *estimation de l'IA* ou *votre choix*.
- **Assistant Claude** : conversation et accès depuis les fiches et les événements ; lit vos données **avec vos droits** ;
  propose des actions que **vous confirmez** ; cite ses sources pour les prix.
- **Administration** : test de la clé (jamais affichée), modèle, activation, quotas par personne, limites de fréquence et de
  taille, budget mensuel avec alertes, consommation globale et par personne, erreurs techniques.

Documentation : [mise en ligne pas à pas](docs/INSTALLATION.md) · [mode d'emploi](docs/GUIDE.md) ·
[sécurité, droits et coûts](docs/SECURITE.md) · [tests et limites](docs/TESTS.md)

## Essayer tout de suite sur ce poste (sans compte en ligne)

```bash
npm install
```

```bash
npm run local -- --demo
```

Ouvrez <http://localhost:5173>. Comptes de **démonstration** (données fictives, uniquement dans la base locale `.local/`) :
`alex@demo.local`, `camille@demo.local`, `sam@demo.local`, mot de passe `demo-cave-2026`. Sans `--demo`, la base locale
démarre vide. Depuis un téléphone sur le même Wi-Fi : l'adresse « Network » affichée.

L'assistant fonctionne en local **si** la variable d'environnement `ANTHROPIC_API_KEY` est définie dans votre session Windows
(elle reste côté serveur local) ; sinon il s'affiche « non configuré » et tout le reste fonctionne.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run local` | Serveur local tout-en-un (base PostgreSQL PGlite, comptes, photos, fonction serveur) + interface. Options : `--demo`, `--reset` |
| `npm run build` | Export de production dans `dist/` (+ `config.production.js`), contrôle des secrets et du code local |
| `npm run build:function` | Regroupe la fonction serveur dans `supabase/functions/cave-api/index.ts` (à déployer sur Supabase) |
| `npm run package:site` | Export + archive `livraison/cave-et-amis-site.zip` pour Netlify |
| `npm test` | Tests : règles, base de données et droits, serveur de l'assistant (Vitest + PGlite) |
| `npm run test:e2e` | Tests d'interface sur l'export de production, téléphone et ordinateur (Playwright, Microsoft Edge) |
| `npm run verify` | Tout vérifier ; rapport dans `reports/verification.json` |

## Architecture

- **Interface** : React 19 + TypeScript + Vite, application web installable (manifeste, service worker), navigation `#/…`.
- **Supabase** : comptes (e-mail et mot de passe), PostgreSQL protégé par **RLS sur toutes les tables**, stockage **privé** des
  photos (politiques d'accès sur les fichiers), et une **fonction serveur** (Edge Function Deno) `cave-api`.
- **Règles dans la base** : stocks et réservations modifiés uniquement par des fonctions transactionnelles ; contraintes
  « jamais de stock négatif » et « jamais plus de réservations que de bouteilles » (sûres même en cas d'appels simultanés) ;
  clés d'idempotence contre les doubles soumissions ; vues masquées pour les amis.
- **Assistant** : `server/api/` (SDK officiel `@anthropic-ai/sdk`). Lecture des données avec le jeton de la personne (RLS),
  outils de proposition sans écriture, réservation d'une enveloppe de budget avant chaque appel puis ajustement au coût réel.
- **Serveur local** : `server/local/` reproduit Supabase (Auth, PostgREST, Storage, Functions) sur une vraie base PostgreSQL
  (PGlite) avec les mêmes migrations ; il sert à l'essai local et aux tests. Il n'est jamais inclus dans l'export.

```
src/            interface : domain/ (règles pures), data/ (accès serveur), ui/ (kit, cadre), features/ (écrans)
server/api/     fonction serveur « cave-api » : assistant, budget, prix, étiquettes, suppression de compte
server/local/   serveur local tout-en-un (faux Supabase sur PGlite) et données de démonstration
supabase/       migrations SQL, fonction regroupée prête à déployer, config.toml
tests/          règles, base et droits, serveur de l'assistant (avec un faux Anthropic réservé aux tests)
e2e/            parcours d'interface (téléphone, ordinateur)
```
