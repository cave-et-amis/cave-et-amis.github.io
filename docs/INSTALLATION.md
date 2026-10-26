# Mise en ligne pas à pas

Durée : environ 45 minutes, sans écrire de code. Trois services :

| Service | Rôle | Compte |
| --- | --- | --- |
| **Supabase** | base de données, comptes, photos privées, fonction serveur de l'assistant | celui déjà utilisé pour Maison Nette |
| **Netlify** | hébergement du site | celui déjà utilisé pour Maison Nette |
| **Anthropic (Claude)** | l'assistant ; **une seule clé**, payée par vous, jamais visible des utilisateurs | console.anthropic.com |

> **Offre gratuite Supabase** : 2 projets actifs maximum. Il faut soit mettre en pause un autre projet (relançable plus tard),
> soit passer à l'offre payante, soit installer Cave & Amis dans un projet existant (déconseillé : comptes mélangés).

---

## 1. Projet Supabase

1. <https://supabase.com/dashboard> › **New project** : nom `cave-et-amis`, région **West EU (Paris)**, un mot de passe de base
   solide (gardez-le pour vous, l'application n'en a pas besoin).
2. À la création : laissez **« Automatically expose new tables » décoché** (la migration donne les droits elle-même).
3. **SQL Editor** › New query › collez **tout** le fichier `supabase/migrations/20261019000001_init.sql` › **Run**.
   Résultat attendu : « Success. No rows returned ». Ce script crée les tables, les règles d'accès (RLS), les fonctions,
   le stockage privé des photos (`photos`) et les réglages de l'assistant.
4. **Authentication › Sign In / Providers › Email** : désactivez **« Confirm email »** — sans serveur d'e-mails personnalisé,
   Supabase n'envoie pas de messages à vos amis ; ils ne pourraient pas valider leur compte.
5. **Authentication › URL Configuration** : *Site URL* = l'adresse du site (étape 4), *Redirect URLs* = `https://votre-site/**`.
6. *(Recommandé pour « mot de passe oublié »)* **Authentication › Emails › SMTP Settings** : branchez un service d'envoi
   (Brevo, Resend…, offres gratuites suffisantes). Sans cela, le lien de récupération n'est envoyé qu'aux membres de votre
   équipe Supabase.

## 2. Fonction serveur de l'assistant

Le fichier à déployer est **`supabase/functions/cave-api/index.ts`** (généré par `npm run build:function`, un seul fichier).

**Option A — tableau de bord** : **Edge Functions › Deploy a new function › Via Editor**, nom **`cave-api`**, remplacez le
contenu par celui du fichier, **Deploy**. Puis, dans les détails de la fonction, désactivez **« Verify JWT »** (la fonction
vérifie elle-même la session de chaque appel).

**Option B — ligne de commande** (connexion à votre compte Supabase dans le navigateur) :

```bash
npx supabase login
```

```bash
npx supabase functions deploy cave-api --no-verify-jwt --project-ref VOTRE_REFERENCE
```

## 3. Clé Anthropic (côté serveur uniquement)

1. <https://console.anthropic.com> › **Settings › API Keys › Create Key** (de préférence dans un *workspace* dédié
   « Cave & Amis »).
2. **Recommandé** : *Settings › Limits* → fixez une **limite de dépense mensuelle** sur ce workspace. C'est le plafond absolu,
   en plus du budget réglé dans l'application.
3. Vérifiez que la **recherche web** est autorisée pour l'organisation (*Settings › Capabilities*) : elle sert aux prix de marché.
4. Dans Supabase : **Edge Functions › Secrets › Add new secret** :
   - `ANTHROPIC_API_KEY` = la clé (collez-la **vous-même** ici ; ne la mettez jamais dans un fichier, un message ou le code) ;
   - `ALLOWED_ORIGINS` = `https://votre-site.netlify.app` (facultatif, limite les appels à votre site).

Sans clé, l'application fonctionne entièrement ; seul l'assistant indique « non configuré ».

## 4. Site (Netlify)

1. Copiez `config.production.example.js` en **`config.production.js`** et remplacez les deux valeurs par celles de
   **Supabase › Project Settings › API Keys** : l'URL du projet et la clé **publishable** (`sb_publishable_…`).
   Ces deux valeurs sont publiques par nature ; le site refuse de démarrer avec une clé secrète.
2. Préparez l'archive :

```bash
npm run package:site
```

3. Netlify › **Add new site › Deploy manually** › glissez `livraison/cave-et-amis-site.zip` ; renommez le site
   (ex. `cave-et-amis-bruno`). Reportez l'adresse dans Supabase (étape 1.5) et dans `ALLOWED_ORIGINS`.

