-- Cave & Amis — liaison avec l'agenda Nous durcie (constat S4 de l'audit de sécurité ; règles communes avec Cocon).
--
-- 1. Connexion directe depuis Nous (« Voir dans Cave & Amis », action signée jump.token) : en option, désactivée par
--    défaut, y compris pour les liaisons existantes. Chacun la règle pour sa liaison seulement (nous_set_allow_jump) ;
--    jamais pour un compte administrateur. Sinon, Nous reçoit « jump_disabled » et ouvre simplement le site.
-- 2. Avis après chaque liaison : une notification (et un push si la personne l'a activé) « Votre compte est relié à
--    l'agenda Nous de … » ; une liaison faite à son insu se voit tout de suite.
-- 3. Anti-rejeu des requêtes signées venues de Nous : l'empreinte de chaque signature acceptée est gardée ; la même
--    signature présentée une seconde fois est refusée par cave-api.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261101000001_documents_legaux.sql, AVANT de redéployer
-- cave-api. Rejouable sans danger. La mise à jour ne modifie ni ne supprime aucune donnée existante (la nouvelle colonne
-- vaut « désactivée » pour toutes les liaisons). Retour arrière : supabase/sql/retour-20261101000002.sql.

-- ───────────── 1. Connexion directe depuis Nous ─────────────

alter table public.nous_links add column if not exists allow_jump boolean not null default false;

-- « Ouvrir Cave & Amis depuis Nous sans mot de passe » : seulement pour sa propre liaison, jamais pour un administrateur.
create or replace function public.nous_set_allow_jump(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if p_enabled is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if p_enabled and exists (select 1 from profiles where id = v_me and is_admin) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update nous_links set allow_jump = p_enabled where user_id = v_me;
  if not found then
    raise exception 'not_linked' using errcode = 'P0001';
  end if;
  return p_enabled;
end $$;

-- Avant tout lien de connexion pour Nous : paire liée (sinon « not_linked »), option activée et compte qui n'administre
-- pas l'application (sinon « jump_disabled », le code que Nous renvoie dans l'autre sens). Vérifié à chaque demande :
-- un compte devenu administrateur est refusé même si l'option était activée.
create or replace function public.nous_jump_check(p_user uuid, p_nous_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_allow boolean;
begin
  select l.allow_jump into v_allow from nous_links l where l.user_id = p_user and l.nous_user_id = p_nous_user;
  if not found then
    raise exception 'not_linked' using errcode = 'P0001';
  end if;
  if not v_allow or exists (select 1 from profiles p where p.id = p_user and p.is_admin) then
    raise exception 'jump_disabled' using errcode = 'P0001';
  end if;
  return true;
end $$;

-- ───────────── 2. Avis après chaque liaison ─────────────

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked'));

-- Toute nouvelle liaison prévient la personne (prénom du compte Nous) ; la file push la reprend comme les autres
-- notifications (déclencheur notifications_push).
create or replace function public.nous_links_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, actor_id, actor_name, ref_id)
  values (new.user_id, 'nous_linked', null, left(nullif(btrim(new.nous_display_name), ''), 40), null);
  -- 200 notifications au plus par personne, comme notify().
  delete from notifications
  where user_id = new.user_id and id in (select id from notifications where user_id = new.user_id order by created_at desc offset 200);
  return null;
end $$;

drop trigger if exists nous_links_notify on public.nous_links;
create trigger nous_links_notify after insert on public.nous_links
  for each row execute function public.nous_links_notify();

-- ───────────── 3. Anti-rejeu des requêtes signées ─────────────

-- Empreinte SHA-256 de chaque signature acceptée. Une requête n'est valable que 5 minutes autour de son horodatage : une
-- ligne n'est plus utile 10 minutes après celui-ci, et part au passage suivant.
create table if not exists public.eco_replay (
  signature_sha256 text primary key check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  seen_at timestamptz not null default now()
);
create index if not exists eco_replay_signed on public.eco_replay (signed_at);

-- Note la signature d'une requête déjà vérifiée par cave-api : vrai la première fois, faux si elle a déjà servi (rejeu).
-- Deux envois simultanés de la même requête : la clé primaire n'en laisse passer qu'un.
create or replace function public.eco_replay_claim(p_signature_sha256 text, p_signed_at timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if p_signature_sha256 is null or p_signature_sha256 !~ '^[0-9a-f]{64}$' or p_signed_at is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  delete from eco_replay where signed_at < now() - interval '10 minutes';
  insert into eco_replay (signature_sha256, signed_at) values (p_signature_sha256, p_signed_at)
  on conflict (signature_sha256) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ───────────── Droits ─────────────

-- eco_replay : réservée au serveur (aucune politique pour les utilisateurs).
alter table public.eco_replay enable row level security;
revoke all on public.eco_replay from anon, authenticated;
revoke all on function public.nous_links_notify() from public, anon, authenticated;
revoke all on function public.nous_jump_check(uuid, uuid) from public, anon, authenticated;
revoke all on function public.eco_replay_claim(text, timestamptz) from public, anon, authenticated;
revoke all on function public.nous_set_allow_jump(boolean) from public, anon;
grant execute on function public.nous_set_allow_jump(boolean) to authenticated;
grant all on public.eco_replay to service_role;
grant execute on all functions in schema public to service_role;
