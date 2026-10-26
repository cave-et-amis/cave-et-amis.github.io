# Mise en ligne de l'audit de sécurité et RGPD (priorités 2 et 3)

Ce qui part en ligne : documents légaux et « Confidentialité et mes données » (export, choix, durées de conservation),
profil limité au prénom, liaison Nous durcie, protections du site, contrôle anti-robots (prêt, pas encore activé),
double authentification de l'administrateur, durcissements du serveur. Rien de tout cela n'est en ligne tant que les
étapes ci-dessous n'ont pas été faites, chacune avec votre accord.

**L'ordre compte** : la base d'abord, puis cave-api, puis le site, dans la même séance (environ 45 minutes). Entre la
migration du profil (étape 3) et le nouveau site (étape 5), l'ancien site affiche « Un ancien contact » à la place des
prénoms de vos contacts : ne faites pas de pause entre les deux.

## Avant de commencer

- `npm run verify` tout vert sur la branche `audit-rgpd` (voir docs/TESTS.md).
- `origin/main` n'a pas bougé depuis `337a857` (sinon, réunir d'abord les nouveaux commits et revérifier).
- Prévenir la session Cocon de l'heure de mise en ligne : Nous doit signer à nouveau toute nouvelle tentative (anti-rejeu,
  401 `replay`), et l'ouverture de Cave depuis Nous sans mot de passe est désactivée par défaut (`jump_disabled`).
- Version en ligne à comparer avant de la remplacer : cave-api déployée depuis `337a857` (empreinte `dfa8e6ba…`), site
  `gh-pages` `58e9221`.

## 1. Sauvegarde chiffrée (obligatoire)

Dans un terminal, depuis le dossier Cave (la connexion se fait dans votre navigateur ; à faire une seule fois) :

```bash
npx.cmd -y supabase@2 login
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1
```

Le script relit et vérifie la sauvegarde. Notez le dossier affiché : c'est votre point de retour.

## 2. Code sur GitHub

Avec votre accord, l'agent pousse la branche `audit-rgpd` sur `main`.

## 3. Migrations, une par une (vous cliquez « Run »)

Supabase › SQL Editor, un onglet vierge par fichier, dans cet ordre. L'agent colle le texte et compare son empreinte au
fichier avant que vous cliquiez. Chacune est rejouable sans danger et ne supprime aucune donnée existante.

| Ordre | Fichier (`supabase/migrations/`) | Ce qu'elle fait | Retour arrière (`supabase/sql/`) |
| --- | --- | --- | --- |
| 1 | `20261101000001_documents_legaux.sql` | documents légaux, preuves, consentements, export, purges (pas encore planifiées) | `retour-20261101000001.sql` |
| 2 | `20261101000002_liaison_nous_durcie.sql` | ouverture depuis Nous en option, avis de liaison, anti-rejeu | `retour-20261101000002.sql` |
| 3 | `20261101000003_profil_limite.sql` | profil des autres limité au prénom (`profile_names`) | `retour-20261101000003.sql` |
| 4 | `20261101000004_durcissements.sql` | limites de fréquence, journal d'erreurs nettoyé, « Ancien membre » | `retour-20261101000004.sql` |
| 5 | `20261101000005_double_authentification.sql` | code exigé pour l'administration une fois activé | `retour-20261101000005.sql` |

## 4. cave-api (vous cliquez « Deploy updates »)

Supabase › Edge Functions › cave-api › Code : l'agent remplace le code par `supabase/functions/cave-api/index.ts` et
compare son empreinte au fichier. « Verify JWT » reste **désactivé**. Aucun nouveau secret : `CAVE_APP_URL`
(`https://cave-et-amis.github.io/`) est déjà en place et sert maintenant aussi à n'autoriser que le site (CORS).

## 5. Purges de conservation (accord à part : chaque purge est définitive)

À faire **avant** le site : sa page « Confidentialité et mes données » annonce que ces durées sont appliquées
automatiquement chaque nuit.

1. Lecture seule : `supabase/sql/conservation-apercu.sql` dans le SQL Editor affiche, par catégorie, combien de lignes
   seraient effacées maintenant (des nombres, jamais le contenu).
2. Si vous êtes d'accord : `supabase/sql/conservation.sql` (purge chaque nuit, photos le 1er du mois). Pour arrêter :
   la commande est dans l'en-tête du fichier.

Sans votre accord ici, le nouveau site ne part pas en ligne tel quel : sa page dirait une chose fausse.

## 6. Site

Avec votre accord, l'agent refait l'export (`npm run build`, avec `config.production.js`) et le pousse sur `gh-pages`
(avec `.nojekyll`).

## 7. Contrôles en ligne

- Se connecter ; les prénoms des contacts, des groupes et des événements s'affichent normalement.
- Réglages › Confidentialité et mes données : l'archive ZIP se télécharge et contient `donnees.json`.
- Lia répond ; le scanner analyse une bouteille ; une notification d'essai arrive.
- Agenda Nous : la liaison est toujours là ; depuis Nous, « Voir dans Cave & Amis » ouvre simplement le site (option à
  activer par chacun dans les Réglages).
- Aucun document légal n'est encore publié : rien n'est demandé aux personnes pour l'instant.
- Le lendemain : dans les journaux de la fonction (Supabase › Edge Functions › cave-api), l'appel de la purge de la nuit
  (2 h 20 en temps universel, soit 3 h 20 à Paris en hiver) a répondu 200.

## 8. Plus tard, chacun avec votre accord

- **Documents légaux** : compléter les emplacements « [À COMPLÉTER » et faire valider par un juriste les points
  « [À VALIDER » (docs/legal/LISEZMOI.md), puis publier depuis Administration › Documents légaux. La base refuse de
  publier un document qui en contient encore.
- **E-mails** (Brevo) : pour « mot de passe oublié » et les confirmations.
- **Contrôle anti-robots** : clés Cloudflare Turnstile, puis les contrôles de docs/INSTALLATION.md (suppression d'un compte
  de test comprise).
- **Double authentification** de l'administrateur : Réglages › Double authentification.
- **Anciennes erreurs** (facultatif, modifie des données) : `update ai_errors set detail = clean_error_detail(detail);`
  nettoie celles enregistrées avant la migration 4 (sinon, elles partent d'elles-mêmes au bout de 3 mois).

## En cas de problème

- Remettre cave-api et le site de `337a857` (code de la fonction : `git show 337a857:supabase/functions/cave-api/index.ts`).
- Puis les retours arrière, dans l'ordre inverse (5, 4, 3, 2, 1), en suivant l'en-tête de chaque fichier. Le retour de la
  migration 1 supprime les documents publiés et les preuves d'acceptation : à n'utiliser qu'avant la première
  publication, ou après une sauvegarde.
- Une donnée effacée par une purge ne revient pas ; la sauvegarde de l'étape 1 reste le dernier recours.
