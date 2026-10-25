# Sécurité, droits et maîtrise des coûts

## Qui voit quoi

| Donnée | Propriétaire | Personne à qui j'ai **ouvert ma cave** | Simple contact | Participants d'un événement | Autres comptes |
| --- | --- | --- | --- | --- | --- |
| Caves, emplacements, mouvements de stock | oui | non | non | non | non |
| Lot **privé** (défaut) | oui | non (sauf exception « montrer » pour elle) | non | non | non |
| Lot **partagé avec mes amis** | oui | vin, millésime, conseils ; prix, quantité exacte et notes **seulement si non masqués** (et jamais au niveau « Restreint ») ; sauf exception « masquer » pour elle | non | — | non |
| Lot **proposable pour un événement** | oui | idem, et peut le **suggérer** (le propriétaire confirme) | non | idem si la cave est ouverte au participant | non |
| Vins proposés pour un événement | oui | — | — | photographie du vin (nom, millésime, couleur, propriétaire, quantité prévue) | non |
| Photos | oui | si elles illustrent un lot qu'elle voit | non | si elles illustrent un vin de l'événement ou une note partagée | non |
| Dégustations | oui | non | non | seulement si partagées avec l'événement | non |
| Prix de marché, relevés, liste d'envies | oui | non | non | non | non |
| Conversations avec l'assistant | oui | non | non | non | **non, y compris l'administrateur** |

- Tout est appliqué **dans la base** (RLS sur toutes les tables, fonctions `security definer` contrôlées, politiques du stockage).
  Le navigateur ne peut pas contourner ces règles ; l'assistant non plus : il lit avec le jeton de la personne.
- **Relation et accès à la cave sont séparés.** La relation (`friendships`, symétrique) permet seulement de s'inviter à un
  groupe, un événement ou une cave gérée à plusieurs. L'accès à une cave (`cellar_access`, **à sens unique**) n'est écrit que
  par son propriétaire, par des fonctions contrôlées (ouvrir, fermer, « fermer à tout le monde », niveau de détail,
  exceptions) ; chacun ne lit que ses propres réglages. Une seule règle (`can_see_cellar` / `can_see_lot`) décide de ce qu'une
  personne voit : vues des caves, suggestions pour un événement, photos, compteurs et assistant. L'aperçu « Ce que X voit de
  moi » (`preview_my_cellar_as`) passe par la **même** fonction que la vue servie à X : aperçu et réalité ne peuvent pas
  diverger. Les règles internes, qui prennent une personne en paramètre, ne sont pas appelables par les utilisateurs.
- Les amitiés antérieures ont reçu l'accès dans les deux sens lors de la mise à jour : rien n'a changé pour elles.
- Un **groupe** ne montre à ses membres que les bouteilles partagées ou mises à disposition dans ce groupe (jamais le reste de
  la cave) ; un **événement** ne montre que ses vins proposés. Les exceptions et le niveau « Restreint » ne concernent que la
  cave : un partage explicite dans un groupe garde ses propres masques.
- **Fermer sa cave** à quelqu'un retire l'accès aussitôt, sans toucher à la relation, aux groupes ni aux événements ;
  **Retirer de mes amis** ferme les deux caves ; **Supprimer le contact** retire aussi la relation. Les souvenirs d'événements
  gardent les vins dégustés, sans donner accès au stock ni aux informations privées.
- **Bloquer** supprime la relation, les accès dans les deux sens, les exceptions et les demandes ; plus aucun lien, demande
  ni invitation n'est possible entre les deux personnes (dans un sens comme dans l'autre).
- **Demandes d'accès** : une seule en attente par personne, pas de nouvelle demande pendant 30 jours après un refus,
  20 demandes par jour au plus.
- **Cave gérée à plusieurs** : une personne associée (invitation acceptée, avec son propre compte) voit et gère les bouteilles,
  emplacements, fiches et prix de **cette cave seulement**, jamais les autres caves du propriétaire. Le partage, les groupes,
  les événements et toute suppression restent au propriétaire ; chaque mouvement garde son auteur. Un retrait, un départ ou
  un blocage coupe l'accès immédiatement.
