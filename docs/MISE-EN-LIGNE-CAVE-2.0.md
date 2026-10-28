# Mise en ligne de Cave & Amis 2.0 (lot 1 et refonte visuelle)

Ce qui part en ligne : le lot 1 (thème « Clair-Obscur », mémoire des goûts, accords mets-vins, alertes de maturité) et la
refonte visuelle des étapes 1 à 7 (icônes, Explorer, Statistiques, photo de profil, écrans de Lia, prix, import multiple,
cave en 2D, mode soirée, défis, achats groupés, alerte de baisse de prix). Branche `cave2-design`. Rien n'est en ligne tant
que les étapes ci-dessous n'ont pas été faites, **chacune avec votre accord**.

**L'ordre compte** : la base d'abord, puis cave-api, puis le site, dans la même séance (environ 45 minutes). Les
migrations ne gênent pas l'ancien site (il ignore les nouvelles colonnes et tables).

## Avant de commencer (conditions bloquantes)

1. **Politique de confidentialité** mise à jour et publiée par la session RGPD **avant ou en même temps** que le site. Elle
   doit couvrir les nouveautés listées dans la note technique `cave-2.0-photo-profil-pour-rgpd.md` (dossier de notes,
   hors dépôt) : photo de profil, repères de goût, messages et notes de soirée, achats groupés, alerte de prix (recherche
   hebdomadaire envoyée à Claude). Sans elle, le site ne part pas : il annoncerait des traitements non décrits.
2. **Réunir `origin/main`** dans `cave2-design` (au 28/10/2026, un commit de plus : `b30b7a3`, registre Brevo), puis
   relancer `npm run verify` : tout doit être vert.
3. **Test de concurrence** : `npm run test:concurrence` (Docker Desktop démarré) : « Tous les scénarios de concurrence sont
   tenus ».
4. Prévenir la session Cocon de l'heure de mise en ligne (aucune modification de la liaison Nous dans ce lot).

## 1. Sauvegarde chiffrée (obligatoire)

Comme pour la mise en ligne précédente (docs/MISE-EN-LIGNE-AUDIT.md, étape 1) :

```bash
powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1
```

Notez le dossier affiché : c'est votre point de retour.

## 2. Migrations, une par une (vous cliquez « Run »)

Supabase › SQL Editor, un onglet vierge par fichier, dans cet ordre. L'agent colle le texte et compare son empreinte au
fichier avant que vous cliquiez. Aucune ne supprime de donnée existante. Les quatre premières sont rejouables sans danger ;
les deux dernières (`…07` et `…08`) ne s'exécutent qu'**une fois** (elles renomment l'export « mes données » pour le
compléter) : en cas d'erreur à mi-chemin, ne pas relancer, passer par leur retour arrière.

| Ordre | Fichier (`supabase/migrations/`) | Ce qu'elle fait | Retour arrière (`supabase/sql/`) |
| --- | --- | --- | --- |
| 1 | `20261102000003_gouts.sql` | mémoire des goûts (profil déclaré, traits écartés) | `retour-20261102000003.sql` |
| 2 | `20261102000004_maturite.sql` | alertes de maturité facultatives | `retour-20261102000004.sql` |
| 3 | `20261102000005_photo_profil.sql` | photo de profil facultative, vue de ceux qui voient le prénom | `retour-20261102000005.sql` |
| 4 | `20261102000006_profil_gustatif.sql` | 4 repères de goût (1 à 5) dans la fiche de dégustation | `retour-20261102000006.sql` |
| 5 | `20261102000007_soiree_achats.sql` | mode soirée (messages, notes) et achats groupés | `retour-20261102000007.sql` |
| 6 | `20261102000008_alerte_prix.sql` | alerte de baisse de prix (1 vin, plafond 2 $/mois) | `retour-20261102000008.sql` |

Les migrations `20261102000001` (alignement Cocon) et `20261102000002` (lot 0) font partie de `main` et ont été mises en
ligne avec lui : vérifiez-le avant de commencer (`select count(*) from pg_proc where proname = 'mfa_ok';` doit répondre 1),
sans les rejouer.

Contrôle juste après (lecture seule) :

```sql
select price_alert_budget_usd, monthly_budget_usd from ai_settings;
```

