# Intégration Cave & Amis ↔ Nous (Cocon) — contrat technique

> Document commun aux deux dépôts (copie identique dans `Cocon/docs/INTEGRATION-CAVE.md`).
> Option retenue le 25/10/2026 : **deux projets Supabase distincts, reliés par une liaison sécurisée des comptes**.
> Aucun mot de passe ne circule ; aucune donnée existante n'est fusionnée ni supprimée.

## 1. Vue d'ensemble

```
 CAVE & AMIS (Supabase ogkm…)                         NOUS / COCON (Supabase wfxz…)
 ┌───────────────────────────────┐                    ┌──────────────────────────────────┐
 │ events / event_participants / │                    │ events (+ source, external_id,   │
 │ event_wines                   │                    │          external_meta, …)       │
 │   │ déclencheurs SQL          │                    │   ▲ cave_upsert_event (système)  │
 │   ▼                           │   HTTPS signé      │   │                              │
 │ nous_outbox ── cave-api ─────────────────────────► │ cave-sync                        │
 │   (cron 1 min + appel client) │  (HMAC partagé)    │   │                              │
 │ nous_links                    │ ◄───────────────── │ cave_links / cave_outbox (RSVP)  │
 └───────────────────────────────┘   RSVP, liaison,   └──────────────────────────────────┘
                                     connexion directe
```

- **Cave & Amis est la source** des événements : titre, type, date, lieu, description, statut, participants, bouteilles.
- **Nous en garde une copie par participant lié**, dans son agenda personnel. Les champs venus de Cave y sont en lecture seule.
- **Nous ne renvoie que la réponse** (oui / peut-être / non) de la personne, uniquement pour les événements venus de Cave.
  Supprimer l'événement dans Nous = le masquer **et** répondre « non » (choix validé le 25/10/2026).
- Un champ ne circule que dans un sens : pas de boucle possible.

## 2. Sécurité des échanges serveur à serveur

- Secret partagé `ECOSYSTEM_SECRET` (≥ 32 caractères aléatoires), défini dans les **secrets des Edge Functions des deux projets**.
  Jamais dans le code, jamais dans le navigateur.
- Chaque requête porte :
  - `x-eco-timestamp` : horodatage Unix en millisecondes ;
  - `x-eco-signature` : `hex(HMAC-SHA256(ECOSYSTEM_SECRET, "<timestamp>.<corps brut>"))`.
- Le destinataire refuse si la signature est fausse (comparaison à temps constant) ou si l'horodatage s'écarte de plus de **5 minutes**.
- Chaque action vérifie que la paire `(cave_user_id, nous_user_id)` existe dans **sa propre** table de liaison
  (sauf `link.peek` / `link.redeem`, protégés par le code à usage unique).
- Corps JSON, `{"action": "...", ...}`, 64 Ko au plus. Réponse : `{"ok": true, ...}` ou `{"ok": false, "code": "..."}`.

