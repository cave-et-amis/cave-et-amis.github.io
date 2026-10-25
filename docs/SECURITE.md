# Sécurité, droits et maîtrise des coûts

## Qui voit quoi

| Donnée | Propriétaire | Amis acceptés | Participants d'un événement | Autres comptes |
| --- | --- | --- | --- | --- |
| Caves, emplacements, mouvements de stock | oui | non | non | non |
| Lot **privé** (défaut) | oui | non | non | non |
| Lot **partagé avec mes amis** | oui | vin, millésime, conseils ; prix, quantité exacte et notes **seulement si non masqués** | — | non |
| Lot **proposable pour un événement** | oui | idem, et peut le **suggérer** (le propriétaire confirme) | idem si ami et participant | non |
| Vins proposés pour un événement | oui | — | photographie du vin (nom, millésime, couleur, propriétaire, quantité prévue) | non |
| Photos | oui | si elles illustrent un lot partagé | si elles illustrent un vin de l'événement ou une note partagée | non |
| Dégustations | oui | non | seulement si partagées avec l'événement | non |
| Prix de marché, relevés, liste d'envies | oui | non | non | non |
| Conversations avec l'assistant | oui | non | non | **non, y compris l'administrateur** |

- Tout est appliqué **dans la base** (RLS sur toutes les tables, fonctions `security definer` contrôlées, politiques du stockage).
  Le navigateur ne peut pas contourner ces règles ; l'assistant non plus : il lit avec le jeton de la personne.
- **Supprimer un ami** retire immédiatement l'accès, dans les deux sens. Les souvenirs d'événements gardent les vins dégustés,
  sans donner accès au stock ni aux informations privées.
- **Cave gérée à plusieurs** : une personne associée (invitation acceptée, avec son propre compte) voit et gère les bouteilles,
  emplacements, fiches et prix de **cette cave seulement**, jamais les autres caves du propriétaire. Le partage, les groupes,
  les événements et toute suppression restent au propriétaire ; chaque mouvement garde son auteur. Un retrait, un départ ou
  un blocage coupe l'accès immédiatement.
- Il n'existe aucune « cave publique » : aucune donnée n'est lisible sans compte, à l'exception de « X vous invite » pour un
  code d'invitation valide (code de 10 caractères, conservé haché, usage unique, 14 jours).

## Stocks et réservations

- Le stock et les réservations ne changent que par des fonctions transactionnelles ; deux contraintes de la base garantissent
  `stock ≥ 0` et `réservé ≤ stock`, même pour des demandes simultanées.
- Chaque saisie porte une **clé d'idempotence** : un double clic ou un nouvel envoi ne compte qu'une fois.
- Une bouteille réservée reste dans le stock physique ; après l'événement, son propriétaire indique combien ont été ouvertes :
  la sortie est enregistrée une seule fois.
- Une saisie erronée s'annule par un mouvement inverse (une seule fois), visible dans l'historique.

## La clé Anthropic

- Une seule clé, lue **uniquement** par la fonction serveur (`ANTHROPIC_API_KEY`, secret Supabase). Elle n'apparaît ni dans le
  code, ni dans le navigateur, ni dans les réponses, ni dans les journaux : les messages d'erreur sont nettoyés avant d'être
  enregistrés ; l'export du site est refusé s'il contient une clé (`scripts/check-dist.mjs`) ; le site refuse une clé
  Anthropic ou une clé secrète Supabase dans sa configuration.
- Tous les appels exigent une session valide. Les conversations sont propres à chaque personne.
- Le modèle et les paramètres de consommation ne sont modifiables que par l'administrateur (fonction réservée en base).

## Ce que l'assistant peut faire

- **Lire** : votre cave, votre carnet, les vins partagés par vos amis (masques respectés), les événements auxquels vous
  participez — toujours avec vos droits. Seules les informations utiles sont envoyées au modèle.
- **Proposer** : une sortie de stock, un ajout à la liste d'envies, des conseils à enregistrer sur une fiche, une bouteille pour
  un événement, une note de dégustation, l'enregistrement d'un relevé de prix. Le serveur vérifie la proposition et rédige
  lui-même le libellé ; **rien n'est modifié** tant que vous n'avez pas appuyé sur « Confirmer ».
- **Prix** : uniquement par la recherche web d'Anthropic ; une offre n'est retenue que si son lien figure parmi les pages
  réellement renvoyées par la recherche, avec le bon millésime et la bonne contenance. Sinon : « prix non vérifié ».
- Les étiquettes, notes, commentaires et pages web sont traités comme des **données**, jamais comme des instructions.

## Maîtrise des coûts

- **Avant chaque appel** à Claude, la fonction réserve dans la base une **enveloppe maximale** : jetons envoyés estimés
  largement (2 caractères par jeton, chaque image comptée au maximum), réponse au maximum autorisé (`max_output_tokens`,
  réflexion comprise), recherches web plafonnées (`max_uses`). La réservation est atomique : des demandes simultanées ne
  peuvent pas dépasser ensemble le budget. **Après l'appel**, l'enveloppe est remplacée par le coût réel calculé d'après
  l'usage renvoyé par l'API.
- Contrôles : assistant activé, personne non bloquée, fréquence (par minute), demandes simultanées, quota quotidien,
  budget mensuel par personne, budget mensuel global ; alerte à un seuil réglable ; blocage des nouveaux appels au-delà.
- Limites : longueur des messages, taille des photos, longueur des réponses, nombre d'appels et de recherches par demande.
- **Limite connue** : le volume des pages lues par la recherche web n'est pas bornable exactement ; une provision réglable par
  recherche est réservée (25 000 jetons par défaut). C'est une estimation prudente, **pas un plafond strict**. Pour un plafond
  absolu, fixez une limite de dépense dans la console Anthropic.
- Le coût affiché est une **estimation** (tarifs saisis par l'administrateur) ; la facture Anthropic fait foi.
- Une demande interrompue (serveur arrêté pendant un appel) est close au bout de 10 minutes en comptant toute son enveloppe.
- Aucune nouvelle tentative automatique d'un appel (elle pourrait être facturée deux fois pour une seule enveloppe) ; une durée
  maximale par demande (140 s, réglable par `AI_REQUEST_DEADLINE_MS`) reste sous la limite d'exécution des fonctions Supabase.
- Si le coût réel d'un appel ne peut pas être enregistré, l'enveloppe réservée est comptée comme dépensée.
- Le repli automatique vers un autre modèle en cas de refus (« fallbacks ») n'est **pas** activé : il rendrait le coût d'une
  demande impossible à borner à l'avance.