Attendu : `2.00` pour le plafond des alertes, votre budget mensuel habituel pour l'autre.

## 3. cave-api (vous cliquez « Deploy updates »)

Supabase › Edge Functions › cave-api › Code : l'agent remplace le code par `supabase/functions/cave-api/index.ts` et compare
son empreinte au fichier. « Verify JWT » reste **désactivé**. Aucun nouveau secret.

## 4. Tâches planifiées (accord à part pour chacune)

- **Alertes de maturité** : `supabase/sql/maturite-cron.sql` (chaque jour ; sans IA, sans coût).
- **Alerte de baisse de prix** : `supabase/sql/alerte-prix-cron.sql` (vendredi 19 h UTC). **Coût** : environ 0,255 $ réservés
  par vin vérifié (Sonnet 5.5, 3 recherches web), plafond de 2 $ par mois pour toute l'application, dans le budget mensuel de
  l'assistant. Plafond atteint : la vérification n'est pas lancée. **Ce n'est pas un plafond absolu** : la taille des pages
  lues par la recherche web n'est qu'estimée (docs/SECURITE.md, « Maîtrise des coûts ») ; pour une garantie, fixez aussi une
  limite de dépense dans la console Anthropic. Pour arrêter : `select cron.unschedule('cave-alerte-prix');`.

Sans la seconde, la case « M'alerter si le prix baisse » s'enregistre mais rien n'est vérifié : ne la publiez pas sans
l'avoir activée, ou dites-le aux personnes.

## 5. Code sur GitHub

Avec votre accord, l'agent pousse la branche sur `main`, **après** la base et cave-api (comme les mises en ligne
précédentes : rien n'est exposé avant d'être en place). Compte GitHub : celui qui administre l'organisation `cave-et-amis`.

## 6. Site

Avec votre accord, l'agent refait l'export (`npm run build`, avec `config.production.js`) et le pousse sur `gh-pages`
(avec `.nojekyll`). Le service hors ligne passe en version `cave-amis-v2` : les téléphones rechargent les images.

## 7. Contrôles en ligne

- Thème sombre par défaut ; Réglages › Apparence change le thème.
- Barre du bas sur téléphone : Accueil, Ma cave, Amis, Événements, Explorer ; menu à 9 entrées sur ordinateur.
- Réglages : ajouter puis retirer une photo de profil ; elle apparaît en haut à droite.
- La purge mensuelle des photos (`supabase/sql/conservation.sql`, le 1er du mois à 2 h 40 UTC) doit être active : elle efface
  les anciennes photos de profil dont la suppression immédiate aurait échoué (`select jobname from cron.job;` doit lister
  `cave-photos-monthly`).
- Explorer : recherche d'un vin, « Accords mets-vins » (Plat unique / Menu complet), « Défis et découvertes ».
- Ma cave › Vue 2D ; Ajouter › « Ajouter plusieurs bouteilles » (une photo : Lia liste les bouteilles, rien n'est ajouté
  sans « Vérifier et ajouter »).
- Fiche d'un vin avec plusieurs relevés : courbe des prix ; case « M'alerter si le prix baisse ».
- Un événement du jour : « Ouvrir le mode soirée » ; un groupe : onglet « Achats ».
- Réglages › Confidentialité et mes données : l'archive contient `alerte_de_prix`, `parts_d_achats_groupes`,
  `messages_de_soiree`.
- Le premier vendredi soir : dans les journaux de cave-api, l'appel `price_alerts_run` a répondu 200 ; son coût réel se lit
  en lecture seule : `select count(*), sum(cost_usd) from ai_usage where action = 'price_alert';`.

## En cas de problème

- Remettre cave-api et le site de la version d'avant (`git show <commit d'avant>:supabase/functions/cave-api/index.ts`).
- Désactiver les tâches planifiées de l'étape 5 (commandes dans l'en-tête de chaque fichier).
- Puis les retours arrière, **dans l'ordre inverse** (8, 7, 6, 5, 4, 3), en suivant l'en-tête de chaque fichier. Le retour
  de la 7 suppose celui de la 8 déjà fait. Chaque en-tête dit ce qui est perdu (par exemple : soirées et achats groupés).
- La sauvegarde de l'étape 1 reste le dernier recours.
