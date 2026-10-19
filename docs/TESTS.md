# Tests et limites

Commande unique : `npm run verify` (rapport `reports/verification.json`). Dernière exécution : **19 octobre 2026, tout vert**.

| Étape | Résultat |
| --- | --- |
| Fonction serveur regroupée (`supabase/functions/cave-api/index.ts`), sans clé, exécutée telle quelle dans un test | ✔ |
| Types TypeScript | ✔ |
| Vitest : 83 tests (règles, base et droits sur PostgreSQL PGlite, serveur de l'assistant avec un faux Anthropic) | ✔ 83/83 |
| Export de production + contrôle des secrets et du code local | ✔ |
| Playwright (Microsoft Edge) sur l'export de production : 10 parcours téléphone + 1 ordinateur | ✔ 11/11 |

Les tests d'interface utilisent le **serveur local** (mêmes migrations et règles que Supabase) et, pour l'assistant, un
**faux serveur Anthropic réservé aux tests** (`e2e/mock-anthropic.mjs`, `tests/helpers/anthropicMock.ts`) : il vérifie le
comportement de l'application (droits, budget, affichage, confirmations), **pas** la qualité des réponses du vrai Claude.

## Critères demandés → où ils sont vérifiés

| Critère | Tests |
| --- | --- |
| Création d'un compte et reconnexion | e2e « création de compte… reconnexion » ; profil, première cave et premier administrateur : `tests/sql/smoke` |
| Ajout manuel d'un vin | e2e (formulaire court) |
| Identification d'une photo avec validation | e2e (champs incertains surlignés, correction avant enregistrement) ; `tests/ai/assistant` (rien n'est enregistré, photo d'un autre refusée) |
| Plusieurs lots d'un même vin | e2e (second lot, doublon détecté) ; `tests/sql/stock` |
| Partage sélectif avec un ami | e2e (prix masqué, vin privé invisible) ; `tests/sql/sharing` (masques prix / quantité / notes) |
| Refus d'accès aux données privées, y compris via l'IA et les photos | `tests/sql/sharing`, `tests/api/photos` (photo d'un autre, lien signé, après fin d'amitié) ; `tests/ai/assistant` (outils de l'IA : rien de privé d'un autre, proposition sur le lot d'un autre refusée, conversation d'un autre inaccessible) |
| Événement et confirmation des bouteilles | e2e (suggestion de Claire, confirmation par Bruno = réservation) ; `tests/sql/events` |
| Réservations excessives et stocks négatifs | `tests/sql/events` (dépassement entre deux événements, sortie bloquée si réservée), `tests/sql/stock` ; e2e (disponibilité affichée, doublon refusé) |
| Annulation et libération | e2e + `tests/sql/events` (annulation, désistement d'un invité) |
| Consommation sans double décompte | e2e (stock baisse une fois, rechargement compris) ; `tests/sql/events` (deuxième confirmation sans effet), `tests/sql/stock` (même clé envoyée deux fois) |
| Dégustation extérieure sans modification du stock | e2e ; `tests/sql/carnet` |
| Protection de la clé API | `tests/ai/assistant` et `budget` (clé absente des réponses, des messages au modèle, des erreurs journalisées) ; e2e administration ; export contrôlé (`check-dist`) ; fonction regroupée sans clé |
| Quotas et budget | `tests/ai/budget` : quota quotidien, quota personnalisé, budget global, **demandes simultanées** (enveloppe réservée), fréquence, blocage, modèle sans tarif ; e2e quota atteint |
| Fonctionnement manuel sans IA | `tests/ai/assistant` (clé absente) ; e2e (quota atteint : Claire ajoute un vin) |
| Erreurs : clé invalide, quota épuisé, service indisponible | `tests/ai/budget` (401 journalisé sans secret, 529 et coupure réseau, nouvelle tentative) |
| Téléphone et ordinateur | e2e : projet « telephone » (390 × 844, tactile) et « ordinateur » (1366 × 860, aucun débordement horizontal) |

Captures d'écran des parcours : `reports/screens/`.

## Non vérifié ici (à faire après la mise en ligne)

- **Le vrai service Anthropic** : aucune clé n'a été utilisée pendant le développement. Après avoir collé la clé dans les secrets
  Supabase, utilisez **Administration › Tester la connexion** (liste des modèles + petit appel de test), puis une identification
  d'étiquette et une recherche de prix réelles. La recherche web doit être autorisée pour l'organisation Anthropic.
- **Le vrai Supabase** (déploiement de la migration, de la fonction Deno, du stockage) et **Netlify** : la fonction a été testée
  sous Node avec un environnement Deno simulé, pas sur Deno lui-même.
- De **vrais téléphones** (appareil photo, installation sur l'écran d'accueil).

## Limites connues

- Pas de notifications (ni push, ni e-mail) : les invitations se partagent par lien ; les données se rafraîchissent à
  l'ouverture, au changement d'écran et toutes les 2 minutes.
- « Mot de passe oublié » nécessite un service d'envoi d'e-mails branché dans Supabase (voir INSTALLATION, étape 1.6).
- Le coût des pages lues par la recherche web est **estimé** (provision par recherche), pas plafonné strictement ; la limite
  de dépense de la console Anthropic sert de plafond absolu.
- Les fenêtres de garde « repère général » sont volontairement approximatives (couleur, style, millésime) et signalées « ≈ ».
- Les prix de marché sont relevés par l'assistant sur des pages réellement trouvées ; ils peuvent varier et sont à confirmer
  sur le site marchand.
- Un compte supprimé supprime aussi les événements qu'il organisait (les réservations des autres sont libérées).
