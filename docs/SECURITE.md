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
| Conversations avec l'assistant | oui | non | non | non | **non, ni l'administrateur dans l'application** (l'exploitant du projet Supabase y a techniquement accès ; Anthropic reçoit ce qu'il faut pour chaque réponse) |

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
  ni invitation n'est possible entre les deux personnes (dans un sens comme dans l'autre). Le blocage n'est jamais révélé :
  la règle qui le vérifie n'est appelable que par les fonctions du serveur, pas par les comptes.
- **Liens d'invitation** : rejoindre un groupe ou un événement demande toujours un clic sur « Accepter ». La seule
  exception est le parcours choisi sur la vitrine du lien, sur le même appareil (« Créer mon compte »), jamais une adresse.
- **Mots de passe** : 8 caractères au minimum, avec au moins une lettre et un chiffre. L'actuel est redemandé pour en
  changer, et le mot de passe est vérifié par le serveur avant toute suppression de compte. Une session restée ouverte sur
  un appareil ne suffit donc ni pour l'un ni pour l'autre.
- **Suppression du compte** : tout ou rien, en une seule opération dans la base. Si une étape échoue, rien n'est
  effacé. Les notes qu'un invité avait partagées avec un de ses événements restent à cet invité, en privé.
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

## Documents légaux, preuves et vos données

Modèle commun avec Cocon (mêmes tables et mêmes fonctions), migration `20261101000001_documents_legaux`.

- **Documents** (`legal_documents`) : conditions d'utilisation, politique de confidentialité, mentions légales, cookies.
  Publiés par l'administrateur seulement (`admin_legal_publish`), jamais modifiés ni supprimés ensuite (déclencheur) ;
  numéro de version et empreinte SHA-256 du texte calculés par la base. Un texte qui contient encore « [À COMPLÉTER » ou
  « [À VALIDER » est refusé. Les premières conditions d'utilisation demandent toujours une acceptation de tous ; seules les
  conditions peuvent en demander une. Dès que l'administrateur a activé une double authentification, la publication exige
  une session vérifiée par le code (niveau aal2). Les projets sont dans `docs/legal/` (à compléter et à faire valider).
- **Preuves et consentements** (`legal_acceptances`, `user_consents`) : ajout seul, aucune adresse IP ni information sur
  l'appareil. Pas de clé étrangère vers le compte : à sa suppression, un déclencheur note la date (`account_deleted_at`) et
  les lignes sont effacées 5 ans plus tard ; seule la purge peut les effacer. Aucun accès direct aux tables : tout passe par
  les fonctions communes (`legal_current`, lisible sans compte ; `legal_pending`, `legal_accept`, `consent_set`,
  `my_legal_history`, `admin_legal_stats`, sans nom).
- **Inscription** : case jamais cochée d'avance (« J'ai 18 ans ou plus et j'accepte les conditions d'utilisation ») ; les
  versions des conditions et de la politique présentées passent dans les métadonnées de l'inscription et sont notées par le
  déclencheur de création du profil.
- **Comptes existants** : fenêtre à la connexion tant que les conditions ne sont pas acceptées. Refuser ne supprime rien :
  l'application reste fermée, sauf télécharger ses données, supprimer son compte ou se déconnecter, et la fenêtre revient à
  la connexion suivante (le silence ne vaut pas acceptation). Ce blocage est fait par l'application : les règles d'accès aux
  données, elles, ne changent pas. Une nouvelle politique, ou une nouvelle version mineure des conditions, s'affiche en
  simple bandeau (« J'ai lu » = prise de connaissance, jamais un consentement).
- **Consentements de Cave** : « apparaître dans la recherche d'amis » (chaque changement de `profiles.discoverable` est
  noté) et « agenda Nous » (la liaison et la déliaison sont notées, sauf pendant la suppression du compte).
- **Export complet** (`export_my_data`) : tout ce que la base garde sur la personne ; pour les autres, seulement ce que
  l'application lui montre déjà (prénom, rôle, réponse). Jamais de secret : ni code ou empreinte d'invitation, ni clé ou
  adresse de notification (seulement le nom du service), ni mot de passe. Les photos de son dossier sont ajoutées par
  l'application, dans une archive ZIP calculée sur l'appareil.
- **Lia et Anthropic** : à la première utilisation de l'assistant, du scanner ou de la lecture d'étiquette, un encadré
  explique ce qui est transmis à Anthropic (une fois par compte).
- **Déconnexion** : en plus de la session, le code d'invitation en attente, les préférences de confort (budget du scanner,
  état des propositions de Lia) et le brouillon du scanner sont effacés de l'appareil.

