# Projets de documents juridiques de Cave & Amis

Ces quatre textes sont des **projets**, préparés après l'audit de sécurité et RGPD du 26 octobre 2026 et les réponses de l'éditeur aux questions communes avec Cocon. Ce ne sont pas des avis juridiques : ils doivent être complétés, puis relus par un juriste avant toute publication.

- `cgu.md` : conditions d'utilisation (acceptation demandée, case jamais cochée d'avance, 18 ans au moins).
- `confidentialite.md` : politique de confidentialité (simple information, jamais un « consentement »).
- `mentions-legales.md` : mentions légales prévues par la loi pour la confiance dans l'économie numérique (LCEN), avec l'option d'anonymat choisie par l'éditeur.
- `cookies.md` : cookies et stockage sur l'appareil (aucun bandeau : seul du stockage strictement nécessaire est utilisé).

Ils décrivent Cave & Amis **après la mise en ligne de la priorité 2** de l'audit : documents et preuves, « Confidentialité et mes données », export complet, durées de conservation appliquées chaque nuit (supabase/sql/conservation.sql), information sur Lia et Anthropic, effacement des données de confort à la déconnexion. Ne les publiez pas avant : ils annonceraient des protections pas encore en place.

Ils décrivent aussi la liaison avec l'agenda Nous durcie (migration `20261101000002_liaison_nous_durcie.sql` : ouverture depuis Nous sans mot de passe en option, désactivée au départ ; avis après chaque liaison) : mettez-la en ligne avant de les publier.

## Ce qu'il faut compléter

Chaque emplacement « [À COMPLÉTER : …] » attend une information que seul l'éditeur peut donner, ou qui doit être recopiée depuis la page officielle d'un prestataire. L'application refuse de publier un document qui en contient encore un. Rien n'a été inventé.

- **Politique de confidentialité** : la durée de conservation des sauvegardes, et celle des journaux de Supabase et de GitHub (leurs pages ne la donnent pas).
- **Conditions d'utilisation** : le délai de préavis avant un arrêt définitif du service.

L'adresse de contact dédiée, commune aux deux applications, est cocon.cave@gmail.com (confirmée par l'éditeur le 26/10/2026). Les dénominations, adresses, contrats de sous-traitance, garanties de transfert et la conservation chez Anthropic sont déjà repris des pages officielles des prestataires, relevées le 26/10/2026 dans la note `prestataires-infos-officielles.md` (hors du dépôt, avec l'adresse de chaque page). Revérifiez-les au moment de publier : ces pages changent. Aucun des hébergeurs ne publie de numéro de téléphone (point à valider pour la LCEN).

## Ce qu'il faut faire valider par un juriste

Chaque mention « [À VALIDER : …] » signale une clause à faire vérifier. Retirez-la une fois le point validé, avant la publication.

- **Option d'anonymat** de la LCEN pour un éditeur non professionnel (mentions légales), et son articulation avec l'article 13 du RGPD (identité du responsable dans la politique de confidentialité).
- **Hébergeurs** : entité de GitHub à citer, et absence de numéro de téléphone publié par GitHub et Supabase.
- **Contrats et garanties** : contrat de sous-traitance de GitHub (« GitHub Customer Agreement » à accepter dans les paramètres de l'organisation `cave-et-amis`), rôle des services de notification, fiches du « Data Privacy Framework » à contrôler dans un navigateur, formulation sur la conservation chez Anthropic.
- **Gratuité** et caractère non commercial du service.
- **Âge minimum** de 18 ans et message sanitaire sur l'alcool.
- **Limitation de responsabilité**, dans les limites permises par la loi.
- **Droit applicable** et juridiction compétente.
- **Absence de délégué** à la protection des données.
- **Engagement de l'éditeur** sur son accès technique aux données.
- **Bases légales** de chaque traitement, en particulier pour les données d'autres personnes envoyées à Anthropic et à Nous.
- **Durée de 5 ans** de conservation des preuves après la suppression d'un compte.
- **Comptes inactifs** : durée d'inactivité avant suppression, après avoir prévenu la personne.
- **Stockage sur l'appareil** : qualification de « strictement nécessaire » (page cookies).
- **Directives après le décès** (loi Informatique et Libertés).
- **Prestataires à venir** : ajouter Brevo (e-mails) et Cloudflare Turnstile (anti-robots) s'ils sont en place au moment de la publication.
- **Profil visible des contacts** : la politique dit honnêtement qu'ils peuvent lire tout le profil ; retirer ce point quand l'accès sera limité au prénom (priorité 3 de l'audit).

## Comment publier

1. Complétez les emplacements et faites valider les clauses ci-dessus.
2. Dans Cave & Amis : Administration › Documents légaux › « Nouvelle version » du document.
3. Cliquez sur « Charger le projet (docs/legal) » : le texte de ce dossier s'affiche. Remplacez chaque emplacement ; le bouton « Aperçu » montre le rendu. Tant qu'il reste un « [À COMPLÉTER » ou un « [À VALIDER », la publication est refusée (par l'application et par la base).
4. Indiquez en quelques mots ce qui change (pour la première version : « Première version »).
5. Pour les conditions d'utilisation, la première version demande toujours une acceptation à tous les comptes ; ensuite, cochez « Changement important » seulement pour un changement important. Les autres documents informent sans demander d'accord.
6. Publiez (une confirmation est demandée). Le numéro de version, la date et l'empreinte du texte sont ajoutés par la base. Un document publié ne se modifie plus : une correction se fait par une nouvelle version.

Ordre conseillé : les mentions légales, la page cookies et la politique de confidentialité d'abord, les conditions d'utilisation en dernier. Les personnes déjà inscrites accepteront les conditions à leur prochaine connexion ; tant qu'elles ne l'ont pas fait, l'application reste fermée pour elles, sans que rien ne soit supprimé.

## À garder cohérent

- Ces textes suivent le modèle commun aux deux applications (`legal_documents`, `legal_acceptances`, `user_consents`), convenu avec l'audit de Cocon. Si une règle change dans l'une, vérifiez l'autre.
- Les durées de conservation affichées dans l'application (src/domain/legal.ts) et appliquées par la base (retention_purge) doivent rester celles de la politique.
- Toute nouvelle fonction qui traite des données personnelles (nouveau prestataire, nouvelle donnée, nouvelle durée) doit être ajoutée à la politique de confidentialité, puis publiée comme nouvelle version.
