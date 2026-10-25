-- Cave & Amis — intégration avec l'agenda Nous (Cocon) : liaison des comptes et file d'envoi des événements.
-- Contrat complet : docs/INTEGRATION-NOUS.md.
--
-- Principes :
-- * la liaison est une action explicite de la personne : un code à usage unique (30 minutes) créé ici, consommé par Nous
--   une fois la personne connectée là-bas ; aucune liaison automatique par e-mail (les e-mails ne sont pas vérifiés) ;
-- * Cave & Amis reste la source des événements : chaque changement (événement, participants, réponses, bouteilles) met
--   en file un envoi vers Nous pour chaque participant lié ; le contenu est reconstruit au moment de l'envoi ;
-- * une seule ligne en attente par (événement, personne) : les changements rapprochés sont regroupés ;
-- * Nous ne renvoie que la réponse de la personne (oui / peut-être / non), appliquée avec les règles de respond_event ;
-- * aucune donnée existante n'est modifiée ; tout passe par des fonctions contrôlées ; les tables sont protégées par RLS.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000005_mise_a_disposition.sql
-- (indépendante de 20261025000006_caves_partagees.sql : l'une ou l'autre peut être appliquée en premier).
-- Retour arrière : supabase/sql/integration-nous-rollback.sql (ne supprime que les objets ajoutés ici).

-- ───────────── Tables ─────────────

-- Liaison d'un compte Cave & Amis avec un compte Nous (une seule de chaque côté).
create table public.nous_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  nous_user_id uuid not null unique,
  nous_display_name text check (char_length(nous_display_name) <= 60),
  sync_enabled boolean not null default true,
  linked_at timestamptz not null default now()
);

