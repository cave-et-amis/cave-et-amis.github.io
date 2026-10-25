# Amis, groupes et caves partagées — proposition à valider

> Statut : **proposition**, rien n'est développé. Rédigée le 25 octobre 2026 à partir du code actuel de Cave & Amis.
> Mise à jour après tes choix : **vin seulement**, **pas de propriété collective** (une cave = un propriétaire, qui peut associer d'autres personnes, chacune avec son compte), **le propriétaire confirme** chaque ouverture, **« tous mes amis » est gardé** à côté des groupes.

## 1. Ce qui existe déjà (et sera réutilisé)

| Brique actuelle | Ce qu'elle fait | Réutilisation prévue |
| --- | --- | --- |
| `friendships`, `friend_invites` | Amitié réciproque, invitation par **lien ou code** (haché, 14 jours, usage unique), suppression d'un ami | Gardées telles quelles ; on **ajoute** la recherche et les demandes |
| `lots` : `quantity`, `reserved`, contrainte `reserved ≤ quantity` | Stock physique et bouteilles réservées, **sans stock négatif ni double réservation**, même en cas d'actions simultanées | **Cœur du partage** : une mise à disposition pour un groupe sera une réservation comme celle d'un événement |
| Visibilité par lot (`private`, `friends`, `event`) + masques prix / quantité / notes | Partage sélectif avec **tous** les amis | Gardée ; les groupes ajoutent des audiences plus fines |
| `events`, `event_wines` (proposé → confirmé = réservé → consommé une seule fois) | Dîners, dégustations, ordre de service, souvenirs | **Soirées de groupe** = événements rattachés à un groupe |
| `movements` (+ clés d'idempotence, annulation unique) | Historique de chaque entrée / sortie | **Historique des caves partagées** (on y ajoute le groupe et la personne) |
| `tastings` (notes, partage avec un événement), `wishlist` | Carnet et envies personnels | Notes partagées avec un groupe, **liste d'envies commune** |
| Lia : outils de lecture avec les droits de la personne, propositions à confirmer | Assistant sommelier | Nouveaux outils « cave du groupe », « goûts du groupe » |
| RLS sur toutes les tables, fonctions transactionnelles | Sécurité dans la base | Même modèle pour toutes les nouvelles tables |

**Ce qui manque aujourd'hui** : recherche d'utilisateurs, demandes d'ami, blocage, notifications, groupes, rôles, mise à disposition pour un groupe, caves gérées à plusieurs.

## 2. Partage et propriété (règle centrale)

**Une bouteille a toujours un seul propriétaire.** Le groupe ne possède rien : il voit ou utilise des bouteilles qui restent à leurs propriétaires.

| Niveau | Ce que voit le groupe | Stock du propriétaire |
| --- | --- | --- |
| **Visible** | La bouteille apparaît dans la cave du groupe, avec les masques choisis | Inchangé (rien n'est bloqué) |
| **Mise à disposition** (N bouteilles) | « 2 bouteilles de Bruno disponibles pour le groupe » | N bouteilles **réservées** : plus utilisables ailleurs ; le propriétaire peut les reprendre |

**Cave gérée à plusieurs (ex. un couple)** : le propriétaire d'une cave peut y **associer** d'autres personnes, chacune avec son propre compte. Elles voient la cave comme la leur et peuvent ajouter, boire, corriger et ranger des bouteilles ; chaque action est enregistrée à leur nom. Le propriétaire reste unique : lui seul peut supprimer la cave ou retirer une personne associée.

### L'exemple demandé
Bruno a 6 bouteilles et en met 2 à disposition du groupe « Les soirées entre amis » :

- **Sa cave** : 6 possédées · dont 2 mises à disposition (Les soirées entre amis) · **4 librement disponibles**.
- **Cave du groupe** : 2 bouteilles de Bruno, mises à disposition.

### Pourquoi ça ne peut pas être compté deux fois
- La base garde **un seul compteur** de bouteilles bloquées par lot : `réservé = réservations d'événements + mises à disposition`. La contrainte existante `réservé ≤ stock` interdit donc, au niveau de la base :
  - de mettre plus de bouteilles à disposition que celles qui restent libres ;
  - de mettre les mêmes bouteilles à disposition de **deux groupes** à la fois ;
  - de les réserver en plus pour un dîner ou de les boire seul.
- Le détail (quel groupe, quel événement) est rangé dans une table à part, rapprochée automatiquement du compteur.
- **Être visible dans plusieurs groupes** est autorisé sans limite, puisque rien n'est bloqué.
- **Boire une bouteille mise à disposition** passe par une seule fonction : elle retire la mise à disposition et sort la bouteille du stock en une opération, avec une clé anti-double-clic, et écrit l'historique (qui, quand, quel groupe, quelle soirée).
- **Cave gérée à plusieurs** : il n'y a qu'un seul stock, celui de la cave. Les personnes associées agissent sur ce même stock, par les mêmes fonctions protégées : aucune copie, aucun double comptage possible.

## 3. Modèle de données proposé (compatible avec l'existant)

Ajouts, sans casser les tables actuelles :

- `profiles` : `discoverable` (apparaître dans la recherche, **désactivé par défaut**), `avatar`, `bio` courte.
- `friend_requests` (de, à, statut, date) : demandes envoyées depuis la recherche ; les liens d'invitation restent.
- `blocks` (qui bloque, qui) : un utilisateur bloqué ne vous trouve plus, ne peut plus vous inviter, et l'amitié est supprimée.
- `notifications` (destinataire, type, lien, lue) : centre de notifications dans l'appli (cloche + pastille).
- `groups` (nom, emoji ou photo, description, créateur) et `group_members` (rôle `admin` / `gestionnaire` / `membre`, statut `invité` / `actif`).
- `group_shares` (lot, groupe, niveau `visible` ou `disponible`, quantité) : le détail des mises à disposition.
- `cellar_members` (cave, personne, ajoutée par, date) : les personnes associées à une cave. Elles passent les mêmes contrôles que le propriétaire pour cette cave seulement ; leurs autres caves et celles du propriétaire restent séparées.
- `movements` : ajout de `group_id` et `done_by` (qui a fait l'action, utile dans une cave partagée).
- `events.group_id` : soirée d'un groupe ; `tastings.share_with_group` ; `group_wishlist` (envies communes, avec « qui l'a proposée »).

### Droits (appliqués dans la base, comme aujourd'hui)
| Action | Membre | Gestionnaire | Administrateur |
| --- | --- | --- | --- |
| Voir la cave du groupe, les membres, l'historique | ✅ | ✅ | ✅ |
| Partager / mettre à disposition **ses** bouteilles, les reprendre | ✅ | ✅ | ✅ |
| Boire une bouteille mise à disposition (lors d'une soirée du groupe) | ✅ avec accord du propriétaire, comme aujourd'hui pour les événements | ✅ | ✅ |
| Inviter, retirer des membres | ❌ | ✅ (membres) | ✅ |
| Rôles, nom, photo, suppression du groupe | ❌ | ❌ | ✅ |

- **Personne ne modifie jamais la cave personnelle d'un autre.** Les bouteilles d'un membre restent les siennes ; le groupe ne fait que les voir ou les utiliser via une soirée confirmée.
- **Quitter un groupe** : ses mises à disposition sont automatiquement rendues, et il garde toutes ses bouteilles.
- **Dernier administrateur** : il doit nommer un successeur avant de partir ; un groupe sans membre est supprimé (aucune bouteille n'est perdue, elles n'appartiennent qu'à leurs propriétaires).
- **Cave gérée à plusieurs** : une personne associée peut se retirer à tout moment ; le propriétaire peut la retirer. Elle n'emporte rien : les bouteilles sont celles de la cave.
- **Suppression de compte** : même règle que pour un départ. L'historique du groupe garde « ancien membre ».

## 4. Organisation de l'écran « Amis & Groupes »

Un onglet **Amis & Groupes** remplace « Amis » dans la barre du bas, avec 3 sous-onglets :

1. **Amis** : barre de recherche, liste des amis (photo, nom, nombre de bouteilles partagées), et sur chaque ami « Voir sa cave », « Inviter dans un groupe », « Retirer », « Bloquer ».
2. **Groupes** : cartes des groupes (emoji, nom, membres, bouteilles disponibles), « + Créer un groupe ».
3. **Invitations** : reçues (Accepter / Refuser) et envoyées (Annuler), pour les amis comme pour les groupes.

**Page d'un groupe**, avec les onglets **Cave · Membres · Soirées · Envies · Activité** :
- **Cave** : filtres par couleur / type de vin, producteur, millésime, propriétaire, disponibilité, et pastille « visible / disponible » sur chaque bouteille.
- **Activité** : historique (« Claire a mis 2 Morgon à disposition », « Sam a ouvert 1 Sancerre lors de la soirée du 12/11 »).

**Fiche d'un vin de ma cave** : nouvelle section **Partage** (« Visible : Famille · Disponible : 2 pour Les soirées entre amis · Libre : 4 »), avec « Mettre à disposition d'un groupe ».

**Cloche de notifications** dans l'en-tête : demandes d'ami, invitations de groupe, bouteille demandée pour une soirée, soirée confirmée.

## 5. Parcours utilisateurs

1. **Devenir visible** : Réglages › Confidentialité › « Apparaître dans la recherche » (désactivé par défaut).
2. **Ajouter un ami** :
   - Amis › rechercher « Claire » (3 lettres minimum, 10 résultats au plus, uniquement les personnes visibles et non bloquées) › « Demander en ami » ;
   - Claire reçoit une notification et choisit Accepter ou Refuser ;
   - l'invitation par lien ou code reste possible pour les personnes non visibles.
3. **Créer un groupe** : Groupes › « Créer » › nom, emoji ou photo, description › inviter des amis (cases à cocher) › les invités acceptent depuis leurs invitations.
4. **Inviter dans ma cave** : sur la fiche d'un ami, « Inviter dans un groupe » propose la liste de mes groupes, ou « Créer un groupe avec Claire ».
5. **Mettre à disposition** : fiche du vin › Partage › « Mettre à disposition » › groupe › quantité (au plus le nombre libre) › confirmation. L'écran affiche aussitôt « 6 · dont 2 pour le groupe · 4 libres ».
6. **Préparer une soirée de groupe** : groupe › Soirées › « Nouvelle soirée » › date, invités (membres) › « Choisir les bouteilles » parmi celles disponibles dans le groupe.
   - Si le propriétaire est présent, la bouteille est réservée pour la soirée, prise sur sa mise à disposition.
   - Lia peut proposer une sélection selon le menu et les goûts des membres.
7. **Après la soirée** : chaque propriétaire confirme les bouteilles ouvertes (une seule fois, comme aujourd'hui), les participants notent le vin, et l'activité du groupe l'enregistre.
8. **Associer quelqu'un à sa cave** (ex. un couple) : Réglages › Mes caves › « Ma cave » › « Associer une personne » › choisir un ami (il doit avoir un compte) › il accepte › la cave apparaît chez lui, marquée « Cave de Bruno, gérée à deux ».
9. **Quitter un groupe** : groupe › Membres › « Quitter » › récapitulatif (« vos 2 bouteilles mises à disposition vous sont rendues ») › confirmation.
10. **Bloquer** : fiche d'un ami ou résultat de recherche › « Bloquer » › l'amitié est supprimée, et la personne ne peut plus vous trouver ni vous inviter.

## 6. Fonctions complémentaires étudiées

| Idée | Faisabilité | Recommandation |
| --- | --- | --- |
| Suggestions de Lia selon les goûts du groupe | ✅ Lia lit déjà les carnets ; il suffit d'ajouter les notes partagées avec le groupe | Phase E ; coût Claude de quelques centimes par suggestion |
| Organisation de dégustations | ✅ Événements existants + `group_id` | Phase E, forte réutilisation |
| Historique des consommations (date, participants) | ✅ `movements` + participants de l'événement | Phase C |
| Avis et notes des membres | ✅ `tastings` partagées avec le groupe, moyenne affichée | Phase E |
| Liste d'envies commune | ✅ Nouvelle table simple, avec « je participe » | Phase E |
| Achats groupés (marketplace) | ⏳ La marketplace n'existe pas encore | Préparer seulement : une envie commune pourra devenir un « achat groupé » |

## 7. Améliorations que je recommande en plus

1. **Notifications** : dans l'appli d'abord, ce qui est gratuit et immédiat. Les notifications sur le téléphone (Web Push) restent possibles gratuitement plus tard, comme dans Cocon.
2. **Confidentialité par défaut** : invisible dans la recherche, lots privés, prix masqué. On ne partage que ce qu'on choisit.
3. **Pas de recherche par e-mail** : elle permettrait de savoir si quelqu'un est inscrit. La recherche se fait par nom (personnes visibles) ou par code ami.
4. **Garde-fou anti-abus** : 20 demandes d'ami par jour au plus, et une demande refusée ne peut pas être renvoyée avant 30 jours.
5. **Rafraîchissement en direct** : Supabase Realtime (inclus dans l'offre gratuite) pour la cloche et la cave du groupe pendant une soirée, à la place de l'actualisation toutes les 2 minutes.
6. **Tests** : chaque règle de stock (double mise à disposition, départ du groupe, consommation unique, don) aura son test en base, comme aujourd'hui.

## 8. Découpage proposé

| Phase | Contenu | Taille |
| --- | --- | --- |
| **A. Fondations sociales** | Visibilité, recherche, demandes d'ami, blocage, notifications dans l'appli, nouvel onglet « Amis & Groupes » | Moyenne |
| **B. Groupes** | Création, photo / emoji, rôles, invitations, page de groupe, partage « visible » par groupe | Moyenne |
| **C. Mise à disposition** | Quantités réservées au groupe, compteurs « possédées / disponibles pour X / libres », consommation, historique | Moyenne (règles de stock sensibles) |
| **D. Caves gérées à plusieurs** | Associer une personne à sa cave (couple…), actions à son nom, retrait | Petite à moyenne |
| **E. Vie de groupe** | Soirées de groupe, notes partagées, envies communes, suggestions de Lia | Moyenne |

Chaque phase est livrée testée et en ligne avant la suivante. Coût d'hébergement : **0 €**, tout tient dans l'offre gratuite de Supabase et GitHub Pages. Seules les suggestions de Lia consomment ta clé Claude.

## 9. Décisions prises (25 octobre 2026)

1. **Vin seulement** : pas de spiritueux.
2. **Pas de propriété collective** : une bouteille et une cave ont un seul propriétaire ; on peut associer d'autres personnes à sa cave (chacune avec son compte).
3. **Le propriétaire confirme** l'ouverture d'une bouteille mise à disposition, comme pour les événements actuels.
4. **« Tous mes amis » est gardé**, les groupes s'y ajoutent.
