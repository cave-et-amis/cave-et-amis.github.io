-- Cave & Amis — notifications push sur téléphone, tablette et ordinateur (standard Web Push).
--
-- * Chaque appareil qui accepte les notifications enregistre son abonnement : l'adresse donnée par le service de
--   notifications de son navigateur (Apple, Google, Mozilla, Microsoft) et deux clés publiques. Le contenu envoyé est
--   chiffré pour cet appareil seul (RFC 8291) : le service de notifications le transmet sans pouvoir le lire.
-- * Chaque notification de l'application (demande de contact, invitation, cave ouverte…) est mise en file pour les
--   appareils de la personne ; la fonction cave-api l'envoie (déclenchement en production : supabase/sql/push-envoi.sql).
-- * Les clés VAPID du serveur (RFC 8292) sont créées par cave-api au premier besoin et gardées ici : jamais lisibles
--   par les utilisateurs ; la clé privée ne sort jamais du serveur.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261029000001_scanner_visites.sql, puis
-- supabase/sql/push-envoi.sql. Rejouable sans danger. Aucune donnée existante n'est modifiée.
-- Retour arrière : supabase/sql/retour-20261030000001.sql.

-- ───────────── Tables ─────────────

-- Un abonnement par appareil (et par navigateur). L'adresse est vérifiée par cave-api avant l'enregistrement : seuls
-- les services de notifications connus sont acceptés.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  label text check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

-- File d'envoi : une ligne par notification à pousser vers les appareils de la personne.
create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists push_outbox_due on public.push_outbox (next_attempt_at) where sent_at is null;

-- Clés VAPID du serveur (une seule paire). Écrites et lues par cave-api seulement (clé secrète du serveur).
create table if not exists public.push_config (
  id integer primary key default 1 check (id = 1),
  vapid_public text not null check (vapid_public ~ '^[A-Za-z0-9_-]{87}$'),
  vapid_private jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;
alter table public.push_config enable row level security;
-- Aucune politique pour les utilisateurs : tout passe par les fonctions ci-dessous.

-- ───────────── Mise en file ─────────────

-- Une notification de l'application part aussi vers les appareils de la personne, s'il y en a.
create or replace function public.push_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_subscriptions s where s.user_id = new.user_id) then
    insert into push_outbox (notification_id, user_id) values (new.id, new.user_id);
  end if;
  return null;
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.push_enqueue();

-- ───────────── Pour la personne connectée ─────────────

-- Mes appareils qui reçoivent les notifications.
create or replace function public.my_push_devices()
returns table (id uuid, label text, endpoint text, created_at timestamptz, last_success_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.label, s.endpoint, s.created_at, s.last_success_at
  from push_subscriptions s
  where s.user_id = auth.uid()
  order by s.created_at desc
$$;

-- Retirer un de mes appareils (par la liste des Réglages).
create or replace function public.remove_push_device(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where id = p_id and user_id = public.require_user()
$$;

-- Retirer cet appareil (désactivation, ou déconnexion : un appareil partagé ne reçoit plus mes notifications).
create or replace function public.remove_push_endpoint(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = public.require_user()
$$;

-- ───────────── Pour cave-api (clé secrète du serveur seulement) ─────────────

-- Enregistre l'abonnement d'un appareil, déjà vérifié par cave-api. Un appareil passé à un autre compte (connexion
-- d'une autre personne) change de propriétaire. 10 appareils au plus par personne : les plus anciens sont retirés.
create or replace function public.push_subscription_save(p_user uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (p_user, p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_label), ''), 60))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, failures = 0
  returning id into v_id;
  delete from push_subscriptions
  where user_id = p_user and id in (select s.id from push_subscriptions s where s.user_id = p_user order by s.created_at desc offset 10);
  return v_id;
end $$;

-- Prend les envois dus (verrou d'une minute contre un second envoi simultané). Une notification déjà lue dans
-- l'application, ou vieille de plus d'un jour, n'est plus poussée.
create or replace function public.push_outbox_claim(p_limit integer default 50)
returns table (id bigint, user_id uuid, attempts integer, notification_id uuid, kind text, actor_id uuid, actor_name text, ref_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  delete from push_outbox o where o.sent_at < now() - interval '2 days';
  update push_outbox o set sent_at = now(), last_error = 'déjà lue ou trop ancienne'
  from notifications n
  where n.id = o.notification_id and o.sent_at is null and (n.read_at is not null or n.created_at < now() - interval '1 day');
  return query
  with claimed as (
    update push_outbox o set next_attempt_at = now() + interval '1 minute'
    where o.id in (
      select x.id from push_outbox x
      where x.sent_at is null and x.next_attempt_at <= now() and x.attempts < 5
      order by x.next_attempt_at
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
      for update skip locked)
    returning o.id, o.user_id, o.attempts, o.notification_id)
  select c.id, c.user_id, c.attempts, c.notification_id, n.kind, n.actor_id, n.actor_name, n.ref_id
  from claimed c join notifications n on n.id = c.notification_id;
end $$;

-- Résultat d'un envoi : réussi, ou nouvelle tentative après 1, 2, 4, 8 minutes (5 essais au plus).
create or replace function public.push_outbox_done(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update push_outbox set sent_at = now(), last_error = left(p_error, 300) where id = p_id and sent_at is null;
  else
    update push_outbox set attempts = attempts + 1, last_error = left(p_error, 300),
      next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 4))::integer)
    where id = p_id and sent_at is null;
  end if;
end $$;

-- Résultat pour un appareil : abonnement expiré ou retiré par le navigateur (gone), ou 10 échecs d'affilée : il est
-- supprimé ; sinon le suivi est mis à jour.
create or replace function public.push_subscription_result(p_id uuid, p_ok boolean, p_gone boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gone then
    delete from push_subscriptions where id = p_id;
  elsif p_ok then
    update push_subscriptions set last_success_at = now(), failures = 0 where id = p_id;
  else
    update push_subscriptions set failures = failures + 1 where id = p_id;
    delete from push_subscriptions where id = p_id and failures >= 10;
  end if;
end $$;

-- ───────────── Droits ─────────────

grant execute on function public.my_push_devices(), public.remove_push_device(uuid), public.remove_push_endpoint(text)
to authenticated;

grant all on public.push_subscriptions, public.push_outbox, public.push_config to service_role;
grant execute on all functions in schema public to service_role;
