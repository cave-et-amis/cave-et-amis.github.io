# Registre des traitements de Cave & Amis

Projet rédigé le 27/10/2026 à partir de ce que fait l'application : la politique de confidentialité (`docs/legal/confidentialite.md`), `docs/SECURITE.md` et les réponses de l'éditeur du 26/10/2026. Ce n'est pas un avis juridique, et ce document ne dit pas que l'application est conforme.

Chaque mention « [À VALIDER : …] » est un point juridique à faire vérifier par un juriste.

Ce fichier est public : il décrit l'application, jamais une personne. Il ne contient ni nom, ni adresse, ni clé.

[À VALIDER : obligation de tenir ce registre pour un éditeur particulier, non professionnel, avec 20 à 100 comptes, et contenu attendu (article 30 du RGPD)]

## Fiche commune à tous les traitements

| Rubrique | Contenu |
| --- | --- |
| Responsable de traitement | L'éditeur de Cave & Amis, une personne physique, à titre non professionnel et gratuit. Le même responsable traite aussi les données de l'application Cocon et de son agenda Nous. Identité confiée aux hébergeurs, non publiée (option d'anonymat de la LCEN). [À VALIDER : identité à faire figurer dans ce registre, qui n'est pas publié en ligne] |
| Contact | cocon.cave@gmail.com, adresse dédiée commune à Cave & Amis et Cocon |
| Délégué à la protection des données | Aucun. [À VALIDER : absence de délégué] |
| Personnes concernées | Les personnes inscrites (famille et amis, 18 ans et plus, de 20 à 100 comptes avec Cocon). Les personnes sans compte citées par une personne inscrite (note « Pour qui ? », description d'un événement, commentaire). Les visiteurs du site. |
| Mineurs | Aucun : l'application est réservée aux 18 ans et plus (case à cocher à l'inscription). |
| Ventes, publicité, profilage | Aucun. Aucun outil de suivi, aucun script extérieur. |
| Mesures de sécurité communes | Règles d'accès appliquées par la base de données elle-même (RLS sur toutes les tables). Échanges chiffrés (HTTPS). Photos dans un espace privé, liens temporaires d'une heure. Mot de passe de 8 caractères au moins (une lettre et un chiffre), redemandé pour le changer ou supprimer le compte. Clé Anthropic lue seulement par le serveur. Export du site contrôlé (aucun secret). Double authentification proposée à tous les comptes et obligatoire pour administrer (migration 20261102000001, en ligne depuis le 27/10/2026) ; avec un code activé, rien n'est lisible tant que la session n'est pas vérifiée. Actions de l'administrateur notées dans un journal inaltérable (T14). Détail : `docs/SECURITE.md`. |

## Les traitements

La base légale de chaque ligne est reprise de la politique de confidentialité. [À VALIDER : base légale de chaque traitement]

### T1. Comptes et connexion

