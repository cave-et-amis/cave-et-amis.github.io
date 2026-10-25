# Tests et limites

Commande unique : `npm run verify` (rapport `reports/verification.json`). Dernière exécution : **25 octobre 2026, tout vert**.

| Étape | Résultat |
| --- | --- |
| Fonction serveur regroupée (`supabase/functions/cave-api/index.ts`), sans clé, exécutée telle quelle dans un test | ✔ |
| Types TypeScript | ✔ |
| Vitest : 222 tests (règles, base et droits sur PostgreSQL PGlite, serveur de l'assistant avec un faux Anthropic, aide, QR code) | ✔ 222/222 |
| Export de production + contrôle des secrets et du code local | ✔ |
| Playwright (Microsoft Edge) sur l'export de production : 29 parcours téléphone + 3 ordinateur | ✔ 32/32 |

Les tests d'interface utilisent le **serveur local** (mêmes migrations et règles que Supabase) et, pour l'assistant, un
**faux serveur Anthropic réservé aux tests** (`e2e/mock-anthropic.mjs`, `tests/helpers/anthropicMock.ts`) : il vérifie le
comportement de l'application (droits, budget, affichage, confirmations), **pas** la qualité des réponses du vrai Claude.

## Relecture de sécurité indépendante

Une relecture dédiée (droits en base, fonction serveur, budget) a confirmé que les fonctions internes ne sont pas appelables
par les utilisateurs, que les masques de partage sont appliqués et que la clé ne fuit pas. Elle a relevé des défauts, tous
corrigés et couverts par des tests : suppression d'un compte possédant des bouteilles (échouait), suggestion d'un compte
supprimé (effaçait la bouteille d'un autre), carnet de l'assistant mélangé aux notes partagées par d'autres, lecture limitée
à 1 000 lignes, durée maximale d'une demande, nouvelle tentative pouvant être facturée deux fois, clé d'idempotence d'un autre
utilisateur, droits par défaut des futures migrations.

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
| Suppression de compte | `tests/ai/account` (bouteilles, photos même orphelines, réservations ; les événements des autres restent intacts) |
| Protection de la clé API | `tests/ai/assistant` et `budget` (clé absente des réponses, des messages au modèle, des erreurs journalisées) ; e2e administration ; export contrôlé (`check-dist`) ; fonction regroupée sans clé |
| Quotas et budget | `tests/ai/budget` : quota quotidien, quota personnalisé, budget global, **demandes simultanées** (enveloppe réservée), fréquence, blocage, modèle sans tarif ; e2e quota atteint |
| Fonctionnement manuel sans IA | `tests/ai/assistant` (clé absente) ; e2e (quota atteint : Claire ajoute un vin) |
| Erreurs : clé invalide, quota épuisé, service indisponible | `tests/ai/budget` (401 journalisé sans secret, 529 et coupure réseau, nouvelle tentative) |
| Téléphone et ordinateur | e2e : projet « telephone » (390 × 844, tactile) et « ordinateur » (1366 × 860, aucun débordement horizontal) |
| Inviter sans ouvrir sa cave : relation et accès séparés | `tests/sql/contacts-acces-cave` (22 tests : un contact ne voit aucun lot « amis » par aucun chemin ; événement : seulement les vins proposés ; groupe : seulement ses partages ; accès à sens unique ; fermer sans perdre relation, groupes ni événements ; migration des amitiés existantes dans les deux sens ; liens « découvrir » (10 utilisations, expiration, révocation, un compte compté une fois), « ami », groupe et événement (rôles, arrivée sur la cible, 50 membres) ; page sans compte limitée au prénom, au titre et à la date ; blocage ; aperçu jamais au-delà de ses propres lots ; demandes d'accès (unicité, 30 jours, 20 par jour) ; exceptions « masquer » et « montrer » ; niveau « Restreint » ; réglages d'un autre propriétaire illisibles et non modifiables ; **aperçu identique à ce que chacun lit réellement** ; « fermer à tout le monde ») ; `tests/ai/assistant` (Lia ne voit rien d'un simple contact, puis sa bouteille une fois la cave ouverte) ; e2e `vitrine-contacts` (vitrine → inscription → arrivée sur l'événement ; ouvrir / fermer sa cave ; section « Bouteilles partagées » masquée ; « Ce que X voit de moi » → masquer une bouteille → l'ami ne la voit plus ; demande d'accès ; « Qui voit ma cave ») |
| Scanner avant d'acheter (lot 3a) | `tests/ai/scan` (contrôle des réponses : degré, prix du rayon, candidats, défauts ; trois photos et leurs rôles ; modèle du scanner ; rien dans la cave ; **cache** : mêmes photos sans nouvel appel ni quota ; quota quotidien ; photo d'un autre refusée ; assistant non configuré → saisie à la main ; suppression à échéance avec les photos) ; `tests/sql/scanner` (analyses d'un autre invisibles et non modifiables, lecture de Lia non modifiable par l'application, photo d'un autre refusée, prix confirmé sans prix refusé, conservation, cache et quota inaccessibles) ; e2e `scanner` (trois photos dont une en double refusée, choix entre deux cuvées, reflet signalé, prix lu puis corrigé, rien dans la cave, historique, envie, ajout à la cave pré-rempli, suppression de l'historique) |

| Bienvenue, visite guidée, aide intégrée | e2e `visite-aide-invitations` (bienvenue d'un nouveau compte ; visite : suivant, précédent, clavier, progression « Étape X sur N », chaque étape sur sa page, interruption puis **reprise**, fin, plus jamais imposée ; astuce de première visite rangée puis réaffichée ; aide « ? » de la page : recherche, accès direct « Ajouter une bouteille » ; Réglages : revoir la visite, Échap = Passer) ; e2e `desktop` (sur ordinateur, la carte se place près de l'élément éclairé sans le cacher ; aide de l'accueil) ; `tests/sql/accueil-invitations` (préférences fusionnées sans écraser, seulement les siennes, taille bornée, refusées sans compte) ; `tests/help` (chaque question trouve sa fiche, liens internes seulement, fiches réservées selon les droits) |
| Lia comme guide de l'application | `tests/ai/assistant` (réponse d'après les fiches d'aide avec accès direct ; fonction réservée : « non disponible » avec la raison, accès refusé, identifiant piège refusé ; fonction inexistante annoncée comme telle ; page d'origine transmise, page inconnue ignorée) ; e2e (rubrique « Aide avec Cave & Amis » ; question libre → étapes de la fiche + bouton « Ouvrir les invitations » ; administration demandée par une personne qui n'est pas administratrice → refus, aucun bouton) |
| Invitations de découverte et accès contrôlé | `tests/sql/accueil-invitations` (sélection : vues, photos, compteurs, aperçu identique ; Restreint ; date de fin : plus rien après échéance, réouverture permanente ; réglages par le seul propriétaire ; lien « voir ma cave » avec sélection, Restreint et date de fin ; un accès déjà ouvert jamais restreint par un nouveau lien ; code lisible par son auteur seul ; qui a utilisé mes liens, nom masqué si bloqué ; anciens appels compatibles ; lien révoqué, expiré, ou dont l'accès a pris fin : refusé ; **retour arrière** puis base fonctionnelle sans accès élargi ; membre retiré d'un groupe : plus de bouteilles ni de photos) ; `tests/invitations` (QR code valide : repères, synchronisation ; messages WhatsApp / SMS / e-mail avec le lien ; état des liens ; date de fin au soir) ; e2e (QR code, WhatsApp, SMS, e-mail ; Mes invitations : partager à nouveau, révoquer ; lien révoqué ; lien « voir ma cave » limité à une bouteille : page du lien sans rien de privé → présentation → inscription → acceptation → seule la bouteille choisie est visible ; « Gérer l'accès » ; lien de groupe accepté par une personne déjà inscrite ; visiteur sans compte) |

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
- Le **premier compte créé** devient administrateur : créez le vôtre dès la mise en ligne, avant de diffuser l'adresse.
- Une demande à l'assistant est limitée à environ 140 secondes (limite d'exécution des fonctions Supabase) : au-delà,
  l'assistant s'arrête proprement avec ce qu'il a déjà trouvé.
