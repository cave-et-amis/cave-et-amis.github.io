# Projets de documents juridiques de Cave & Amis

Ces quatre textes sont des **projets**, préparés après l'audit de sécurité et RGPD du 26 octobre 2026 et les réponses de l'éditeur aux questions communes avec Cocon. Ce ne sont pas des avis juridiques. Ils ont été complétés, et leurs points juridiques décidés par l'éditeur lui-même le 27/10/2026, sans relecture par un juriste (voir plus bas).

- `cgu.md` : conditions d'utilisation (acceptation demandée, case jamais cochée d'avance, 18 ans au moins).
- `confidentialite.md` : politique de confidentialité (simple information, jamais un « consentement »).
- `mentions-legales.md` : mentions légales prévues par la loi pour la confiance dans l'économie numérique (LCEN), avec l'option d'anonymat choisie par l'éditeur.
- `cookies.md` : cookies et stockage sur l'appareil (aucun bandeau : seul du stockage strictement nécessaire est utilisé).

Ils décrivent Cave & Amis **après la mise en ligne de la priorité 2** de l'audit : documents et preuves, « Confidentialité et mes données », export complet, durées de conservation appliquées chaque nuit (supabase/sql/conservation.sql), information sur Lia et Anthropic, effacement des données de confort à la déconnexion. Ne les publiez pas avant : ils annonceraient des protections pas encore en place.

Ils décrivent aussi la liaison avec l'agenda Nous durcie (migration `20261101000002_liaison_nous_durcie.sql` : ouverture depuis Nous sans mot de passe en option, désactivée au départ ; avis après chaque liaison) : mettez-la en ligne avant de les publier.

La politique de confidentialité annonce aussi deux règles de Nous (constat R3, accord de l'éditeur le 27/10/2026) : participants et vins visibles de la seule personne liée, même pour le foyer (lot 2 de Cocon), et effacés 30 jours après la fin de l'événement (lot 4 de Cocon, purge activée par l'éditeur). Au 27/10/2026, ils ne sont pas en ligne : ne publiez pas la politique avant leur mise en ligne dans Cocon, ou retirez ces deux phrases.

## Ce qu'il faut compléter

Chaque emplacement « [À COMPLÉTER : …] » attend une information que seul l'éditeur peut donner, ou qui doit être recopiée depuis la page officielle d'un prestataire. L'application refuse de publier un document qui en contient encore un. Rien n'a été inventé.

Les trois emplacements ont été complétés le 27/10/2026 : préavis de 30 jours avant un arrêt du service (conditions d'utilisation), sauvegardes gardées 3 mois au plus, journaux des hébergeurs (Supabase : « Log retention (API & Database) : 1 day » sur https://supabase.com/pricing pour l'offre gratuite ; GitHub : aucune durée publiée, d'après https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement, consultés le 27/10/2026). Il n'en reste plus.

L'adresse de contact dédiée, commune aux deux applications, est cocon.cave@gmail.com (confirmée par l'éditeur le 26/10/2026). Les dénominations, adresses, contrats de sous-traitance, garanties de transfert et la conservation chez Anthropic sont déjà repris des pages officielles des prestataires, relevées le 26/10/2026 dans la note `prestataires-infos-officielles.md` (hors du dépôt, avec l'adresse de chaque page). Revérifiez-les au moment de publier : ces pages changent. Aucun des hébergeurs ne publie de numéro de téléphone : les mentions légales le disent.

## Points juridiques : décidés par l'éditeur, sans juriste

Le 27/10/2026, l'éditeur a choisi de ne pas attendre un juriste. Les 27 mentions « [À VALIDER] » des quatre textes ont été passées en revue une par une avec lui, risque par risque, et retirées seulement sur sa décision. **Aucun de ces points n'a été vérifié par un juriste** : ce choix ne rend pas l'application conforme. La liste complète reste dans `questions-pour-le-juriste.md`, pour une relecture plus tard.

Décisions prises (27/10/2026) :

- Mentions légales : anonymat gardé (identité enregistrée chez GitHub et Supabase, selon l'éditeur) ; directeur de la publication « l'éditeur, personne physique » ; GitHub, Inc. et Supabase cités avec « ne publie pas de numéro de téléphone ».
- Cookies : aucun bandeau, budget du scanner et propositions de Lia compris.
- Politique : responsable anonyme joignable par e-mail ; aucun délégué ; bases légales gardées, avec l'intérêt légitime ajouté pour les données des autres personnes envoyées à Anthropic et à Nous ; formulation prudente sur Anthropic ; contrat GitHub signé ; services de notification décrits sans contrat ; Data Privacy Framework de GitHub, Google LLC et Microsoft Corporation vérifié actif sur la liste officielle le 27/10/2026 ; preuves 5 ans ; aucune suppression automatique des comptes inactifs ; journaux des hébergeurs tels que publiés ; directives après le décès par e-mail.
- Conditions : gratuité et usage entre proches ; 18 ans par case à cocher ; message sanitaire gardé ; « dans les limites permises par la loi » ajouté à la clause de responsabilité ; droit français, sans tribunal désigné.

À refaire plus tard :

- **Brevo et Cloudflare Turnstile** ne sont pas cités : publiez une nouvelle version de la politique **avant** d'activer l'un ou l'autre.
- **Comptes inactifs** : y revenir quand les e-mails marcheront (prévenir avant de supprimer).
- **Data Privacy Framework** : les adhésions se renouvellent chaque année ; revérifiez-les à chaque nouvelle version.

## Comment publier

1. Vérifiez qu'aucun emplacement ne reste (c'est le cas au 27/10/2026) et que les conditions ci-dessus (priorité 2, liaison Nous, lots 2 et 4 de Cocon) sont remplies.
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

La liste complète des questions, prête à transmettre à un juriste, avec le contexte de l'application : `questions-pour-le-juriste.md` (44 questions au 27/10/2026, qui couvrent aussi les documents de `docs/conformite/`).
