-- Cave & Amis — durcissements de faible gravité (priorité 3 de l'audit de sécurité et RGPD du 26/10/2026).
--
--  1. Limites de fréquence hors IA (F4) : table rate_hits et fonction rate_take (nombre d'appels au plus par action et
--     par personne, sur une fenêtre glissante), sur le modèle d'ai_begin pour l'assistant. La base l'applique elle-même
--     à la création des liens d'invitation (30 par 24 heures, en plus des 20 liens actifs au plus) ; cave-api l'applique
--     à la notification d'essai, aux appels à Open Food Facts et à l'envoi immédiat vers l'agenda Nous. Les compteurs
--     ne gardent que l'action, l'identifiant du compte et l'heure ; passé un jour, ils sont effacés au prochain appel
--     ou par la purge de chaque nuit (rate_purge, appelée par cave-api avec retention_purge).
--  2. Journal des erreurs techniques (F9) : ai_errors.detail est nettoyé par la base elle-même, quelle que soit la
--     version de cave-api qui l'écrit : plus aucun passage entre guillemets (c'est là qu'un message d'erreur recopie une
--     valeur reçue, donc un texte saisi), ni clé, ni jeton, ni adresse e-mail ; 200 caractères au plus.
--  3. Suppression d'un compte (R5) : chez les autres, son prénom devient « Ancien membre » dans les notifications et
--     dans l'activité des groupes ; la photo d'un groupe qui continue sans elle est retirée (le fichier part avec son
--     dossier) ; ses compteurs de fréquence sont effacés. Le reste du nettoyage ne change pas.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261101000001_documents_legaux.sql. Rejouable sans
-- danger. La mise à jour elle-même ne modifie aucune donnée existante (les erreurs déjà enregistrées restent telles
-- quelles, jusqu'à leur purge à 3 mois). Retour arrière : supabase/sql/retour-20261101000004.sql.

-- ───────────── 1. Limites de fréquence hors IA ─────────────

-- Une ligne par appel compté : action (bucket), clé (identifiant du compte), heure. Rien d'autre.
create table if not exists public.rate_hits (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket ~ '^[a-z_]{2,40}$'),
  subject text not null check (char_length(subject) between 1 and 100),
  at timestamptz not null default now()
);
create index if not exists rate_hits_key on public.rate_hits (bucket, subject, at);
create index if not exists rate_hits_at on public.rate_hits (at);

-- Aucun accès direct : seulement par les fonctions ci-dessous (serveur et base).
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- Compte un appel pour (action, clé) s'il reste sous la limite : p_limit appels au plus sur les p_window_seconds
-- dernières secondes (un jour au plus). false : limite atteinte, rien n'est compté. Verrou par clé : deux appels
-- simultanés sont comptés l'un après l'autre. Les compteurs de plus d'un jour sont effacés au passage.
create or replace function public.rate_take(p_bucket text, p_subject text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_bucket is null or p_subject is null or coalesce(p_limit, 0) < 1 or coalesce(p_window_seconds, 0) not between 1 and 86400 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('cave.rate.' || p_bucket || '.' || p_subject));
  delete from rate_hits where at < now() - interval '1 day';
  select count(*) into v_count from rate_hits
  where bucket = p_bucket and subject = p_subject and at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_limit then
    return false;
  end if;
  insert into rate_hits (bucket, subject) values (p_bucket, p_subject);
  return true;
end $$;

-- Purge de chaque nuit (cave-api, avec retention_purge) : compteurs de plus d'un jour.
create or replace function public.rate_purge() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from rate_hits where at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Liens d'invitation : 30 nouveaux liens par 24 heures et par personne, en plus des 20 liens actifs au plus.
create or replace function public.friend_invites_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.rate_take('invite', new.inviter_id::text, 30, 86400) then
    raise exception 'invite_rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists friend_invites_rate on public.friend_invites;
create trigger friend_invites_rate before insert on public.friend_invites
  for each row execute function public.friend_invites_rate();

-- ───────────── 2. Journal des erreurs techniques ─────────────

-- Détail d'une erreur tel qu'il est gardé : clés, jetons et adresses e-mail masqués ; tout passage entre guillemets
-- retiré, même s'il n'est pas refermé (texte coupé) ; espaces regroupés ; 200 caractères au plus.
create or replace function public.clean_error_detail(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(left(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(p, ''), '(sk-ant-|sb_secret_|sb_publishable_)[A-Za-z0-9_-]*', '[clé masquée]', 'g'),
                'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*', '[jeton masqué]', 'g'),
              '(x-api-key|authorization|apikey)[[:space:]]*[:=][[:space:]]*(bearer[[:space:]]+)?[^[:space:]]+', '\1: [masqué]', 'gi'),
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[adresse]', 'g'),
          '"[^"]*("|$)|«[^»]*(»|$)|“[^”]*(”|$)', '"…"', 'g'),
        '(^|[[:space:](:,=])''[^'']*(''|$)', '\1"…"', 'g'),
      '[[:space:]]+', ' ', 'g')), 200), '')