- **Finalité** : créer le compte, se connecter, protéger l'accès.
- **Données** : adresse e-mail, mot de passe haché (par Supabase), prénom affiché, devise, préférences, dates d'inscription et de dernière connexion ; photo de profil facultative (Cave & Amis 2.0, migration 20261102000005, en ligne depuis le 28/10/2026) : recadrée et réduite sur l'appareil (métadonnées retirées), jamais analysée ni envoyée à Lia, visible des personnes qui voient déjà le prénom (contacts, participants d'un même événement), jamais d'une personne bloquée.
- **Base légale** : exécution du contrat (conditions d'utilisation). [À VALIDER : base légale de la photo de profil facultative]
- **Destinataires** : la personne ; l'administrateur voit l'adresse e-mail de chaque compte ; Supabase (hébergeur) ; Brevo, pour les e-mails de connexion (mot de passe oublié, confirmation d'inscription, changement d'adresse : adresse e-mail et contenu du message), depuis le 27/10/2026.
- **Transferts hors UE** : voir la section « Transferts ».
- **Durée** : tant que le compte existe ; photo de profil jusqu'à son retrait (l'ancienne effacée aussitôt, sinon à la première purge mensuelle après ses 30 jours, soit environ deux mois au plus) ; journaux d'envoi chez Brevo : 1 mois, sans aperçu du contenu des messages, et sans suivi des ouvertures ni des clics pour les personnes qui n'y ont pas consenti (réglages du compte Brevo commun à Cave et Cocon, faits par l'éditeur le 27/10/2026 : « Règles de conservation des emails » et « Consentement au suivi des pixels par contact » ; par défaut, Brevo garde ces journaux sans limite et suit tous les contacts, d'après ses pages d'aide relevées par la session Cocon).

### T2. Cave, carnet et envies

- **Finalité** : inventaire, carnet de dégustation, conseils, valeur de la cave.
- **Données** : caves et emplacements, fiches de vins et photos, lots (quantités, prix, date et lieu d'achat, notes), mouvements, déplacements de bouteilles d'un emplacement à un autre (qui, quel lot, combien, d'où, vers où, quand ; lisibles par le propriétaire du lot et par la personne qui a déplacé ; supprimés avec le lot, gardés sans identifiant si le compte de la personne qui a déplacé est supprimé ; cave en 3D, migration 20261102000009), prix de marché, dégustations (date, lieu, occasion, note, commentaires, plat, prix, photo, observations, et repères facultatifs de 1 à 5 : fruité, puissance, boisé, minéralité), envies. Profil de goûts déclaré (ce que la personne aime ou aime moins, budget habituel, note, traits du carnet à ignorer), lisible par elle seule ; les autres traits sont calculés à l'affichage, sans être enregistrés. (Cave & Amis 2.0, migrations 20261102000003 et 20261102000006, en ligne depuis le 28/10/2026.) Elles révèlent des habitudes de consommation d'alcool. [À VALIDER : ces habitudes de consommation sont-elles des données sensibles (article 9 du RGPD), par exemple des données de santé ?]
- **Base légale** : exécution du contrat.
- **Destinataires** : la personne ; ceux à qui elle ouvre sa cave, selon ses réglages ; les personnes associées à une cave gérée à plusieurs ; Supabase.
- **Durée** : tant que le compte existe ; relevés de prix 24 mois ; profil de goûts jusqu'à « Effacer mon profil » ou la suppression du compte.

### T3. Contacts, accès à la cave et invitations

- **Finalité** : retrouver ses proches et ne partager que ce que l'on choisit.
- **Données** : contacts, demandes envoyées et reçues, blocages, réglages d'accès, liens d'invitation (type, date de fin, note « Pour qui ? », personnes qui les ont utilisés), choix d'apparaître dans la recherche (désactivé au départ). Page d'invitation lisible sans compte : premier mot du prénom de la personne qui invite, type de lien, nom du groupe ou titre et date de l'événement.
- **Base légale** : exécution du contrat ; consentement pour la recherche ; intérêt légitime de l'auteur d'un lien pour la note « Pour qui ? » et la page d'invitation.
- **Destinataires** : la personne et ses contacts ; toute personne qui a le lien d'une invitation (page publique limitée) ; Supabase.
- **Durée** : tant que le compte existe ; liens expirés ou annulés : 90 jours après l'expiration ou l'annulation ; demandes refusées 6 mois.

### T4. Groupes et événements

- **Finalité** : organiser des soirées et partager des vins entre proches.
- **Données** : membres et rôles, bouteilles mises à disposition, notes partagées, envies et votes, activité du groupe (500 dernières actions, avec les prénoms) ; événements : titre, date, lieu (souvent une adresse), description, thème, budget, participants et réponses, menu, vins prévus et réservés. Cave & Amis 2.0 (migration 20261102000007, en ligne depuis le 28/10/2026) : mode soirée (messages de 280 caractères au plus, 500 par soirée, et note de 1 à 5 par bouteille, dont les autres participants ne voient que la moyenne et le nombre) ; achats groupés (titre, budget, note, vins avec prix unitaire et nombre de bouteilles, part de chaque membre avec son prénom ; aucun paiement ni donnée bancaire).
- **Base légale** : exécution du contrat. [À VALIDER : base légale pour les prénoms, messages et parts des autres membres ou participants]
- **Destinataires** : les membres du groupe ou les participants de l'événement (messages et notes de soirée : participants seulement, jamais une personne bloquée) ; Supabase.
- **Durée** : tant que le compte existe. Les événements d'un organisateur sont supprimés avec son compte, pour tous. Messages et notes de soirée : avec l'événement, ou avec le compte de leur auteur. Achats groupés : avec le groupe ; quitter le groupe retire ses parts des achats ouverts ; à la suppression du compte, ses parts sont supprimées et les achats qu'il a proposés restent, sans auteur.

### T5. Notifications

- **Finalité** : prévenir la personne de ce qui la concerne.
- **Données** : 200 dernières notifications (type, prénom de la personne à l'origine ou nom du vin, date) ; alertes facultatives de maturité (vin qui entre dans sa période ou vit sa dernière année ; date de chaque alerte gardée pour ne pas la répéter, supprimée avec le vin ou le compte) et de baisse de prix (Cave & Amis 2.0, migrations 20261102000004 et 20261102000008, en ligne depuis le 28/10/2026) ; sur les appareils, si activées : adresse d'abonnement, clés de chiffrement, nom d'appareil.
- **Base légale** : exécution du contrat ; autorisation donnée au navigateur pour les notifications sur l'appareil.
- **Destinataires** : la personne ; le service de notification de son navigateur (Google, Apple, Mozilla ou Microsoft), qui reçoit un texte chiffré qu'il ne peut pas lire ; Supabase. [À VALIDER : rôle de ces services]
- **Durée** : appareils qui ne répondent plus 90 jours.

### T6. Lia, l'assistant (avec la lecture d'étiquette)

- **Finalité** : répondre aux questions sur la cave, les événements, les groupes et l'application ; lire une étiquette.
- **Données** : message, 10 derniers messages, date, page d'origine ; extraits des données de la personne lus avec ses droits ; pour les autres personnes, seulement leur prénom et des informations simples (jamais leurs textes, leur e-mail ni leur identifiant) ; photos d'étiquette. Conversations gardées pour être relues.
- **Base légale** : exécution du contrat. [À VALIDER : base légale pour les données d'autres personnes envoyées à Anthropic]
- **Destinataires** : Anthropic (Anthropic Ireland, Limited), sous-traitant ; Supabase.
- **Durée** : conversations 12 mois après le dernier message. Chez Anthropic : 30 jours au plus selon ses pages, sauf exceptions. [À VALIDER : formulation sur la conservation chez Anthropic]

### T7. Scanner avant d'acheter, prix de marché et photos officielles

- **Finalité** : identifier un vin en magasin, donner un avis et des prix, proposer une photo officielle.
- **Données** : 1 à 3 photos (étiquette, contre-étiquette, prix en rayon), code-barres, magasin, prix relevé, budget, occasion ; description du vin pour les prix. Lecture de documents d'achat (projet du 28/10/2026, branche cave3d, pas encore en ligne) : une photo d'étiquette de prix, de catalogue, d'écran de site, de ticket de caisse, de facture ou de liste de prix envoyée entière à Anthropic ; elle peut montrer un nom, la fin d'un numéro de carte ou une adresse ; consigne de n'en recopier aucune, réponse limitée aux vins, prix, date et magasin, suites de 13 à 19 chiffres retirées par le serveur ; photo effacée juste après la lecture (sinon par la purge mensuelle) ; rien n'est enregistré sans vérification. Import multiple (Cave & Amis 2.0, en ligne depuis le 28/10/2026) : une photo de plusieurs bouteilles envoyée à Anthropic, supprimée juste après la lecture (sinon par la purge mensuelle) ; rien n'est enregistré sans confirmation. Alerte de baisse de prix (Cave & Amis 2.0, migration 20261102000008, en ligne depuis le 28/10/2026) : un vin suivi par personne, son prix de référence et le dernier contrôle ; chaque vendredi soir au plus, la description du vin (nom, cuvée, producteur, appellation, région, millésime, contenance) est envoyée automatiquement à Anthropic pour une recherche de prix, sans autre donnée de la personne ; plafond de 2 $ par mois pour toutes les alertes, pris dans le budget de l'assistant. Les métadonnées des photos (date, lieu, appareil) sont retirées sur l'appareil avant l'envoi.
- **Base légale** : exécution du contrat.
- **Destinataires** : Anthropic ; Open Food Facts (code-barres ou nom du vin, sans identifiant de personne ; il reçoit l'adresse IP de l'appareil qui affiche ses vignettes) ; Supabase.
- **Durée** : analyses et visites, avec leurs photos, 30 jours ; photos qui ne servent plus, effacées chaque mois ; vin suivi : jusqu'à l'arrêt du suivi, ou la suppression du vin ou du compte. [À VALIDER : base légale de l'envoi automatique et hebdomadaire pour l'alerte de prix]

### T8. Suivi de l'assistant, erreurs et limites d'utilisation

- **Finalité** : appliquer les limites, maîtriser les coûts, réparer les pannes, éviter les abus.
- **Données** : par demande, son type, le modèle, l'état, le coût, la quantité de texte et la date, jamais le contenu ; erreurs : type, code, détail de 200 caractères au plus, nettoyé ; compteurs : action, compte, heure.
- **Base légale** : intérêt légitime de l'éditeur.
- **Destinataires** : l'administrateur ; Supabase.
- **Durée** : usage 13 mois ; erreurs 3 mois ; compteurs 2 jours au plus. À la suppression du compte, l'usage est gardé sans identifiant.

### T9. Liaison avec l'agenda Nous (facultative)

- **Finalité** : faire apparaître les événements de Cave & Amis dans l'agenda Nous (application Cocon).
- **Données** : à la liaison, prénom, e-mail, identifiants dans les deux applications, choix d'ouvrir Cave depuis Nous sans mot de passe ; ensuite, pour chaque événement : type, titre, état, dates, lieu, description, thème, prénom de l'organisateur, prénoms et réponses de tous les participants, vins prévus. En retour, la réponse de la personne.
- **Base légale** : consentement (liaison), retiré en déliant. [À VALIDER : base légale pour les données des autres participants envoyées à Nous]
- **Destinataires** : Nous, même responsable de traitement. Dans Nous (constat R3, accord de l'éditeur le 27/10/2026, en ligne depuis la nuit du 27 au 28/10/2026) : participants et vins lisibles par la seule personne liée, même sur un événement partagé avec le foyer ; le foyer voit le type, le titre, l'état, les dates, le lieu, la description, le thème, le prénom de l'organisateur et la réponse de la personne liée.
- **Durée** : tant que la liaison existe ; à la suppression du compte ou à la déliaison, les événements vont à la corbeille de Nous (effacés 30 jours après). Dans Nous, depuis la nuit du 27 au 28/10/2026 : participants et vins effacés 30 jours après la fin de l'événement (purge active) ; Cave ne les envoie plus passé ce délai (migration 20261102000001, en ligne depuis le 27/10/2026).

### T10. Preuves d'acceptation et consentements

- **Finalité** : prouver ce qui a été accepté ou choisi, et quand.
- **Données** : versions des documents acceptés ou lus (date, version, moment), historique des choix (recherche, agenda Nous). Ni adresse IP, ni information sur l'appareil.
- **Base légale** : intérêt légitime de l'éditeur. [À VALIDER : base légale des preuves]
- **Destinataires** : l'administrateur, seulement en statistiques sans nom ; Supabase.
- **Durée** : tant que le compte existe, puis 5 ans (identifiant, version, date), puis effacées. [À VALIDER : durée de 5 ans]

### T11. Sauvegardes

- **Finalité** : pouvoir restaurer la base après une erreur ou un incident.
- **Données** : toutes les tables de l'application, les comptes (avec mot de passe haché) et la liste des photos, sans leurs fichiers.
- **Base légale** : intérêt légitime de l'éditeur. [À VALIDER : base légale des sauvegardes]
- **Destinataires** : l'éditeur seul. Copies chiffrées sur son PC (AES-256 et HMAC-SHA256, mot de passe connu de lui seul).
- **Durée** : 3 mois au plus pour chaque sauvegarde, supprimée à la main par l'éditeur.

### T12. Hébergement du site et journaux techniques

- **Finalité** : servir l'application et sécuriser les services.
- **Données** : adresse IP et navigateur des visiteurs, dans les journaux des hébergeurs.
- **Base légale** : [À VALIDER : base légale, a priori l'intérêt légitime]
- **Destinataires** : GitHub (GitHub Pages) ; Supabase.
- **Durée** : Supabase, 1 jour selon sa grille tarifaire pour l'offre gratuite ; GitHub, aucune durée publiée. [À VALIDER : sens de ces durées]
- **Journal des connexions dans la base** : d'après la documentation de Supabase (https://supabase.com/docs/guides/auth/audit-logs), les journaux de connexion peuvent aussi être écrits dans la base du projet (`auth.audit_log_entries`), réglage « Write audit logs to the database ». Vérifié le 27/10/2026 dans le tableau de bord, en lecture seule : **désactivé** pour le projet de Cave & Amis. Aucune purge de l'application ne touche cette table : la laisser désactivée, ou prévoir une durée de conservation avant de l'activer. Des lignes plus anciennes, écrites avant la désactivation, n'ont pas été recherchées.

### T13. Demandes sur les données et incidents

- **Finalité** : répondre aux demandes des personnes (`docs/conformite/routine-demandes.md`) et garder la trace des violations de données (`docs/conformite/procedure-violation.md`).
- **Données** : adresse e-mail de la personne, nature et date de sa demande, réponse apportée ; pour un incident : faits, données et personnes touchées, mesures prises.
- **Base légale** : [À VALIDER : obligation légale (articles 12 à 22 et 33 du RGPD) ?]
- **Destinataires** : l'éditeur ; la CNIL pour un incident à notifier.
- **Où** : hors du dépôt public, dans `B:\Claude Project\conformite\`.
- **Durée** : [À VALIDER : durée de conservation du suivi des demandes et du cahier des incidents]

### T14. Journal de l'administration

- **Finalité** : garder la trace des actions de l'administrateur (sécurité, preuve de ce qui a été publié ou réglé), comme Cocon.
- **Données** : date, compte de l'administrateur, action (publication d'un document légal avec son type, sa version, son titre et son empreinte ; réglages de l'assistant changés ; limites d'un compte, avec le compte visé).
- **Base légale** : [À VALIDER : intérêt légitime de l'éditeur ?]
- **Destinataires** : l'administrateur seul, avec la double authentification ; Supabase.
- **Durée** : 12 mois, puis effacé par la purge de chaque nuit ; impossible à modifier avant (migration 20261102000001, en ligne depuis le 27/10/2026).

## Sous-traitants et transferts hors de l'Union européenne

Repris de la politique de confidentialité et des pages officielles consultées le 26/10/2026 (note `prestataires-infos-officielles.md`, hors du dépôt). À revérifier régulièrement : ces pages changent.

| Prestataire | Rôle | Lieu | Contrat de sous-traitance | Garanties de transfert |
| --- | --- | --- | --- | --- |
| Supabase (Supabase Pte. Ltd., Singapour) | Base, comptes, photos, fonctions du serveur | Région Europe centrale (Francfort) ; certaines opérations hors de la région | Intégré à ses conditions (https://supabase.com/legal/dpa) | Clauses contractuelles types |
| GitHub (GitHub, Inc., États-Unis) | Hébergement du site (GitHub Pages) | États-Unis | « GitHub Customer Agreement » accepté le 27/10/2026 pour l'organisation `cave-et-amis`. [À VALIDER : formule présentée par GitHub comme destinée aux entreprises] | Data Privacy Framework et clauses contractuelles types |
| Anthropic (Anthropic Ireland, Limited) | Intelligence artificielle de Lia | [À VALIDER : lieu de traitement] | Intégré à ses conditions commerciales | Clauses contractuelles types |
| Google, Apple, Mozilla, Microsoft | Transport des notifications chiffrées | Selon le navigateur | Aucun publié pour le Web Push. [À VALIDER] | Google, Microsoft : Data Privacy Framework ; Apple, Mozilla : clauses contractuelles types |
| Open Food Facts (association, France) | Recherche de produits et photos | France | Sans objet : aucun identifiant de personne envoyé. [À VALIDER : qualification] | Sans objet |

| Brevo (BREVO SAS, Paris) | Envoi des e-mails de connexion, en service depuis le 27/10/2026 | D'après Brevo : OVH (France et Allemagne), Google Cloud (Belgique) | Annexe 3 de ses conditions d'utilisation (version du 1er octobre 2025) | Hébergement dans l'Union européenne ; sous-traitants de son infrastructure : Google Cloud et Cloudflare (sécurité, États-Unis), avec Data Privacy Framework et clauses contractuelles types (liste officielle de ses sous-traitants, relue le 28/10/2026) |

Prestataire prévu, pas encore en place au 27/10/2026 : Cloudflare Turnstile (anti-robots). À ajouter à ce registre le jour de sa mise en service.

## Tenue du registre

- Mettre à jour ce registre avant toute nouvelle fonction qui traite des données personnelles (nouvelle donnée, nouveau prestataire, nouvelle durée), en même temps que la politique de confidentialité.
- Le relire au moins une fois par an. [À VALIDER : fréquence]
- Dernière mise à jour : 27/10/2026.