-- Codes de liaison : seul leur empreinte SHA-256 est gardée.
create table public.nous_link_codes (
  code_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index nous_link_codes_user on public.nous_link_codes (user_id, created_at desc);

-- File d'envoi vers Nous. Sans clé étrangère : une ligne doit survivre à la suppression de l'événement
-- (pour prévenir Nous) et à celle de la liaison ou du compte (pour annoncer la fin de la liaison).
create table public.nous_outbox (
  id bigint generated always as identity primary key,
  op text not null check (op in ('upsert', 'remove', 'unlink')),
  user_id uuid not null,
  nous_user_id uuid not null,
  event_id uuid,
  -- Clé de regroupement : l'événement, ou un identifiant nul pour la fin de liaison.
  ev_key uuid not null,
  -- Incrémenté à chaque nouveau changement : un envoi n'est marqué fait que s'il n'y a rien eu de neuf entre-temps.
  generation integer not null default 1,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index nous_outbox_pending on public.nous_outbox (user_id, ev_key) where sent_at is null;
create index nous_outbox_due on public.nous_outbox (next_attempt_at) where sent_at is null;

-- Jeton du cron (lu par la tâche planifiée et vérifié par la fonction ; jamais exposé aux utilisateurs).
create table public.nous_config (
  id integer primary key default 1 check (id = 1),
  cron_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.nous_config default values;

-- ───────────── Mise en file ─────────────

create function public.nous_zero_uuid() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

-- Met en file un envoi pour une personne liée (sans effet si elle ne l'est pas ou a suspendu la synchronisation).
create function public.nous_enqueue_user(p_event uuid, p_user uuid, p_op text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_nous uuid;
begin
  select nous_user_id into v_nous from nous_links where user_id = p_user and sync_enabled;
  if v_nous is null then
    return;
  end if;
  insert into nous_outbox (op, user_id, nous_user_id, event_id, ev_key)
  values (p_op, p_user, v_nous, p_event, p_event)
  on conflict (user_id, ev_key) where sent_at is null
  do update set op = excluded.op, nous_user_id = excluded.nous_user_id, generation = nous_outbox.generation + 1,
    attempts = 0, next_attempt_at = now(), last_error = null;
end $$;

-- Met en file l'état d'un événement pour tous ses participants liés (« remove » si l'événement n'existe plus).
create function public.nous_enqueue_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_op text;
  r record;
begin
  if not exists (select 1 from nous_links) then
    return;
  end if;
  v_op := case when exists (select 1 from events where id = p_event) then 'upsert' else 'remove' end;
  for r in select p.user_id from event_participants p join nous_links l on l.user_id = p.user_id where p.event_id = p_event loop
    perform nous_enqueue_user(p_event, r.user_id, v_op);
  end loop;
end $$;

create function public.nous_events_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.kind, new.title, new.starts_at, new.place, new.description, new.theme, new.status)
     is not distinct from (old.kind, old.title, old.starts_at, old.place, old.description, old.theme, old.status) then
    return null;
  end if;
  perform nous_enqueue_event(new.id);
  return null;
end $$;

-- Avant la suppression (donc avant la cascade sur les participants) : chaque participant lié reçoit « remove ».
create function public.nous_events_deleting() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if exists (select 1 from nous_links) then
    for r in select p.user_id from event_participants p join nous_links l on l.user_id = p.user_id where p.event_id = old.id loop
      perform nous_enqueue_user(old.id, r.user_id, 'remove');
    end loop;
  end if;
  return old;
end $$;

create function public.nous_participants_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform nous_enqueue_user(old.event_id, old.user_id, 'remove');
    -- Les autres participants voient la liste changer (sans effet si l'événement lui-même est en cours de suppression).
    if exists (select 1 from events where id = old.event_id) then
      perform nous_enqueue_event(old.event_id);
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.rsvp, new.role) is not distinct from (old.rsvp, old.role) then
    return null;
  end if;
  perform nous_enqueue_event(new.event_id);
  return null;
end $$;

create function public.nous_wines_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if exists (select 1 from events where id = v_event) then
    perform nous_enqueue_event(v_event);
  end if;
  return null;
end $$;

create trigger events_nous after insert or update on public.events
  for each row execute function public.nous_events_changed();
create trigger events_nous_deleting before delete on public.events
  for each row execute function public.nous_events_deleting();
create trigger event_participants_nous after insert or update or delete on public.event_participants
  for each row execute function public.nous_participants_changed();
create trigger event_wines_nous after insert or update or delete on public.event_wines
  for each row execute function public.nous_wines_changed();

-- Fin de liaison (par la personne, par Nous, ou suppression du compte) : les envois en attente sont abandonnés et,
-- sauf si c'est Nous qui l'a annoncée, Nous est prévenu.
create function public.nous_links_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from nous_outbox where user_id = old.user_id and sent_at is null;
  if coalesce(current_setting('cave.nous_silent', true), '') <> 'on' then
    insert into nous_outbox (op, user_id, nous_user_id, event_id, ev_key)
    values ('unlink', old.user_id, old.nous_user_id, null, nous_zero_uuid());
  end if;
  return null;
end $$;
create trigger nous_links_deleted after delete on public.nous_links
  for each row execute function public.nous_links_deleted();

-- Événements à envoyer lors de la liaison ou de la reprise de la synchronisation : ceux du dernier mois et à venir.
create function public.nous_backfill(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  r record;
begin
  for r in select e.id from events e join event_participants p on p.event_id = e.id
           where p.user_id = p_user and e.starts_at > now() - interval '30 days' loop
    perform nous_enqueue_user(r.id, p_user, 'upsert');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── Fonctions pour la personne connectée ─────────────

-- Crée un code de liaison (30 minutes, usage unique). Le code n'est rendu qu'une fois ; seule son empreinte est gardée.
create function public.nous_link_create() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  v_code := left(v_code, 32);
  if exists (select 1 from nous_links where user_id = v_me) then
    raise exception 'already_linked' using errcode = 'P0001';
  end if;
  if (select count(*) from nous_link_codes where user_id = v_me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
  delete from nous_link_codes where expires_at < now() - interval '1 day';
  insert into nous_link_codes (code_hash, user_id, expires_at)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_me, now() + interval '30 minutes');
  return v_code;
end $$;

-- Délier depuis Cave & Amis : Nous est prévenu par la file (déclencheur nous_links_deleted).
create function public.nous_unlink() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from nous_links where user_id = require_user();
end $$;

-- Suspendre / reprendre l'envoi des événements. La reprise renvoie les événements récents et à venir.
create function public.nous_set_sync(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  update nous_links set sync_enabled = p_enabled where user_id = v_me;
  if not found then
    raise exception 'not_linked' using errcode = 'P0001';
  end if;
  if p_enabled then
    perform nous_backfill(v_me);
  end if;
end $$;

-- ───────────── Fonctions réservées au serveur (cave-api, clé secrète) ─────────────

create function public.nous_code_owner(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from nous_link_codes
  where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex') and used_at is null and expires_at > now()
$$;

-- Prénom et e-mail associés à un code valide : seulement pour pré-remplir l'inscription dans Nous.
create function public.nous_link_peek(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := nous_code_owner(p_code);
begin
  if v_user is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  return (select jsonb_build_object('display_name', p.display_name, 'email', u.email)
          from profiles p join auth.users u on u.id = p.id where p.id = v_user);
end $$;

-- Consomme le code et enregistre la liaison ; met en file les événements récents et à venir.
create function public.nous_link_redeem(p_code text, p_nous_user uuid, p_nous_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex');
  v_user uuid;
begin
  if p_nous_user is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  update nous_link_codes set used_at = now()
  where code_hash = v_hash and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if exists (select 1 from nous_links where user_id = v_user) then
    raise exception 'already_linked' using errcode = 'P0001';
  end if;
  if exists (select 1 from nous_links where nous_user_id = p_nous_user) then
    raise exception 'nous_already_linked' using errcode = 'P0001';
  end if;
  insert into nous_links (user_id, nous_user_id, nous_display_name) values (v_user, p_nous_user, left(nullif(btrim(p_nous_name), ''), 60));
  perform nous_backfill(v_user);
  return (select jsonb_build_object('cave_user_id', p.id, 'display_name', p.display_name) from profiles p where p.id = v_user);
end $$;

-- Vrai si la paire (personne Cave & Amis, personne Nous) est liée.
create function public.nous_link_check(p_user uuid, p_nous_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from nous_links where user_id = p_user and nous_user_id = p_nous_user)
$$;

-- Fin de liaison annoncée par Nous : supprimée sans renvoyer d'annonce.
create function public.nous_link_revoked(p_user uuid, p_nous_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform set_config('cave.nous_silent', 'on', true);
  delete from nous_links where user_id = p_user and nous_user_id = p_nous_user;
  get diagnostics n = row_count;
  perform set_config('cave.nous_silent', 'off', true);
  return n > 0;
end $$;

-- Contenu envoyé à Nous pour une personne : seulement ce qu'elle voit déjà dans Cave & Amis (ni budget, ni prix, ni stock).
-- Null si l'événement n'existe plus ou si elle n'y participe plus (l'envoi devient alors « remove »).
create function public.nous_event_payload(p_event uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e events;
  v_me event_participants;
  v_minutes integer;
begin
  select * into e from events where id = p_event;
  if not found then
    return null;
  end if;
  select * into v_me from event_participants where event_id = p_event and user_id = p_user;
  if not found then
    return null;
  end if;
  -- Cave & Amis ne garde pas d'heure de fin : durée par défaut selon le type.
  v_minutes := case e.kind when 'diner' then 180 when 'degustation' then 150 else 240 end;
  return jsonb_build_object(
    'kind', e.kind,
    'title', e.title,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => v_minutes),
    'timezone', 'Europe/Paris',
    'place', coalesce(e.place, ''),
    'description', coalesce(e.description, ''),
    'theme', coalesce(e.theme, ''),
    'organizer_name', (select display_name from profiles where id = e.organizer_id),
    'is_organizer', e.organizer_id = p_user,
    'my_rsvp', v_me.rsvp,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('name', pr.display_name, 'role', p.role, 'rsvp', p.rsvp)
                       order by p.role desc, pr.display_name)
      from event_participants p join profiles pr on pr.id = p.user_id where p.event_id = p_event), '[]'::jsonb),
    'wines', coalesce((
      select jsonb_agg(jsonb_build_object('name', w.wine_name, 'producer', w.wine_producer, 'vintage', w.wine_vintage,
                                          'color', w.wine_color, 'quantity', w.quantity, 'status', w.status,
                                          'owner_name', pr.display_name)
                       order by w.service_position nulls last, w.created_at)
      from event_wines w left join profiles pr on pr.id = w.owner_id
      where w.event_id = p_event and w.status in ('proposed', 'confirmed', 'consumed')), '[]'::jsonb)
  );
end $$;

-- Version d'un envoi : microsecondes de l'horloge de la base, toujours croissante d'un envoi au suivant.
create function public.nous_version() returns bigint
language sql volatile as $$ select (extract(epoch from clock_timestamp()) * 1000000)::bigint $$;

-- Prend les envois dus (verrou d'une minute pour éviter qu'un second envoi simultané ne les prenne aussi).
create function public.nous_outbox_claim(p_limit integer default 50)
returns table (id bigint, op text, user_id uuid, nous_user_id uuid, event_id uuid, generation integer, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  delete from nous_outbox o where o.sent_at < now() - interval '7 days';
  return query
  update nous_outbox o set next_attempt_at = now() + interval '1 minute'
  where o.id in (
    select x.id from nous_outbox x
    where x.sent_at is null and x.next_attempt_at <= now() and x.attempts < 20
    order by x.next_attempt_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update skip locked)
  returning o.id, o.op, o.user_id, o.nous_user_id, o.event_id, o.generation, o.attempts;
end $$;

-- Résultat d'un envoi. Réussi : marqué fait, sauf si un changement plus récent est arrivé entre-temps (il repart alors).
-- Échoué : nouvelle tentative après 1, 2, 4… minutes (une heure au plus).
create function public.nous_outbox_done(p_id bigint, p_generation integer, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update nous_outbox set sent_at = now(), last_error = null
    where id = p_id and generation = p_generation and sent_at is null;
    if not found then
      update nous_outbox set next_attempt_at = now() where id = p_id and sent_at is null;
    end if;
  else
    update nous_outbox set attempts = attempts + 1, last_error = left(p_error, 300),
      next_attempt_at = now() + make_interval(mins => least(power(2, attempts)::integer, 60))
    where id = p_id and sent_at is null;
  end if;
end $$;

-- Réponse (oui / peut-être / non) donnée dans Nous : appliquée au nom de la personne, avec toutes les règles de
-- respond_event (participant, événement prévu, l'organisateur ne répond pas « non »).
create function public.nous_respond(p_user uuid, p_nous_user uuid, p_event uuid, p_rsvp text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not nous_link_check(p_user, p_nous_user) then
    raise exception 'not_linked' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform respond_event(p_event, p_rsvp);
  perform set_config('request.jwt.claim.sub', '', true);
  return p_rsvp;
end $$;

create function public.nous_cron_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_token) >= 32 and p_token = (select cron_token from nous_config where id = 1), false)
$$;

-- ───────────── Droits ─────────────

alter table public.nous_links enable row level security;
alter table public.nous_link_codes enable row level security;
alter table public.nous_outbox enable row level security;
alter table public.nous_config enable row level security;

create policy nous_links_read on public.nous_links for select to authenticated using (user_id = auth.uid());
-- nous_link_codes, nous_outbox, nous_config : aucune politique pour les utilisateurs (fonctions dédiées).

grant select on public.nous_links to authenticated;

grant execute on function public.nous_link_create(), public.nous_unlink(), public.nous_set_sync(boolean) to authenticated;
-- Les autres fonctions restent réservées au serveur (droits par défaut retirés par la migration initiale).
grant all on public.nous_links, public.nous_link_codes, public.nous_outbox, public.nous_config to service_role;
grant execute on all functions in schema public to service_role;