- **Vie de groupe** : une soirée de groupe n'est visible que de ses participants ; les notes partagées avec un groupe, ses
  envies communes et leurs participants ne sont lisibles que par ses membres (lecture par des fonctions qui le vérifient).
  Quitter un groupe retire le partage de ses notes et ses « je participe ».
- Il n'existe aucune « cave publique » : aucune donnée n'est lisible sans compte, à l'exception de la page d'un lien
  d'invitation valide : le **prénom** de la personne qui invite, le type de lien (et, pour un lien « voir ma cave », s'il se
  limite à une sélection — jamais laquelle) et, pour un groupe son nom, pour un événement son **titre et sa date** (jamais
  l'adresse, les invités ni les bouteilles). Codes de 10 caractères tirés au hasard (31 signes, environ 8 × 10¹⁴ possibilités),
  vérifiés par leur empreinte ; depuis la mise à jour « accueil et invitations », le code d'un nouveau lien est aussi gardé
  pour que **son auteur seul** puisse le réafficher et le repartager (« Mes invitations ») — la personne invitée et les autres
  comptes ne le lisent jamais ; 20 liens actifs par personne ; « découvrir » : 10 utilisations, 30 jours ; « voir ma cave » :
  usage unique, 14 jours ; groupe et événement : 20 utilisations, 14 jours ou jusqu'à l'événement, 50 membres au plus par
  groupe ; un même compte ne compte qu'une fois ; révocables.
- **Accès limité** (lien « voir ma cave » ou fiche de la personne) : toujours en lecture seule. « Une sélection » ne montre que
  les bouteilles ajoutées pour cette personne ; une **date de fin** ferme l'accès d'elle-même (la règle de la base compare à
  l'heure du serveur : aucune tâche planifiée n'est nécessaire). Un nouveau lien ne restreint jamais un accès déjà ouvert ;
  seule la personne qui ouvre sa cave règle ces limites.
- **Partage d'un lien** : le QR code est calculé dans le navigateur (bibliothèque libre intégrée au site, aucun service
  extérieur ne reçoit le lien) ; WhatsApp, SMS et e-mail ouvrent l'application de la personne avec un message prêt : rien
  n'est envoyé par Cave & Amis.
- **Préférences** (visite guidée, astuces) : chacun ne modifie que les siennes, par une fonction qui fusionne un petit objet
  (2 000 octets au plus) sans écraser les autres réglages.

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

- **Lire** : votre cave, votre carnet, les vins partagés dans les caves qui vous sont ouvertes (masques, exceptions et niveau
  de détail respectés ; rien d'un simple contact), les groupes et les événements auxquels vous participez — toujours avec vos
  droits. Seules les informations utiles sont envoyées au modèle.
- **Proposer** : une sortie de stock, un ajout à la liste d'envies, des conseils à enregistrer sur une fiche, une bouteille pour
  un événement, une note de dégustation, l'enregistrement d'un relevé de prix. Le serveur vérifie la proposition et rédige
  lui-même le libellé ; **rien n'est modifié** tant que vous n'avez pas appuyé sur « Confirmer ».
- **Prix** : uniquement par la recherche web d'Anthropic ; une offre n'est retenue que si son lien figure parmi les pages
  réellement renvoyées par la recherche, avec le bon millésime et la bonne contenance. Sinon : « prix non vérifié ».
- **Guider** : les questions sur l'application sont répondues d'après l'**aide intégrée** (fiches écrites à l'avance, les
  mêmes que l'aide « ? »), sans aucune donnée personnelle. Lia peut seulement proposer un bouton vers un écran prévu par une
  fiche ; le serveur refuse un écran inconnu ou une fonction que la personne n'a pas le droit d'utiliser (administration,
  gestion d'un groupe ou d'un événement dont elle n'est pas responsable), et l'application n'affiche ce bouton que pour une
  adresse de l'aide. Ouvrir un écran ne fait rien d'autre : les droits restent vérifiés par la base.
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
