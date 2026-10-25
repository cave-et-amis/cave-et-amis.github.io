# Mise en service de l'intégration Cave & Amis ↔ Nous

Guide pas à pas, à suivre **dans l'ordre**. Rien n'est activé tant que l'étape 4 n'est pas faite : les étapes 1 à 3
peuvent être réalisées sans effet visible pour les utilisateurs. Contrat technique : [INTEGRATION-NOUS.md](INTEGRATION-NOUS.md).

Coût : **0 €** — tout tient dans l'offre gratuite de Supabase (fonctions, pg_cron, pg_net) ; aucune nouvelle
infrastructure. Côté Nous, une mise en ligne Netlify consomme des crédits du forfait existant (une seule suffit).

## Le plus simple : le script

Les étapes 0 à 5 ci-dessous sont automatisées, avec une pause de confirmation avant chacune :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mise-en-service-nous.ps1
```

Il connecte la ligne de commande Supabase (dans votre navigateur), sauvegarde les deux bases en JSON (sans Docker),
applique les migrations, tire au hasard le secret partagé et l'installe des deux côtés sans l'afficher, déploie les deux
fonctions, active les tâches planifiées, publie le site Cave & Amis sur `gh-pages`, puis ouvre Netlify pour le dépôt du
zip de Nous. Il s'arrête à la première erreur.

## Avant tout : partir de la dernière version de `main`

La branche `feature/integration-cave-nous` part de `7a3b11e`. D'autres travaux (phase D « caves gérées à plusieurs »)
sont mis en ligne séparément : **fusionner `main` dans la branche avant de déployer `cave-api` ou le site**, puis relancer
`npm run build:function` (le fichier `supabase/functions/cave-api/index.ts` est généré) et `npm test`. Sinon, la mise en
ligne effacerait ces autres changements.

## 0. Sauvegardes (obligatoire)

Pour **chacun** des deux projets Supabase (Cave & Amis `ogkmucrjqomsqtjmkipd`, Nous `wfxzfiabnmeimjyjrmrv`) :

1. Supabase › Database › Backups : vérifier qu'une sauvegarde quotidienne récente existe (offre gratuite : 1 jour de rétention).
2. Et, en plus, une copie locale du schéma et des données :
   ```bash
   npx supabase db dump --db-url "postgresql://postgres:<MOT_DE_PASSE>@db.<REF>.supabase.co:5432/postgres" -f sauvegarde-schema.sql
   ```
   ```bash
   npx supabase db dump --data-only --db-url "postgresql://postgres:<MOT_DE_PASSE>@db.<REF>.supabase.co:5432/postgres" -f sauvegarde-donnees.sql
   ```
   (Le mot de passe de la base se trouve dans Supabase › Project Settings › Database. Ne le collez jamais dans le code.)

## 1. Secret partagé

Générer une valeur aléatoire d'au moins 32 caractères (à garder dans votre gestionnaire de mots de passe) :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Base de données (SQL Editor de chaque projet)

| Projet | Fichier à exécuter |
|---|---|
| Cave & Amis | `supabase/migrations/20261025000007_integration_nous.sql` |
| Nous | `supabase/migrations/20261025000001_integration_cave.sql` (dépôt Cocon) |

Ces migrations **ajoutent** des tables, colonnes facultatives et fonctions ; elles ne modifient ni ne suppriment aucune
donnée existante.

## 3. Fonctions (Edge Functions)

**Cave & Amis** — Supabase › Edge Functions › Secrets :

| Secret | Valeur |
|---|---|
| `ECOSYSTEM_SECRET` | le secret de l'étape 1 |
| `NOUS_FUNCTION_URL` | `https://wfxzfiabnmeimjyjrmrv.supabase.co/functions/v1/cave-sync` |
| `NOUS_APP_URL` | `https://cocon-famille.netlify.app/` |
| `CAVE_APP_URL` | `https://cave-et-amis.github.io/` |

Puis redéployer `cave-api` :
```bash
npx supabase functions deploy cave-api --no-verify-jwt --project-ref ogkmucrjqomsqtjmkipd
```

**Nous** — mêmes réglages côté Cocon (voir le README du dépôt Cocon, section « Intégration Cave & Amis ») :
`ECOSYSTEM_SECRET` (même valeur), `CAVE_FUNCTION_URL`, `CAVE_APP_URL`, `NOUS_APP_URL`, puis déploiement de `cave-sync`.

## 4. Tâches planifiées (activation)

- Cave & Amis : exécuter `supabase/sql/integration-nous-cron.sql` dans le SQL Editor.
- Nous : exécuter `supabase/sql/integration-cave-cron.sql` (dépôt Cocon).

## 5. Sites

- Cave & Amis : `npm run build`, puis publier `dist/` sur la branche `gh-pages` comme d'habitude.
- Nous : `npm run package:site`, puis déposer le zip sur Netlify comme d'habitude.

## 6. Vérification (5 minutes)

1. Cave & Amis › Réglages › « Agenda Nous » › « Activer mon agenda Nous gratuitement » : on arrive sur Nous.
2. Se connecter (ou s'inscrire) dans Nous et accepter : « Agenda Nous » indique « Relié… » dans Cave & Amis.
3. Créer un dîner dans Cave & Amis en invitant un ami relié : il apparaît dans son agenda Nous (🍷) en moins d'une minute.
4. Changer l'heure dans Cave & Amis : l'agenda Nous suit. Répondre « Oui » dans Nous : la réponse apparaît dans Cave & Amis.
5. Annuler l'événement : il est marqué « Annulé » dans Nous.

En cas de souci : table `nous_outbox` (colonne `last_error`) côté Cave & Amis, `cave_outbox` côté Nous.

## Retour arrière

Du plus léger au plus complet :

1. **Couper immédiatement** : supprimer le secret `ECOSYSTEM_SECRET` dans l'un des deux projets → toutes les requêtes sont
   refusées, l'interface affiche « pas encore activée ». Aucune donnée n'est perdue.
2. **Arrêter les envois** : `select cron.unschedule('cave-nous-sync');` (Cave) et l'équivalent côté Nous.
3. **Revenir à l'ancienne version des sites** : republier la version précédente (`gh-pages` : commit précédent ;
   Netlify : « Publish deploy » sur le déploiement précédent).
4. **Retirer les objets ajoutés** : `supabase/sql/integration-nous-rollback.sql` (Cave) et
   `supabase/sql/integration-cave-rollback.sql` (Nous). Ils ne suppriment que ce que l'intégration a ajouté.
5. En dernier recours seulement : restauration des sauvegardes de l'étape 0.