## 5. Premier compte = administrateur

Ouvrez le site et **créez votre compte en premier** : le tout premier compte devient administrateur. Puis
**Réglages › Administration** :

1. **Tester la connexion** : vérifie la clé sans jamais l'afficher et récupère la liste des modèles disponibles.
2. Choisissez le **modèle** (par défaut Claude Opus 5.5), l'**effort**, le **budget mensuel**, les **quotas par personne**,
   la **recherche web** et ses limites. Les tarifs des modèles (dollars par million de jetons) sont pré-remplis d'après la page
   de tarifs d'Anthropic d'octobre 2026 : à mettre à jour s'ils changent. Un modèle sans tarif est refusé.
3. Invitez vos amis depuis **Amis & Groupes › « Inviter quelqu'un »** (lien, QR code, WhatsApp, SMS ou e-mail).

## Mettre à jour

- Interface : `npm run package:site`, puis déposez l'archive dans **Netlify › Deploys**.
- Fonction serveur : `npm run build:function`, puis redéployez `cave-api` (option A ou B).
- Base : si un **nouveau** fichier apparaît dans `supabase/migrations/`, exécutez-le seul dans le SQL Editor
  (jamais l'ancien une seconde fois), **avant** de redéployer la fonction et l'interface. Quand une mise à jour a un script
  de retour arrière (`supabase/sql/retour-<numéro>.sql`), ses instructions sont en tête du fichier.
- Notifications push (une seule fois) : après la migration `20261030000001_notifications_push.sql` et le déploiement de
  cave-api, exécutez `supabase/sql/push-envoi.sql` dans le SQL Editor (envoi dès qu'une notification est créée, et
  nouvelles tentatives chaque minute). Aucune clé à créer : celles du serveur se créent seules au premier usage.
- Durées de conservation (une seule fois, avec l'accord du responsable : chaque purge est définitive) : après la migration
  `20261101000001_documents_legaux.sql` et le déploiement de cave-api, exécutez `supabase/sql/conservation.sql` (purge
  chaque nuit, photos qui ne servent plus chaque mois). Faites-le **avant** de mettre en ligne l'interface, qui annonce
  ces durées.
- Documents légaux : complétez et faites valider les projets de `docs/legal/` (voir son `LISEZMOI.md`), puis publiez-les
  depuis **Administration › Documents légaux**. Rien n'est demandé aux personnes tant qu'aucun document n'est publié.

## Sauvegardes (chaque mois, et avant chaque mise à jour importante)

L'offre gratuite de Supabase ne sauvegarde pas la base : la sauvegarde se fait depuis votre PC, chiffrée.

1. Une seule fois : dans un terminal, `npx.cmd -y supabase@2 login` (la connexion se fait dans votre navigateur).
2. Depuis le dossier Cave : `powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1`.
3. Choisissez un mot de passe de chiffrement (12 caractères au moins), tapé deux fois sans s'afficher. Rangez-le dans un
   gestionnaire de mots de passe : il n'est écrit nulle part, et sans lui la sauvegarde est illisible.
4. Le fichier `cave-sauvegarde.json.enc` est écrit dans `B:\Claude Project\sauvegardes\<date>\`, puis relu et vérifié. Le
   script affiche le nombre de tables, de lignes, de comptes et de photos.

Contenu : toutes les tables de l'application, les comptes (adresse e-mail, mot de passe haché, dates) et la **liste** des
photos. Les fichiers des photos ne sont pas copiés. Les données ne sont jamais écrites en clair sur le disque.

- Relire une sauvegarde : `powershell -ExecutionPolicy Bypass -File scripts\dechiffrer-sauvegarde.ps1 -Fichier "<dossier>\cave-sauvegarde.json.enc"`.
  Le fichier obtenu est en clair : supprimez-le dès que vous n'en avez plus besoin.
- Chiffrer une ancienne sauvegarde restée en clair :
  `powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1 -Chiffrer "<chemin du fichier>"`. Le script vérifie la
  copie chiffrée, puis vous supprimez vous-même l'original.
- Chiffrement : AES-256 avec authentification (HMAC-SHA256), clés tirées du mot de passe par PBKDF2 (600 000 tours). Un mauvais
  mot de passe ou un fichier modifié sont refusés.

## Réglages de connexion recommandés (Supabase › Authentication)

- **Sign In / Providers › Email** : « Minimum password length » à **8**, « Password requirements » à **Letters and
  digits** (la même règle que l'application), « Require current password when updating » **activé**. Les mots de passe
  existants restent valables ; seuls les nouveaux suivent la règle.
- **URL Configuration** : ne garder dans « Redirect URLs » que l'adresse du site en service.