## Sauvegardes

- Chaque mois et avant chaque mise à jour importante, depuis le PC du responsable : `scripts/sauvegarde.ps1` (voir
  INSTALLATION.md). Lecture par l'outil officiel de Supabase, connecté dans le navigateur : aucun mot de passe de la base.
- Chiffrées par un mot de passe que seul le responsable connaît (AES-256 puis HMAC-SHA256, clés PBKDF2-SHA256 à 600 000
  tours, sel et vecteur aléatoires) ; jamais écrites en clair sur le disque ; relues et vérifiées aussitôt.
- Contenu : tables de l'application, comptes (avec le mot de passe haché) et liste des photos, sans leurs fichiers.

## Durées de conservation

Validées le 26/10/2026, appliquées par la fonction `retention_purge` (chaque nuit) et par cave-api, appelée par deux tâches
planifiées (`supabase/sql/conservation.sql`, à poser après accord : chaque purge est définitive).

| Données | Durée |
| --- | --- |
| Compte, caves, carnet, contacts, groupes, événements | tant que le compte existe |
| Conversations avec Lia | 12 mois après le dernier message |
| Journaux d'usage de l'IA / erreurs techniques | 13 mois / 3 mois |
| Relevés de prix | 24 mois |
| Liens d'invitation expirés ou révoqués | 90 jours (code et note « Pour qui ? » partent avec la ligne) |
| Demandes de contact ou d'accès refusées | 6 mois |
| Analyses du scanner (avec leurs photos) et visites vides | 30 jours (réglage `scan_retention_days`), purgées chaque nuit même si la personne ne revient pas |
| Appareils de notification en échec | 90 jours sans succès |
| Photos qui ne servent plus | chaque mois : fichiers de plus de 30 jours qu'aucune fiche, dégustation, groupe, vin d'événement ou analyse ne cite, supprimés par le stockage (jamais par SQL) |
| Preuves d'acceptation et consentements | durée du compte, puis 5 ans |
| Comptes inactifs | rien d'automatique pour l'instant |

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
- **Données des autres** : leur prénom et des informations simples (vin, millésime, couleur, note sur 5, quantité visible,
  statut, réponse) ; jamais leurs textes (notes, commentaires, plat, note d'une envie ou d'un vin proposé), ni e-mail ni
  identifiant de compte ; le lieu, le budget et la description d'un événement seulement pour son organisateur. Exception : une
  cave gérée à plusieurs est lue comme la sienne (fiches, notes et prix compris).
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

## Le scanner avant d'acheter

- Les analyses (table `scans`) sont **privées** (RLS : leur auteur seulement). Les photos restent dans le dossier privé de la
  personne ; la lecture de Lia (`result`) n'est écrite que par le serveur ; la personne ne peut modifier que la fiche vérifiée,
  le prix confirmé et le magasin. Une analyse n'ajoute **jamais** de bouteille au stock.