$$;

-- Mêmes paramètres qu'avant (20261019000001_init.sql) ; le détail passe par clean_error_detail.
create or replace function public.ai_log_error(p_user uuid, p_action text, p_code text, p_detail text, p_model text) returns void
language sql security definer set search_path = public as $$
  insert into ai_errors (user_id, action, code, detail, model)
  values (p_user, p_action, left(p_code, 60), public.clean_error_detail(p_detail), left(p_model, 80))
$$;

-- ───────────── 3. Suppression d'un compte : le prénom recopié chez les autres ─────────────

-- Mêmes étapes qu'avant (20261031000001_securite_priorite1.sql), dans le même ordre, puis : le prénom recopié chez les
-- autres devient « Ancien membre » (les lignes restent ; l'identifiant du compte en disparaît ensuite par la cascade)
-- et les compteurs de fréquence sont effacés.
-- Activité des groupes : par l'identifiant pour ses propres actions (« a rejoint », « est parti » la nomment aussi en
-- cible). Quand elle est la cible de l'action d'un autre (invitée, retirée, rôle changé), seul son prénom est noté : il
-- est retrouvé sous son prénom actuel, dans les groupes où elle apparaît (membre, auteur d'une action, notification du
-- groupe) ou, pour une invitation, quand l'auteur est en relation avec elle.
create or replace function public.account_cleanup(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r event_wines;
  v_name text;
begin
  for r in select * from event_wines where owner_id = p_user and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  update wines set label_photo = null where owner_id <> p_user and label_photo like p_user::text || '/%';
  update wines set bottle_photo = null, bottle_photo_source = null, bottle_photo_credit = null, bottle_photo_original = null
  where owner_id <> p_user and bottle_photo like p_user::text || '/%';
  update wines set bottle_photo_original = null where owner_id <> p_user and bottle_photo_original like p_user::text || '/%';
  delete from group_shares where owner_id = p_user;
  delete from cellar_access where owner_id = p_user or viewer_id = p_user;
  delete from cellar_access_exceptions where owner_id = p_user or viewer_id = p_user;
  delete from cellar_access_requests where from_id = p_user or to_id = p_user;
  -- Dans l'ordre (lots, vins, caves) : la protection « cave non vide » refuserait sinon la suppression des caves.
  delete from lots where owner_id = p_user;
  delete from wines where owner_id = p_user;
  delete from cellars where owner_id = p_user;
  -- Photo d'un groupe qui continue sans elle : le fichier, dans son dossier, est effacé avec le compte.
  update groups set photo = null where photo like p_user::text || '/%';

  -- Prénom recopié chez les autres.
  select display_name into v_name from profiles where id = p_user;
  update notifications set actor_name = 'Ancien membre' where actor_id = p_user;
  if v_name is not null then
    update group_activity a set target_name = 'Ancien membre'
    where a.kind in ('invited', 'removed', 'role') and a.target_name = v_name
      and not (a.kind in ('invited', 'removed') and a.actor_id = p_user)
      and (a.group_id in (select m.group_id from group_members m where m.user_id = p_user)
           or a.group_id in (select x.group_id from group_activity x where x.actor_id = p_user)
           or a.group_id in (select n.ref_id from notifications n
                             where n.user_id = p_user and n.kind in ('group_invite', 'group_joined') and n.ref_id is not null)
           or (a.kind = 'invited' and exists (
                 select 1 from friendships f
                 where (f.user_a = p_user and f.user_b = a.actor_id) or (f.user_b = p_user and f.user_a = a.actor_id))));
  end if;
  update group_activity
  set actor_name = 'Ancien membre',
      target_name = case when kind in ('joined', 'left') then 'Ancien membre' else target_name end
  where actor_id = p_user;
  delete from rate_hits where subject = p_user::text;
end $$;

-- ───────────── Droits ─────────────

revoke all on function public.rate_take(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.rate_purge() from public, anon, authenticated;
revoke all on function public.friend_invites_rate() from public, anon, authenticated;
revoke all on function public.clean_error_detail(text) from public, anon, authenticated;
revoke all on function public.ai_log_error(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.account_cleanup(uuid) from public, anon, authenticated;
grant all on public.rate_hits to service_role;
grant execute on all functions in schema public to service_role;