Adresses (variables d'environnement des fonctions) :

| Côté | Variable | Valeur |
|---|---|---|
| Cave | `NOUS_FUNCTION_URL` | `https://wfxzfiabnmeimjyjrmrv.supabase.co/functions/v1/cave-sync` |
| Cave | `NOUS_APP_URL` | `https://cocon-famille.netlify.app/` |
| Nous | `CAVE_FUNCTION_URL` | `https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api` |
| Nous | `CAVE_APP_URL` | `https://cave-et-amis.github.io/` |
| les deux | `ECOSYSTEM_SECRET` | même valeur des deux côtés |

## 3. Liaison des comptes

1. Dans Cave › Réglages › « Agenda Nous », la personne connectée clique « Activer mon agenda Nous gratuitement »
   (ou « Connecter mon agenda Nous »). Action utilisateur `nous_link_start` → Cave crée un **code** aléatoire
   (32 caractères, stocké haché en SHA-256, valable 30 minutes, usage unique) et renvoie
   `NOUS_APP_URL + "?cave_link=<code>"`.
2. Nous ouvre l'écran « Relier Cave & Amis ». Il appelle `cave-sync` `link_peek` (sans session) qui demande à Cave
   (`link.peek`) le prénom et l'e-mail associés, **uniquement pour pré-remplir** le formulaire d'inscription
   (l'e-mail de Cave n'est pas vérifié : il ne prouve rien).
3. La personne se connecte à Nous (compte existant) ou s'inscrit (formulaire pré-rempli, consentement explicite).
   Le code est gardé 30 minutes dans le navigateur pendant l'éventuelle confirmation d'e-mail.
4. Une fois connectée, Nous appelle `cave-sync` `link_redeem` (avec la session Nous) → `cave-sync` appelle
   Cave `link.redeem {code, nous_user_id}` → Cave vérifie le code, le consomme, enregistre `nous_links`, met en file
   les événements à venir de la personne, et renvoie `cave_user_id` → Nous enregistre `cave_links`.
5. **Preuve de liaison** : la personne a prouvé contrôler les deux comptes (session Cave pour créer le code, session Nous
   pour le consommer). Aucune liaison automatique par e-mail.
6. Un compte Cave ne se lie qu'à un compte Nous, et réciproquement (contraintes `unique`).

**Délier** : depuis l'une ou l'autre application. Le côté qui délie supprime sa ligne et prévient l'autre (`link.revoked`).
Les événements importés dans Nous sont alors **mis à la corbeille** de Nous (restaurables 30 jours, ensuite effacés par
la purge existante). Rien n'est modifié dans Cave.

**Suppression de compte** : la cascade supprime la liaison du côté concerné ; l'autre côté la constate au prochain échange
(`not_linked`) et la retire.

## 4. Connexion directe (« Voir dans Nous » / « Voir dans Cave & Amis »)

- L'application d'origine (session ouverte) appelle sa fonction (`nous_jump` côté Cave, `cave_jump` côté Nous).
- Celle-ci demande à l'autre côté `jump.token {cave_user_id, nous_user_id}` (signé). L'autre côté vérifie la liaison,
  génère un lien magique (`auth.admin.generateLink({type: 'magiclink'})`) et renvoie **uniquement** `token_hash`
  (usage unique, durée de vie des liens magiques Supabase).
- Le navigateur ouvre `<APP_URL>?auth=link&token_hash=<…>&next=<chemin>` ; l'application appelle
  `auth.verifyOtp({type: 'magiclink', token_hash})` puis retire ces paramètres de l'adresse.
- Si la personne a activé la double authentification dans Nous, Nous lui demande ensuite son code (niveau aal2), comme d'habitude.
- Nous peut refuser avec `{ ok: false, code: 'jump_disabled' }` dans trois cas :
  - la personne n'a pas activé la connexion directe dans Nous (désactivée par défaut) ;
  - c'est un compte d'administration ;
  - c'est un compte bloqué.
- En cas d'échec, y compris `jump_disabled`, l'application ouvre simplement l'autre site (connexion normale), sans délier
  les comptes ni afficher d'erreur.

## 5. Synchronisation Cave → Nous

### File d'envoi (Cave, `nous_outbox`)
- Des déclencheurs SQL mettent en file `(event_id, user_id)` pour chaque participant lié lorsqu'un événement, ses
  participants ou ses bouteilles changent ; `op = 'remove'` quand la personne n'est plus participante ou que l'événement
  est supprimé (déclencheur **avant** suppression, donc avant la cascade).
- Une seule ligne en attente par `(event_id, user_id)` : les changements rapprochés sont regroupés.
- Le contenu est **reconstruit au moment de l'envoi** (état le plus récent), avec `version` = microsecondes de l'horloge
  de la base à la construction : toujours croissante.
- Envoi : `cave-api` `nous_flush` (cron chaque minute, jeton `x-cron-token`) et, pour l'immédiateté, appel par
  l'application après chaque modification d'un événement. Échec : nouvelle tentative avec délai croissant
  (1, 2, 4… minutes, 1 heure au plus) ; abandon après 20 tentatives (visible dans `last_error`).

### Actions Cave → Nous (signées)

`event.upsert`
```json
{
  "action": "event.upsert",
  "cave_user_id": "uuid", "nous_user_id": "uuid",
  "event_id": "uuid", "version": 1761400000000000,
  "event": {
    "kind": "diner|degustation|anniversaire|soiree_theme",
    "title": "Dîner d’automne",
    "status": "planned|cancelled|done",
    "starts_at": "2026-11-14T19:30:00.000Z",
    "ends_at": "2026-11-14T22:30:00.000Z",
    "timezone": "Europe/Paris",
    "place": "12 rue …",
    "description": "",
    "theme": "",
    "organizer_name": "Bruno",
    "is_organizer": false,
    "my_rsvp": "pending|yes|maybe|no",
    "participants": [{ "name": "Claire", "role": "guest", "rsvp": "yes" }],
    "wines": [{ "name": "Meursault", "producer": "…", "vintage": 2019, "color": "blanc", "quantity": 2, "status": "confirmed", "owner_name": "Claire" }],
    "url": "https://cave-et-amis.github.io/#/evenements/<event_id>"
  }
}
```
- `ends_at` : Cave ne stocke pas de fin ; durée par défaut selon le type : dîner 3 h, dégustation 2 h 30,
  anniversaire 4 h, soirée à thème 4 h.
- Seuls les participants et les bouteilles **que la personne voit déjà dans Cave** sont envoyés (les participants d'un
  événement se voient entre eux ; les bouteilles `proposed|confirmed|consumed` sont visibles des participants).
  Ni budget, ni prix, ni stock.

`event.remove` : `{action, cave_user_id, nous_user_id, event_id, version}`.

`link.revoked` : `{action, cave_user_id, nous_user_id}`.

Réponse attendue de Nous : `{ok: true, applied: true|false}` (`false` = version plus ancienne ignorée). `not_linked` →
Cave retire la liaison.

### Réception dans Nous
- Fonction SQL `cave_upsert_event(owner, external_id, version, data)` réservée au service : insère ou met à jour la ligne
  `events` où `source = 'cave'`, `external_id = <event_id>`, `owner_id = <nous_user_id>` (index unique), seulement si
  `version > source_version`. À la création : `visibility = 'personal'` (moi seul, choix validé). Ensuite, la visibilité,
  la catégorie, le rappel et le mode discret restent ceux que la personne a choisis dans Nous.
- `status = 'cancelled'` : l'événement reste affiché, marqué « Annulé ». `remove` : mis à la corbeille.
- Les champs venus de Cave (titre, dates, lieu, description, source…) ne sont modifiables que par cette fonction
  (déclencheur de garde).

## 6. Synchronisation Nous → Cave (réponse seulement)

`rsvp` (signée) : `{action, cave_user_id, nous_user_id, event_id, rsvp: "yes|maybe|no"}` → Cave exécute
`respond_event` au nom de la personne (mêmes règles : l'organisateur ne peut pas répondre « non », événement « prévu »
seulement). Réponse `{ok: true, rsvp}` ou `{ok: false, code: "event_not_planned" | "organizer_must_attend" | …}`.

- Nous enregistre d'abord la réponse localement (`cave_outbox`), puis l'envoie ; en cas d'échec réseau, nouvelle
  tentative par le cron existant de Nous. Le retour de Cave (nouvelle version via `event.upsert`) confirme l'état.
- Mise à la corbeille dans Nous d'un événement venu de Cave = réponse « non » (sauf pour l'organisateur : simple masquage).

## 7. Données personnelles (RGPD)

- Minimisation : seuls les champs ci-dessus circulent, pour les seules personnes qui ont lié leurs comptes.
- Consentement : la liaison est une action explicite, réversible à tout moment depuis les deux applications.
- Pas de compte Nous créé sans action de la personne.
- Délier ou supprimer son compte arrête immédiatement les envois ; les copies dans Nous vont à la corbeille (30 jours).
- Aucun secret dans le navigateur ; le secret partagé ne vit que dans les secrets des fonctions.

## 8. Retour arrière

- Côté Nous : désactiver l'intégration = retirer le secret `ECOSYSTEM_SECRET` (toutes les requêtes sont refusées) ;
  les colonnes ajoutées sont facultatives et ignorées par l'ancienne version de l'application.
- Côté Cave : retirer `NOUS_FUNCTION_URL` (plus aucun envoi ; la file se remplit sans effet) ; la tâche cron peut être
  supprimée avec `select cron.unschedule('cave-nous-sync');`.
- Les migrations n'altèrent aucune donnée existante ; des scripts `*_rollback.sql` suppriment uniquement les objets ajoutés.