- Conservation : `scan_retention_days` (30 jours par défaut), puis suppression des analyses **et de leurs photos** (par le
  serveur à chaque nouvelle analyse, et par l'application à l'ouverture de l'historique). Suppression manuelle à tout moment.
- **Cache** (`scan_cache`, inaccessible depuis l'application) : une série de photos identique octet pour octet n'est pas
  renvoyée à l'IA (lecture reprise pendant 90 jours, sans coût ni quota). Il ne contient que la lecture des étiquettes.
- Coûts : modèle propre au scanner (`scan_model`, Sonnet 5.5 par défaut), **nombre d'analyses par jour et par personne**
  (`scan_daily_limit`, 10 par défaut) en plus des quotas et budgets de l'assistant ; photos réduites sur le téléphone
  (1 600 px) et taille maximale contrôlée par le serveur. Open Food Facts (code-barres) est gratuit et sans clé.

### Analyse et prix du marché (lot 3b)

- Deux recherches web distinctes, lancées après la confirmation de la bouteille : l'analyse du vin (`scan_quality`) et les
  offres du marché (`scan_price`). Chacune réserve son enveloppe comme les autres demandes ; le nombre d'analyses par jour
  reste compté sur les identifications (des bouteilles, pas des étapes).
- **Rien n'est inventé** : un lien n'est retenu que s'il figure parmi les pages réellement renvoyées par la recherche ; un avis
  ou une note sans lien vérifiable est écarté ; une note de consommateurs exige l'échelle et le nombre d'avis ; le niveau de
  qualité estimé par Lia n'est retenu que s'il s'appuie sur au moins une source ; une offre n'est retenue que pour le même
  millésime et la même contenance, et jamais hors taxes. **Vivino est exclu** de la recherche (`blocked_domains`).
- Le verdict et la note sur 10 sont **calculés par l'application** (`src/domain/scan.ts`), jamais rédigés par l'IA.
- Cache du serveur, séparé de l'historique : analyse d'un vin 90 jours, relevé de prix 72 heures (seulement s'il est vérifié).
  L'historique garde le relevé daté ; l'application propose de l'actualiser au-delà de 72 heures.

### Vos goûts et votre budget (lot 3c)

- L'adéquation à vos goûts est calculée **dans l'application** (`src/domain/taste.ts`) à partir de vos seules données, déjà
  chargées avec vos droits : vos lots, vos dégustations, vos envies, vos favoris. Les dégustations et caves des autres
  personnes ne sont jamais prises en compte, et rien de tout cela n'est envoyé à l'IA.
- Le budget est enregistré **sur l'analyse** (privée, RLS), et non dans les préférences du profil, que vos contacts peuvent
  lire. Un budget habituel est seulement gardé sur l'appareil (stockage local du navigateur).

### Comparer plusieurs bouteilles (lot 3d)

- Les visites en magasin (`scan_visits`) sont privées (RLS) ; la base refuse de rattacher une analyse à la visite d'une autre
  personne, et le serveur vérifie la visite avec les droits de la personne avant d'y ajouter une identification.
- Pour une question sur une comparaison, le serveur relit la visite **avec les droits de la personne** et transmet à Lia les
  bouteilles, leur verdict et leur note calculés par l'application ; une visite d'une autre personne ne transmet rien.
- Fréquence par minute : l'analyse et le prix d'une bouteille, lancés automatiquement après sa confirmation, n'y sont pas
  comptés (sinon deux bouteilles d'affilée bloqueraient Lia) ; le nombre de bouteilles par jour, les demandes par jour et
  les budgets s'appliquent toujours.

### Finitions (lot 3e)

- Photos en attente d'envoi : gardées **sur l'appareil seulement** (IndexedDB), pour la personne connectée, 3 jours au plus,
  effacées après l'envoi ; un brouillon d'un autre compte sur le même appareil est effacé sans être montré.
- Partage : un texte seulement, sans lien vers l'analyse, sans goûts, cave ni budget.
- Lecteur de codes-barres zxing-wasm (MIT, gratuit) : servi par le site lui-même, téléchargé seulement si le navigateur n'a
  pas de lecteur intégré ; aucune image n'est envoyée ailleurs.
- « Ajouter à ma cave » copie la photo d'étiquette dans le dossier privé de la personne ; annuler le formulaire la supprime.

## Notifications push

- **Standard Web Push**, celui de la bibliothèque PHP minishlink/web-push, écrit dans la fonction serveur (TypeScript,
  WebCrypto, sans dépendance ni service payant). Le serveur s'identifie par ses **clés VAPID** (RFC 8292) : créées par
  cave-api au premier besoin, gardées dans une table lisible par la clé secrète du serveur seule ; la clé privée ne sort
  jamais du serveur et n'est jamais affichée.
- **Contenu chiffré pour chaque appareil** (RFC 8291) : Apple, Google, Mozilla ou Microsoft transmettent le message sans
  pouvoir le lire. Il ne contient que le texte de la notification (« Claire souhaite être en contact avec vous ») et
  l'écran à ouvrir : ni bouteille, ni prix, ni note.
- **Abonnements** enregistrés par cave-api après vérification : seulement les services de notifications connus (Apple,
  Google, Mozilla, Microsoft ; https, sans port ni identifiant), et des clés valables. Le serveur n'appelle donc jamais une
  adresse quelconque. 10 appareils au plus par personne ; chacun ne voit et ne retire que les siens ; un appareil passé à
  un autre compte change de propriétaire ; la déconnexion le retire ; un abonnement expiré est supprimé.
- **Envoi** : chaque notification de l'application est mise en file pour les appareils de sa destinataire (aucune entre
  deux personnes qui se sont bloquées, comme pour la cloche). cave-api la traite, appelée par la base dès la mise en file
  (pg_net) puis chaque minute pour les nouvelles tentatives (pg_cron), avec le jeton des tâches planifiées. Une
  notification déjà lue dans l'application, ou vieille d'un jour, n'est plus envoyée ; 5 essais au plus. L'appel
  immédiat ne peut jamais empêcher la notification elle-même : en cas d'échec, la tâche planifiée prend le relais. Il
  utilise le jeton des tâches planifiées de l'intégration Nous : si celle-ci est retirée, les notifications push ne
  partent plus, sans gêner le reste de l'application.

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
