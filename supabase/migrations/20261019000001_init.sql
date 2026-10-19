-- Cave & Amis — schéma initial.
--
-- Principes :
--   * chaque personne possède ses caves, ses fiches de vin, ses lots, ses dégustations : tout est PRIVÉ par défaut ;
--   * un lot peut être « partagé avec mes amis » ou « proposable pour un événement » ; ses amis acceptés le voient alors
--     à travers des fonctions qui masquent le prix, les quantités exactes et les notes si le propriétaire l'a demandé ;
--   * les stocks et les réservations ne changent que par des fonctions transactionnelles : contraintes de la base
--     « jamais de stock négatif » et « jamais plus de réservations que de bouteilles », clés d'idempotence contre les
--     doubles soumissions, une consommation d'événement n'est comptée qu'une seule fois ;
--   * toutes les tables sont protégées par RLS ; les droits sont donnés explicitement en fin de fichier.
--
-- Erreurs métier : « raise exception '<code>' using errcode = 'P0001' » (traduites en français par l'application).

-- ───────────────────────────── Outils ─────────────────────────────

create function public.today_paris() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

create function public.month_start_paris() returns timestamptz
language sql stable as $$
  select (date_trunc('month', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris'
$$;

create function public.require_user() returns uuid
language plpgsql stable as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  return v;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────────── Profils ─────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) < 4000),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cellars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Conditions de conservation : cave naturelle, armoire à vin, pièce à température ambiante…
  storage text not null default 'unknown' check (storage in ('cave', 'armoire', 'piece', 'autre', 'unknown')),
  notes text check (char_length(notes) <= 1000),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index cellars_owner on public.cellars (owner_id);

-- Nouveau compte : profil (le tout premier compte devient administrateur) et une première cave.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_first boolean;
begin
  perform pg_advisory_xact_lock(4242);
  v_name := left(btrim(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1), '')), 40);
  if v_name = '' then
    v_name := 'Amateur';
  end if;
  select not exists (select 1 from profiles) into v_first;
  insert into profiles (id, display_name, is_admin) values (new.id, v_name, v_first);
  insert into cellars (owner_id, name) values (new.id, 'Ma cave');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

-- ───────────────────────────── Amis ─────────────────────────────

-- Une ligne par connexion acceptée ; (user_a, user_b) rangés dans l'ordre pour l'unicité.
create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b on public.friendships (user_b);

-- Invitations par lien ou code (10 caractères, conservé haché, usage unique, valable 14 jours).
create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz
);
create index friend_invites_inviter on public.friend_invites (inviter_id);

create function public.is_friend(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_other is not null and p_other <> auth.uid() and exists (
    select 1 from friendships
    where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other)
  )
$$;

-- ───────────────────────────── Caves, emplacements ─────────────────────────────

create function public.cellars_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from lots where cellar_id = old.id) then
    raise exception 'cellar_not_empty' using errcode = 'P0001';
  end if;
  return old;
end $$;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  cellar_id uuid not null references public.cellars (id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'autre' check (kind in ('armoire', 'casier', 'etagere', 'carton', 'autre')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (cellar_id, name)
);

create function public.locations_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from cellars where id = new.cellar_id and owner_id = new.owner_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
create trigger locations_before before insert or update on public.locations
for each row execute function public.locations_before();

-- ───────────────────────────── Fiches de vin ─────────────────────────────

-- Une fiche = un vin précis (cuvée + millésime). Les bouteilles possédées sont des « lots » (achats successifs).
create table public.wines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  domaine text check (char_length(domaine) <= 120),
  producer text check (char_length(producer) <= 120),
  cuvee text check (char_length(cuvee) <= 120),
  country text check (char_length(country) <= 60),
  region text check (char_length(region) <= 80),
  appellation text check (char_length(appellation) <= 120),
  color text check (color in ('rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre')),
  wine_type text check (wine_type in ('tranquille', 'effervescent', 'moelleux', 'liquoreux', 'fortifie', 'autre')),
  grapes text[] not null default '{}' check (cardinality(grapes) <= 12),
  vintage integer check (vintage between 1800 and 2100),
  non_vintage boolean not null default false,
  -- Photos : chemins dans le stockage privé « photos », toujours dans le dossier du propriétaire.
  label_photo text check (label_photo is null or label_photo like owner_id::text || '/%'),
  bottle_photo text check (bottle_photo is null or bottle_photo like owner_id::text || '/%'),
  -- Conseils, chacun avec son origine : source citée, repère général, estimation de l'IA ou choix personnel.
  drink_from integer check (drink_from between 1800 and 2200),
  drink_until integer check (drink_until between 1800 and 2200),
  window_source text check (window_source in ('source', 'general', 'ai', 'personal')),
  window_note text check (char_length(window_note) <= 200),
  serve_temp_min integer check (serve_temp_min between 0 and 25),
  serve_temp_max integer check (serve_temp_max between 0 and 25),
  temp_source text check (temp_source in ('source', 'general', 'ai', 'personal')),
  aeration text check (char_length(aeration) <= 300),
  aeration_source text check (aeration_source in ('source', 'general', 'ai', 'personal')),
  pairings text check (char_length(pairings) <= 500),
  pairings_source text check (pairings_source in ('source', 'general', 'ai', 'personal')),
  notes text check (char_length(notes) <= 2000),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (non_vintage and vintage is not null)),
  check (drink_from is null or drink_until is null or drink_from <= drink_until),
  check (serve_temp_min is null or serve_temp_max is null or serve_temp_min <= serve_temp_max)
);
create index wines_owner on public.wines (owner_id);
create trigger wines_touch before update on public.wines for each row execute function public.touch_updated_at();

create function public.wines_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
create trigger wines_before before insert or update on public.wines
for each row execute function public.wines_before();

-- ───────────────────────────── Lots ─────────────────────────────

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  wine_id uuid not null references public.wines (id) on delete cascade,
  cellar_id uuid not null references public.cellars (id),
  location_id uuid references public.locations (id) on delete set null,
  volume_ml integer not null default 750 check (volume_ml between 50 and 30000),
  -- Stock physique et bouteilles réservées pour des événements. Disponible = quantity - reserved.
  quantity integer not null default 0 check (quantity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  constraint lots_reserved_le_quantity check (reserved <= quantity),
  purchase_price numeric(10, 2) check (purchase_price >= 0 and purchase_price < 1000000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  purchase_date date,
  purchase_place text check (char_length(purchase_place) <= 120),
  visibility text not null default 'private' check (visibility in ('private', 'friends', 'event')),
  hide_price boolean not null default true,
  hide_quantity boolean not null default false,
  hide_notes boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lots_owner on public.lots (owner_id);
create index lots_wine on public.lots (wine_id);
create index lots_cellar on public.lots (cellar_id);
create trigger lots_touch before update on public.lots for each row execute function public.touch_updated_at();

create function public.lots_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not exists (select 1 from wines where id = new.wine_id and owner_id = new.owner_id)
     or not exists (select 1 from cellars where id = new.cellar_id and owner_id = new.owner_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if new.location_id is not null and not exists (select 1 from locations where id = new.location_id and cellar_id = new.cellar_id) then
    raise exception 'location_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger lots_before before insert or update on public.lots
for each row execute function public.lots_before();

create function public.lots_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.reserved > 0 then
    raise exception 'lot_reserved' using errcode = 'P0001';
  end if;
  -- Les suggestions encore en attente pour ce lot n'ont plus d'objet.
  update event_wines set status = 'released', decided_at = now() where lot_id = old.id and status = 'proposed';
  return old;
end $$;
create trigger lots_before_delete before delete on public.lots
for each row execute function public.lots_before_delete();

create trigger cellars_before_delete before delete on public.cellars
for each row execute function public.cellars_before_delete();

-- ───────────────────────────── Événements ─────────────────────────────

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null default 'diner' check (kind in ('diner', 'degustation', 'anniversaire', 'soiree_theme')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  starts_at timestamptz not null,
  place text check (char_length(place) <= 200),
  description text check (char_length(description) <= 2000),
  theme text check (char_length(theme) <= 120),
  budget numeric(10, 2) check (budget >= 0 and budget < 1000000),
  status text not null default 'planned' check (status in ('planned', 'cancelled', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  closed_at timestamptz
);
create index events_organizer on public.events (organizer_id);
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'guest' check (role in ('organizer', 'guest')),
  rsvp text not null default 'pending' check (rsvp in ('pending', 'yes', 'maybe', 'no')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (event_id, user_id)
);
create index event_participants_user on public.event_participants (user_id);

create function public.is_event_participant(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_participants where event_id = p_event and user_id = auth.uid())
$$;

create function public.is_event_organizer(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events where id = p_event and organizer_id = auth.uid())
$$;

-- Deux personnes participent au même événement (pour afficher leur nom).
create function public.shares_event(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_participants a join event_participants b on b.event_id = a.event_id
    where a.user_id = auth.uid() and b.user_id = p_other
  )
$$;

create table public.event_dishes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  course text not null default 'plat' check (course in ('aperitif', 'entree', 'plat', 'fromage', 'dessert', 'autre')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index event_dishes_event on public.event_dishes (event_id);

create function public.event_dishes_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    if not exists (select 1 from event_participants where event_id = new.event_id and user_id = new.created_by and rsvp <> 'no') then
      raise exception 'not_participant' using errcode = 'P0001';
    end if;
  elsif new.event_id <> old.event_id or new.created_by <> old.created_by then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
create trigger event_dishes_before before insert or update on public.event_dishes
for each row execute function public.event_dishes_before();

-- Vins proposés pour un événement. Les participants ne voient que cette « photographie » du vin
-- (nom, millésime, couleur, propriétaire, quantité prévue), jamais le stock ni le prix du propriétaire.
create table public.event_wines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  lot_id uuid references public.lots (id) on delete set null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- Personne qui a proposé ou suggéré la bouteille (vide si son compte a été supprimé : la proposition reste).
  proposed_by uuid references public.profiles (id) on delete set null,
  quantity integer not null check (quantity between 1 and 24),
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'declined', 'withdrawn', 'released', 'consumed', 'not_consumed')),
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  consumed_qty integer check (consumed_qty >= 0),
  service_position integer,
  note text check (char_length(note) <= 300),
  wine_name text not null,
  wine_producer text,
  wine_vintage integer,
  wine_non_vintage boolean not null default false,
  wine_color text,
  wine_type text,
  wine_region text,
  wine_appellation text,
  wine_grapes text[] not null default '{}',
  volume_ml integer not null default 750,
  label_photo text,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status = 'confirmed') = (reserved_qty > 0))
);
-- Filet de sécurité : une proposition confirmée supprimée (événement supprimé, compte supprimé…) rend ses bouteilles.
create function public.event_wines_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'confirmed' and old.reserved_qty > 0 and old.lot_id is not null then
    update lots set reserved = greatest(reserved - old.reserved_qty, 0) where id = old.lot_id;
  end if;
  return old;
end $$;
create trigger event_wines_after_delete after delete on public.event_wines
for each row execute function public.event_wines_after_delete();
create index event_wines_event on public.event_wines (event_id);
create index event_wines_lot on public.event_wines (lot_id);
create unique index event_wines_active_lot on public.event_wines (event_id, lot_id) where status in ('proposed', 'confirmed');

-- ───────────────────────────── Mouvements de stock ─────────────────────────────

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  lot_id uuid not null references public.lots (id) on delete cascade,
  kind text not null check (kind in ('achat', 'cadeau_recu', 'entree', 'consommation', 'cadeau_offert', 'correction', 'annulation')),
  delta integer not null check (delta <> 0 and delta between -10000 and 10000),
  occurred_on date not null default public.today_paris(),
  note text check (char_length(note) <= 300),
  event_id uuid references public.events (id) on delete set null,
  event_wine_id uuid unique references public.event_wines (id) on delete set null,
  reverses_id uuid unique references public.movements (id) on delete cascade,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (
    (kind in ('achat', 'cadeau_recu', 'entree') and delta > 0)
    or (kind in ('consommation', 'cadeau_offert') and delta < 0)
    or kind in ('correction', 'annulation')
  )
);
create index movements_lot on public.movements (lot_id, created_at);
create index movements_owner on public.movements (owner_id, created_at);

-- ───────────────────────────── Carnet : dégustations et envies ─────────────────────────────

create table public.tastings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  wine_id uuid references public.wines (id) on delete set null,
  lot_id uuid references public.lots (id) on delete set null,
  movement_id uuid references public.movements (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  event_wine_id uuid references public.event_wines (id) on delete set null,
  wine_name text not null check (char_length(btrim(wine_name)) between 1 and 120),
  producer text check (char_length(producer) <= 120),
  vintage integer check (vintage between 1800 and 2100),
  non_vintage boolean not null default false,
  color text check (color in ('rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre')),
  region text check (char_length(region) <= 80),
  appellation text check (char_length(appellation) <= 120),
  grapes text[] not null default '{}' check (cardinality(grapes) <= 12),
  tasted_on date not null default public.today_paris(),
  place text check (char_length(place) <= 120),
  occasion text check (occasion in ('restaurant', 'amis', 'salon', 'maison', 'evenement', 'autre')),
  rating smallint check (rating between 1 and 5),
  comment text check (char_length(comment) <= 3000),
  robe text check (char_length(robe) <= 300),
  nez text check (char_length(nez) <= 500),
  bouche text check (char_length(bouche) <= 500),
  acidite text check (acidite in ('faible', 'moyenne', 'vive')),
  tanins text check (tanins in ('aucun', 'souples', 'presents', 'marques')),
  longueur text check (longueur in ('courte', 'moyenne', 'longue')),
  dish text check (char_length(dish) <= 200),
  price_paid numeric(10, 2) check (price_paid >= 0 and price_paid < 1000000),
  price_kind text check (price_kind in ('verre', 'bouteille_restaurant', 'achat_boutique', 'autre')),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  rebuy boolean not null default false,
  favorite boolean not null default false,
  photo text check (photo is null or photo like user_id::text || '/%'),
  share_with_event boolean not null default false,
  request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not share_with_event or event_id is not null),
  check (not (non_vintage and vintage is not null))
);
create index tastings_user on public.tastings (user_id, tasted_on);
create index tastings_event on public.tastings (event_id);
create trigger tastings_touch before update on public.tastings for each row execute function public.touch_updated_at();

create function public.tastings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if new.wine_id is not null and new.wine_id is distinct from (case when tg_op = 'UPDATE' then old.wine_id end)
     and not exists (select 1 from wines where id = new.wine_id and owner_id = new.user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if new.event_id is not null and new.event_id is distinct from (case when tg_op = 'UPDATE' then old.event_id end)
     and not exists (select 1 from event_participants where event_id = new.event_id and user_id = new.user_id) then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  if new.event_wine_id is not null and not exists (select 1 from event_wines where id = new.event_wine_id and event_id = new.event_id) then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  new.wine_name := btrim(new.wine_name);
  return new;
end $$;
create trigger tastings_before before insert or update on public.tastings
for each row execute function public.tastings_before();

create table public.wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  wine_name text not null check (char_length(btrim(wine_name)) between 1 and 120),
  producer text check (char_length(producer) <= 120),
  vintage integer check (vintage between 1800 and 2100),
  color text check (color in ('rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre')),
  region text check (char_length(region) <= 80),
  appellation text check (char_length(appellation) <= 120),
  note text check (char_length(note) <= 500),
  source_tasting_id uuid references public.tastings (id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index wishlist_user on public.wishlist (user_id);

-- ───────────────────────────── Prix de marché ─────────────────────────────

-- Relevés effectués par la recherche web du serveur (jamais inventés : liens issus de la recherche, date de consultation).
-- Écrits uniquement par le serveur ; l'utilisateur choisit ensuite de les enregistrer comme prix de marché.
create table public.price_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  wine_id uuid not null references public.wines (id) on delete cascade,
  volume_ml integer not null,
  status text not null check (status in ('verified', 'unverified')),
  currency text,
  price_low numeric(10, 2),
  price_high numeric(10, 2),
  offers jsonb not null default '[]'::jsonb check (jsonb_typeof(offers) = 'array'),
  reason text,
  model text,
  created_at timestamptz not null default now(),
  check (status <> 'verified' or (price_low is not null and price_high is not null and currency is not null and jsonb_array_length(offers) >= 1))
);
create index price_checks_user on public.price_checks (user_id, created_at);

create table public.market_prices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  wine_id uuid not null references public.wines (id) on delete cascade,
  volume_ml integer not null default 750 check (volume_ml between 50 and 30000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  price_low numeric(10, 2) not null check (price_low >= 0),
  price_high numeric(10, 2) not null,
  checked_at timestamptz not null default now(),
  -- web : relevé de la recherche web (sources obligatoires) ; manual : prix saisi par la personne.
  method text not null default 'manual' check (method in ('web', 'manual')),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 10),
  note text check (char_length(note) <= 500),
  check_id uuid unique references public.price_checks (id) on delete set null,
  created_at timestamptz not null default now(),
  check (price_low <= price_high),
  check (method <> 'web' or jsonb_array_length(sources) >= 1)
);
create index market_prices_wine on public.market_prices (wine_id, checked_at);

create function public.market_prices_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
begin
  if not exists (select 1 from wines where id = new.wine_id and owner_id = new.owner_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for s in select * from jsonb_array_elements(new.sources) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s ->> 'url', '') !~ '^https?://[^\s]+$' then
      raise exception 'invalid_source' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
create trigger market_prices_before before insert or update on public.market_prices
for each row execute function public.market_prices_before();

-- ───────────────────────────── Photos (stockage privé) ─────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Une photo est lisible par son propriétaire ; par un ami si elle illustre un vin dont un lot lui est partagé ;
-- par les participants d'un événement si elle illustre un vin proposé ou une dégustation partagée de cet événement.
create function public.can_read_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id
      where (w.label_photo = p_name or w.bottle_photo = p_name)
        and l.visibility in ('friends', 'event') and l.quantity > 0 and public.is_friend(w.owner_id)
    )
    or exists (
      select 1 from event_wines ew
      where ew.label_photo = p_name and ew.status in ('proposed', 'confirmed', 'consumed', 'not_consumed')
        and public.is_event_participant(ew.event_id)
    )
    or exists (
      select 1 from tastings t
      where t.photo = p_name and t.share_with_event and public.is_event_participant(t.event_id)
    )
  )
$$;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.can_read_photo(name));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);

-- ───────────────────────────── Assistant IA : réglages, quotas, consommation ─────────────────────────────

-- Une seule ligne. Modifiable uniquement par l'administrateur (fonction admin_update_ai_settings).
create table public.ai_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  model text not null default 'claude-opus-5-5' check (model ~ '^[a-z0-9][a-z0-9.\-]{2,80}$'),
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  max_output_tokens integer not null default 3000 check (max_output_tokens between 256 and 16000),
  max_input_chars integer not null default 2000 check (max_input_chars between 100 and 20000),
  max_image_bytes integer not null default 3000000 check (max_image_bytes between 100000 and 5000000),
  max_api_calls integer not null default 5 check (max_api_calls between 1 and 10),
  history_messages integer not null default 10 check (history_messages between 0 and 40),
  web_search_enabled boolean not null default true,
  max_web_searches integer not null default 3 check (max_web_searches between 0 and 10),
  web_search_token_allowance integer not null default 25000 check (web_search_token_allowance between 1000 and 200000),
  web_search_price_per_1000 numeric(10, 4) not null default 10 check (web_search_price_per_1000 >= 0),
  monthly_budget_usd numeric(10, 2) not null default 20 check (monthly_budget_usd >= 0),
  alert_pct integer not null default 80 check (alert_pct between 1 and 100),
  default_daily_requests integer not null default 30 check (default_daily_requests between 0 and 10000),
  default_monthly_user_usd numeric(10, 2) not null default 3 check (default_monthly_user_usd >= 0),
  rate_per_minute integer not null default 6 check (rate_per_minute between 1 and 120),
  max_concurrent_per_user integer not null default 2 check (max_concurrent_per_user between 1 and 10),
  -- Tarifs en dollars par million de jetons (source : page Pricing d'Anthropic, octobre 2026). Modèle absent = appels refusés.
  prices jsonb not null default '{
    "claude-opus-5-5": {"input": 4, "output": 20, "cache_write": 5, "cache_read": 0.2},
    "claude-sonnet-5-5": {"input": 2, "output": 10, "cache_write": 2.5, "cache_read": 0.1},
    "claude-haiku-5-5": {"input": 0.1, "output": 0.5, "cache_write": 0.125, "cache_read": 0.01},
    "claude-fable-5-1": {"input": 10, "output": 50, "cache_write": 12.5, "cache_read": 0.25}
  }'::jsonb check (jsonb_typeof(prices) = 'object'),
  available_models jsonb not null default '[]'::jsonb,
  key_status text not null default 'unknown' check (key_status in ('unknown', 'ok', 'missing', 'invalid')),
  key_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.ai_settings (id) values (1);

create table public.ai_user_limits (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  daily_requests integer check (daily_requests between 0 and 10000),
  monthly_usd numeric(10, 2) check (monthly_usd >= 0),
  blocked boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Une ligne par demande à l'assistant. Aucun contenu de conversation ici : seulement des compteurs.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('chat', 'label', 'price', 'admin_test')),
  model text,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  api_calls integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_user on public.ai_usage (user_id, created_at);
create index ai_usage_created on public.ai_usage (created_at);
create index ai_usage_open on public.ai_usage (status) where status = 'reserved';

-- Erreurs techniques, sans secret ni contenu privé (le serveur nettoie les messages avant de les écrire).
create table public.ai_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null,
  action text,
  code text not null,
  detail text check (char_length(detail) <= 500),
  model text
);
create index ai_errors_created on public.ai_errors (created_at);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Conversation' check (char_length(title) <= 80),
  context_kind text check (context_kind in ('wine', 'event')),
  context_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user on public.ai_conversations (user_id, updated_at);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 40000),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation on public.ai_messages (conversation_id, created_at);

-- ═════════════════════════════ Fonctions ═════════════════════════════

-- ───────────── Profils et amis ─────────────

create function public.normalize_code(p_code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create function public.create_friend_invite() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
  v_code text := '';
  v_invite friend_invites;
begin
  if (select count(*) from friend_invites where inviter_id = v_me and status = 'pending' and expires_at > now()) >= 20 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  insert into friend_invites (inviter_id, code_hash)
  values (v_me, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'))
  returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'code', v_code, 'expires_at', v_invite.expires_at);
end $$;

-- Lisible sans être connecté : affiche « Bruno vous invite » sur la page d'accueil du lien.
create function public.friend_invite_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invite friend_invites;
  v_name text;
  v_status text;
begin
  select * into v_invite from friend_invites where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select display_name into v_name from profiles where id = v_invite.inviter_id;
  v_status := case when v_invite.status = 'pending' and v_invite.expires_at <= now() then 'expired' else v_invite.status end;
  return jsonb_build_object(
    'status', v_status,
    'inviter_name', v_name,
    'is_self', v_invite.inviter_id = auth.uid(),
    'already_friends', public.is_friend(v_invite.inviter_id)
  );
end $$;

create function public.respond_friend_invite(p_code text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_invite friend_invites;
  v_name text;
begin
  select * into v_invite from friend_invites
  where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex')
  for update;
  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if v_invite.inviter_id = v_me then
    raise exception 'invite_self' using errcode = 'P0001';
  end if;
  select display_name into v_name from profiles where id = v_invite.inviter_id;
  -- Double clic ou nouvel essai : la réponse déjà donnée par cette personne est renvoyée telle quelle.
  if v_invite.status in ('accepted', 'declined') and v_invite.responded_by = v_me then
    return jsonb_build_object('status', v_invite.status, 'friend_id', v_invite.inviter_id, 'friend_name', v_name);
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if p_accept then
    insert into friendships (user_a, user_b, invited_by)
    values (least(v_me, v_invite.inviter_id), greatest(v_me, v_invite.inviter_id), v_invite.inviter_id)
    on conflict do nothing;
  end if;
  update friend_invites
  set status = case when p_accept then 'accepted' else 'declined' end, responded_by = v_me, responded_at = now()
  where id = v_invite.id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'friend_id', v_invite.inviter_id, 'friend_name', v_name);
end $$;

create function public.revoke_friend_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update friend_invites set status = 'revoked'
  where id = p_id and inviter_id = require_user() and status = 'pending';
end $$;

-- Supprimer une connexion : l'accès aux caves partagées est retiré immédiatement, dans les deux sens.
create function public.remove_friend(p_friend uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  delete from friendships where user_a = least(v_me, p_friend) and user_b = greatest(v_me, p_friend);
end $$;

-- Lots partagés par mes amis, avec les masques choisis par chaque propriétaire.
create function public.shared_lots(p_owner uuid default null)
returns table (
  lot_id uuid, owner_id uuid, owner_name text, wine_id uuid,
  name text, domaine text, producer text, cuvee text, country text, region text, appellation text,
  color text, wine_type text, grapes text[], vintage integer, non_vintage boolean,
  label_photo text, bottle_photo text,
  drink_from integer, drink_until integer, window_source text,
  serve_temp_min integer, serve_temp_max integer, aeration text, pairings text,
  volume_ml integer, visibility text,
  quantity integer, available integer, in_stock boolean,
  purchase_price numeric, currency text, notes text,
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.id, l.owner_id, p.display_name, w.id,
    w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation,
    w.color, w.wine_type, w.grapes, w.vintage, w.non_vintage,
    w.label_photo, w.bottle_photo,
    w.drink_from, w.drink_until, w.window_source,
    w.serve_temp_min, w.serve_temp_max, w.aeration, w.pairings,
    l.volume_ml, l.visibility,
    case when l.hide_quantity then null else l.quantity end,
    case when l.hide_quantity then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0,
    case when l.hide_price then null else l.purchase_price end,
    case when l.hide_price then null else l.currency end,
    case when l.hide_notes then null else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price, l.hide_quantity, l.hide_notes, l.updated_at
  from lots l
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where auth.uid() is not null
    and l.owner_id <> auth.uid()
    and l.visibility in ('friends', 'event')
    and l.quantity > 0
    and public.is_friend(l.owner_id)
    and (p_owner is null or l.owner_id = p_owner)
  order by p.display_name, w.name, w.vintage
$$;

-- ───────────── Lots et mouvements ─────────────

create function public.lot_error(p_lot uuid) returns void
language plpgsql as $$
declare
  v lots;
begin
  select * into v from lots where id = p_lot;
  if v.reserved > 0 then
    raise exception 'stock_reserved' using errcode = 'P0001', detail = json_build_object('quantity', v.quantity, 'reserved', v.reserved)::text;
  end if;
  raise exception 'stock_insufficient' using errcode = 'P0001', detail = json_build_object('quantity', v.quantity, 'reserved', v.reserved)::text;
end $$;

-- Entrée ou sortie de stock. Idempotent : la même clé p_request ne compte qu'une fois (double clic, nouvel envoi).
create function public.record_movement(p_lot uuid, p_kind text, p_quantity integer, p_date date, p_note text, p_request uuid)
returns movements
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_mov movements;
  v_delta integer;
begin
  if p_request is null or p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if p_kind not in ('achat', 'cadeau_recu', 'entree', 'consommation', 'cadeau_offert') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or v_lot.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.owner_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_mov;
  end if;
  v_delta := case when p_kind in ('consommation', 'cadeau_offert') then -p_quantity else p_quantity end;
  begin
    update lots set quantity = quantity + v_delta where id = p_lot;
  exception when check_violation then
    perform lot_error(p_lot);
  end;
  insert into movements (owner_id, lot_id, kind, delta, occurred_on, note, request_id)
  values (v_me, p_lot, p_kind, v_delta, coalesce(p_date, today_paris()), nullif(btrim(p_note), ''), p_request)
  returning * into v_mov;
  return v_mov;
end $$;

-- Correction d'inventaire : fixe la quantité exacte (le mouvement enregistre l'écart).
create function public.set_lot_quantity(p_lot uuid, p_quantity integer, p_note text, p_request uuid)
returns movements
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_mov movements;
begin
  if p_request is null or p_quantity is null or p_quantity < 0 or p_quantity > 10000 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or v_lot.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.owner_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_mov;
  end if;
  if p_quantity = v_lot.quantity then
    raise exception 'no_change' using errcode = 'P0001';
  end if;
  begin
    update lots set quantity = p_quantity where id = p_lot;
  exception when check_violation then
    perform lot_error(p_lot);
  end;
  insert into movements (owner_id, lot_id, kind, delta, note, request_id)
  values (v_me, p_lot, 'correction', p_quantity - v_lot.quantity, nullif(btrim(p_note), ''), p_request)
  returning * into v_mov;
  return v_mov;
end $$;

-- Annule un mouvement enregistré par erreur (une seule fois) : mouvement inverse, stock rétabli.
create function public.reverse_movement(p_movement uuid, p_request uuid)
returns movements
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_src movements;
  v_mov movements;
begin
  if p_request is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_src from movements where id = p_movement;
  if not found or v_src.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_src.kind = 'annulation' then
    raise exception 'cannot_reverse' using errcode = 'P0001';
  end if;
  if v_src.event_wine_id is not null then
    perform 1 from event_wines where id = v_src.event_wine_id for update;
  end if;
  perform 1 from lots where id = v_src.lot_id for update;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.owner_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_mov;
  end if;
  if exists (select 1 from movements where reverses_id = p_movement) then
    raise exception 'already_reversed' using errcode = 'P0001';
  end if;
  begin
    update lots set quantity = quantity - v_src.delta where id = v_src.lot_id;
  exception when check_violation then
    perform lot_error(v_src.lot_id);
  end;
  insert into movements (owner_id, lot_id, kind, delta, note, reverses_id, request_id)
  values (v_me, v_src.lot_id, 'annulation', -v_src.delta, 'Annulation d’une saisie', p_movement, p_request)
  returning * into v_mov;
  -- Consommation d'événement annulée : la bouteille est notée « non ouverte », sans nouvelle réservation.
  if v_src.event_wine_id is not null then
    update event_wines set status = 'not_consumed', consumed_qty = 0 where id = v_src.event_wine_id;
  end if;
  return v_mov;
end $$;

-- Nouveau lot d'un vin (achat, cadeau reçu ou bouteilles déjà en cave) avec son mouvement d'entrée.
create function public.create_lot(p jsonb, p_request uuid) returns lots
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_qty integer := coalesce(nullif(p ->> 'quantity', '')::integer, 0);
  v_origin text := coalesce(p ->> 'origin', 'achat');
  v_cellar uuid := nullif(p ->> 'cellar_id', '')::uuid;
begin
  if p_request is null or v_qty < 0 or v_qty > 10000 or v_origin not in ('achat', 'cadeau_recu', 'entree') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where request_id = p_request;
  if found then
    if v_lot.owner_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_lot;
  end if;
  if v_cellar is null then
    select id into v_cellar from cellars where owner_id = v_me order by position, created_at limit 1;
  end if;
  insert into lots (
    owner_id, wine_id, cellar_id, location_id, volume_ml, quantity, purchase_price, currency, purchase_date, purchase_place,
    visibility, hide_price, hide_quantity, hide_notes, notes, request_id
  ) values (
    v_me, (p ->> 'wine_id')::uuid, v_cellar, nullif(p ->> 'location_id', '')::uuid,
    coalesce(nullif(p ->> 'volume_ml', '')::integer, 750), v_qty, nullif(p ->> 'purchase_price', '')::numeric,
    coalesce(nullif(p ->> 'currency', ''), (select currency from profiles where id = v_me), 'EUR'),
    nullif(p ->> 'purchase_date', '')::date, nullif(btrim(p ->> 'purchase_place'), ''),
    coalesce(p ->> 'visibility', 'private'), coalesce((p ->> 'hide_price')::boolean, true),
    coalesce((p ->> 'hide_quantity')::boolean, false), coalesce((p ->> 'hide_notes')::boolean, true),
    nullif(btrim(p ->> 'notes'), ''), p_request
  ) returning * into v_lot;
  if v_qty > 0 then
    insert into movements (owner_id, lot_id, kind, delta, occurred_on, request_id)
    values (v_me, v_lot.id, v_origin, v_qty, coalesce(nullif(p ->> 'purchase_date', '')::date, today_paris()), gen_random_uuid());
  end if;
  return v_lot;
end $$;

-- ───────────── Événements ─────────────

create function public.event_snapshot_insert(
  p_event uuid, p_lot lots, p_proposed_by uuid, p_quantity integer, p_note text, p_request uuid
) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_wine wines;
  v_row event_wines;
begin
  select * into v_wine from wines where id = p_lot.wine_id;
  begin
    insert into event_wines (
      event_id, lot_id, owner_id, proposed_by, quantity, status, note,
      wine_name, wine_producer, wine_vintage, wine_non_vintage, wine_color, wine_type, wine_region, wine_appellation, wine_grapes,
      volume_ml, label_photo, request_id
    ) values (
      p_event, p_lot.id, p_lot.owner_id, p_proposed_by, p_quantity, 'proposed', nullif(btrim(p_note), ''),
      v_wine.name, coalesce(v_wine.producer, v_wine.domaine), v_wine.vintage, v_wine.non_vintage, v_wine.color, v_wine.wine_type,
      v_wine.region, v_wine.appellation, v_wine.grapes, p_lot.volume_ml, v_wine.label_photo, p_request
    ) returning * into v_row;
  exception when unique_violation then
    if exists (select 1 from event_wines where request_id = p_request) then
      select * into v_row from event_wines where request_id = p_request;
      return v_row;
    end if;
    raise exception 'already_proposed' using errcode = 'P0001';
  end;
  return v_row;
end $$;

-- Réservation : bouteilles mises de côté pour l'événement, sans quitter le stock physique.
-- La contrainte « reserved <= quantity » de la base rend tout dépassement impossible, même en cas d'appels simultanés.
create function public.reserve_event_wine(p_row event_wines, p_quantity integer) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_row event_wines;
  v lots;
begin
  if p_quantity < 1 or p_quantity > 24 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if p_row.lot_id is null then
    raise exception 'lot_missing' using errcode = 'P0001';
  end if;
  begin
    update lots set reserved = reserved + p_quantity where id = p_row.lot_id and owner_id = p_row.owner_id;
  exception when check_violation then
    select * into v from lots where id = p_row.lot_id;
    raise exception 'over_reservation' using errcode = 'P0001', detail = json_build_object('available', v.quantity - v.reserved)::text;
  end;
  update event_wines set status = 'confirmed', quantity = p_quantity, reserved_qty = p_quantity, decided_at = now()
  where id = p_row.id returning * into v_row;
  return v_row;
end $$;

create function public.release_event_wine(p_row event_wines, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_row.status = 'confirmed' and p_row.reserved_qty > 0 and p_row.lot_id is not null then
    update lots set reserved = reserved - p_row.reserved_qty where id = p_row.lot_id;
  end if;
  update event_wines set status = p_status, reserved_qty = 0, decided_at = now() where id = p_row.id;
end $$;

create function public.create_event(p jsonb, p_guests uuid[]) returns events
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event events;
  v_guest uuid;
begin
  insert into events (organizer_id, kind, title, starts_at, place, description, theme, budget)
  values (
    v_me, coalesce(p ->> 'kind', 'diner'), btrim(p ->> 'title'), (p ->> 'starts_at')::timestamptz,
    nullif(btrim(p ->> 'place'), ''), nullif(btrim(p ->> 'description'), ''), nullif(btrim(p ->> 'theme'), ''),
    nullif(p ->> 'budget', '')::numeric
  ) returning * into v_event;
  insert into event_participants (event_id, user_id, role, rsvp, responded_at) values (v_event.id, v_me, 'organizer', 'yes', now());
  foreach v_guest in array coalesce(p_guests, '{}') loop
    if not public.is_friend(v_guest) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    insert into event_participants (event_id, user_id) values (v_event.id, v_guest) on conflict do nothing;
  end loop;
  return v_event;
end $$;

create function public.invite_to_event(p_event uuid, p_guests uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_guest uuid;
  v_event events;
begin
  perform require_user();
  select * into v_event from events where id = p_event for update;
  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  foreach v_guest in array coalesce(p_guests, '{}') loop
    if not public.is_friend(v_guest) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    insert into event_participants (event_id, user_id) values (p_event, v_guest) on conflict do nothing;
  end loop;
end $$;

-- Libère tout ce qui concerne une personne qui ne vient plus (ses bouteilles, et les suggestions de ses bouteilles).
create function public.release_participant(p_event uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r event_wines;
begin
  for r in select * from event_wines where event_id = p_event and owner_id = p_user and status in ('proposed', 'confirmed') for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
end $$;

create function public.respond_event(p_event uuid, p_rsvp text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event events;
begin
  if p_rsvp not in ('yes', 'maybe', 'no') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_event from events where id = p_event for update;
  if not found or not exists (select 1 from event_participants where event_id = p_event and user_id = v_me) then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  if v_event.organizer_id = v_me and p_rsvp = 'no' then
    raise exception 'organizer_must_attend' using errcode = 'P0001';
  end if;
  update event_participants set rsvp = p_rsvp, responded_at = now() where event_id = p_event and user_id = v_me;
  if p_rsvp = 'no' then
    perform release_participant(p_event, v_me);
  end if;
end $$;

create function public.remove_participant(p_event uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event events;
begin
  perform require_user();
  select * into v_event from events where id = p_event for update;
  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_user = v_event.organizer_id then
    raise exception 'organizer_must_attend' using errcode = 'P0001';
  end if;
  if v_event.status = 'planned' then
    perform release_participant(p_event, p_user);
  end if;
  delete from event_participants where event_id = p_event and user_id = p_user;
end $$;

-- Proposer une de mes bouteilles (p_bring = je confirme l'apporter : réservation immédiate)
-- ou suggérer une bouteille « proposable » d'un ami participant (son propriétaire devra confirmer).
create function public.propose_event_wine(p_event uuid, p_lot uuid, p_quantity integer, p_note text, p_bring boolean, p_request uuid)
returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event events;
  v_lot lots;
  v_row event_wines;
begin
  if p_request is null or p_quantity is null or p_quantity < 1 or p_quantity > 24 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_row from event_wines where request_id = p_request;
  if found then
    if v_row.proposed_by is distinct from v_me or v_row.event_id <> p_event then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_row;
  end if;
  select * into v_event from events where id = p_event for update;
  if not found or not exists (select 1 from event_participants where event_id = p_event and user_id = v_me and rsvp <> 'no') then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_lot.owner_id = v_me then
    v_row := event_snapshot_insert(p_event, v_lot, v_me, p_quantity, p_note, p_request);
    if p_bring and v_row.status = 'proposed' then
      v_row := reserve_event_wine(v_row, p_quantity);
    end if;
    return v_row;
  end if;
  -- Bouteille d'une autre personne : seulement si elle est « proposable », que nous sommes amis et qu'elle participe.
  if v_lot.visibility <> 'event' or v_lot.quantity <= 0 or not public.is_friend(v_lot.owner_id) then
    raise exception 'not_proposable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from event_participants where event_id = p_event and user_id = v_lot.owner_id and rsvp <> 'no') then
    raise exception 'owner_not_participant' using errcode = 'P0001';
  end if;
  return event_snapshot_insert(p_event, v_lot, v_me, p_quantity, p_note, p_request);
end $$;

-- Le propriétaire accepte d'apporter la bouteille : elle est réservée pour l'événement.
create function public.confirm_event_wine(p_id uuid, p_quantity integer) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_wines;
  v_event events;
begin
  select * into v_row from event_wines where id = p_id for update;
  if not found or v_row.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from events where id = v_row.event_id;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  if v_row.status = 'confirmed' then
    return v_row;
  end if;
  if v_row.status <> 'proposed' then
    raise exception 'wine_status' using errcode = 'P0001';
  end if;
  if not exists (select 1 from event_participants where event_id = v_row.event_id and user_id = v_me and rsvp <> 'no') then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  return reserve_event_wine(v_row, coalesce(p_quantity, v_row.quantity));
end $$;

create function public.decline_event_wine(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row event_wines;
begin
  select * into v_row from event_wines where id = p_id for update;
  if not found or v_row.owner_id <> require_user() then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'declined' then
    return;
  end if;
  if v_row.status <> 'proposed' then
    raise exception 'wine_status' using errcode = 'P0001';
  end if;
  update event_wines set status = 'declined', decided_at = now() where id = p_id;
end $$;

-- Retirer une proposition : par son propriétaire (même confirmée : la réservation est libérée) ou par la personne qui l'a suggérée.
create function public.withdraw_event_wine(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_wines;
begin
  select * into v_row from event_wines where id = p_id for update;
  if not found or not public.is_event_participant(v_row.event_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.status in ('withdrawn', 'released', 'declined') then
    return;
  end if;
  if v_row.status not in ('proposed', 'confirmed') then
    raise exception 'wine_status' using errcode = 'P0001';
  end if;
  if not (v_row.owner_id = v_me or (v_row.proposed_by = v_me and v_row.status = 'proposed')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform release_event_wine(v_row, 'withdrawn');
end $$;

-- Annulation : toutes les réservations de l'événement sont libérées.
create function public.cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event events;
  r event_wines;
begin
  perform require_user();
  select * into v_event from events where id = p_event for update;
  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_event.status = 'cancelled' then
    return;
  end if;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  for r in select * from event_wines where event_id = p_event and status in ('proposed', 'confirmed') for update loop
    perform release_event_wine(r, 'released');
  end loop;
  update events set status = 'cancelled', cancelled_at = now() where id = p_event;
end $$;

create function public.delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event events;
  r event_wines;
begin
  perform require_user();
  select * into v_event from events where id = p_event for update;
  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_event.status = 'done' then
    raise exception 'event_done' using errcode = 'P0001';
  end if;
  for r in select * from event_wines where event_id = p_event and status = 'confirmed' for update loop
    perform release_event_wine(r, 'released');
  end loop;
  delete from events where id = p_event;
end $$;

-- L'événement a eu lieu : les propositions non confirmées sont closes ; chaque propriétaire confirme ensuite
-- ce qui a réellement été bu (les bouteilles restent réservées jusque-là).
create function public.close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event events;
  r event_wines;
begin
  perform require_user();
  select * into v_event from events where id = p_event for update;
  if not found or v_event.organizer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_event.status = 'done' then
    return;
  end if;
  if v_event.status <> 'planned' then
    raise exception 'event_not_planned' using errcode = 'P0001';
  end if;
  if (v_event.starts_at at time zone 'Europe/Paris')::date > today_paris() then
    raise exception 'event_in_future' using errcode = 'P0001';
  end if;
  for r in select * from event_wines where event_id = p_event and status = 'proposed' for update loop
    perform release_event_wine(r, 'released');
  end loop;
  update events set status = 'done', closed_at = now() where id = p_event;
end $$;

-- Après l'événement : bouteilles réellement ouvertes. Le stock n'est mis à jour qu'une seule fois.
create function public.confirm_event_consumption(p_id uuid, p_consumed integer, p_request uuid) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_wines;
  v_event events;
begin
  if p_request is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_row from event_wines where id = p_id for update;
  if not found or v_row.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.status in ('consumed', 'not_consumed') then
    return v_row;
  end if;
  if v_row.status <> 'confirmed' then
    raise exception 'wine_status' using errcode = 'P0001';
  end if;
  select * into v_event from events where id = v_row.event_id;
  if v_event.status <> 'done' then
    raise exception 'event_not_done' using errcode = 'P0001';
  end if;
  if p_consumed is null or p_consumed < 0 or p_consumed > v_row.reserved_qty then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  update lots set reserved = reserved - v_row.reserved_qty, quantity = quantity - p_consumed where id = v_row.lot_id;
  if p_consumed > 0 then
    insert into movements (owner_id, lot_id, kind, delta, occurred_on, note, event_id, event_wine_id, request_id)
    values (v_me, v_row.lot_id, 'consommation', -p_consumed, (v_event.starts_at at time zone 'Europe/Paris')::date,
            left('Événement : ' || v_event.title, 300), v_event.id, v_row.id, p_request);
  end if;
  update event_wines
  set status = case when p_consumed > 0 then 'consumed' else 'not_consumed' end, consumed_qty = p_consumed, reserved_qty = 0, decided_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end $$;

create function public.set_service_order(p_event uuid, p_order uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_event_organizer(p_event) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update event_wines ew set service_position = o.pos
  from unnest(p_order) with ordinality as o(id, pos)
  where ew.id = o.id and ew.event_id = p_event;
end $$;

-- Bouteilles « proposables » des autres participants qui sont mes amis (masques respectés).
create function public.event_suggestable_lots(p_event uuid)
returns table (
  lot_id uuid, owner_id uuid, owner_name text, name text, producer text, vintage integer, non_vintage boolean,
  color text, region text, appellation text, volume_ml integer, quantity integer, available integer, in_stock boolean, label_photo text
)
language sql stable security definer set search_path = public as $$
  select s.lot_id, s.owner_id, s.owner_name, s.name, coalesce(s.producer, s.domaine), s.vintage, s.non_vintage,
         s.color, s.region, s.appellation, s.volume_ml, s.quantity, s.available, s.in_stock, s.label_photo
  from public.shared_lots(null) s
  where public.is_event_participant(p_event)
    and s.visibility = 'event'
    and exists (select 1 from event_participants p where p.event_id = p_event and p.user_id = s.owner_id and p.rsvp <> 'no')
$$;

-- ───────────── Carnet ─────────────

-- Dégustation : ne touche au stock que si l'on indique explicitement le lot de sa cave d'où vient la bouteille.
create function public.create_tasting(p jsonb, p_consume_lot uuid, p_request uuid) returns tastings
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row tastings;
  v_mov movements;
  v_lot lots;
  v_wine uuid := nullif(p ->> 'wine_id', '')::uuid;
begin
  if p_request is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_row from tastings where request_id = p_request;
  if found then
    if v_row.user_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_row;
  end if;
  if p_consume_lot is not null then
    select * into v_lot from lots where id = p_consume_lot and owner_id = v_me;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    v_mov := record_movement(p_consume_lot, 'consommation', 1, nullif(p ->> 'tasted_on', '')::date, 'Dégustation', p_request);
    v_wine := coalesce(v_wine, v_lot.wine_id);
  end if;
  insert into tastings (
    user_id, wine_id, lot_id, movement_id, event_id, event_wine_id, wine_name, producer, vintage, non_vintage, color, region, appellation,
    grapes, tasted_on, place, occasion, rating, comment, robe, nez, bouche, acidite, tanins, longueur, dish, price_paid, price_kind,
    currency, rebuy, favorite, photo, share_with_event, request_id
  ) values (
    v_me, v_wine, p_consume_lot, v_mov.id, nullif(p ->> 'event_id', '')::uuid, nullif(p ->> 'event_wine_id', '')::uuid,
    p ->> 'wine_name', nullif(btrim(p ->> 'producer'), ''), nullif(p ->> 'vintage', '')::integer, coalesce((p ->> 'non_vintage')::boolean, false),
    nullif(p ->> 'color', ''), nullif(btrim(p ->> 'region'), ''), nullif(btrim(p ->> 'appellation'), ''),
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'grapes') = 'array' then p -> 'grapes' else '[]'::jsonb end)), '{}'),
    coalesce(nullif(p ->> 'tasted_on', '')::date, today_paris()), nullif(btrim(p ->> 'place'), ''), nullif(p ->> 'occasion', ''),
    nullif(p ->> 'rating', '')::smallint, nullif(btrim(p ->> 'comment'), ''), nullif(btrim(p ->> 'robe'), ''), nullif(btrim(p ->> 'nez'), ''),
    nullif(btrim(p ->> 'bouche'), ''), nullif(p ->> 'acidite', ''), nullif(p ->> 'tanins', ''), nullif(p ->> 'longueur', ''),
    nullif(btrim(p ->> 'dish'), ''), nullif(p ->> 'price_paid', '')::numeric, nullif(p ->> 'price_kind', ''),
    coalesce(nullif(p ->> 'currency', ''), (select currency from profiles where id = v_me), 'EUR'),
    coalesce((p ->> 'rebuy')::boolean, false), coalesce((p ->> 'favorite')::boolean, false), nullif(p ->> 'photo', ''),
    coalesce((p ->> 'share_with_event')::boolean, false), p_request
  ) returning * into v_row;
  return v_row;
end $$;

-- Enregistre comme prix de marché un relevé vérifié de la recherche web (une seule fois).
create function public.save_price_check(p_check uuid) returns market_prices
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_check price_checks;
  v_row market_prices;
begin
  select * into v_check from price_checks where id = p_check and user_id = v_me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_check.status <> 'verified' then
    raise exception 'price_unverified' using errcode = 'P0001';
  end if;
  select * into v_row from market_prices where check_id = p_check;
  if found then
    return v_row;
  end if;
  insert into market_prices (owner_id, wine_id, volume_ml, currency, price_low, price_high, checked_at, method, sources, check_id)
  values (v_me, v_check.wine_id, v_check.volume_ml, v_check.currency, v_check.price_low, v_check.price_high, v_check.created_at, 'web',
          (select coalesce(jsonb_agg(o), '[]'::jsonb) from (select o from jsonb_array_elements(v_check.offers) o limit 10) x), p_check)
  returning * into v_row;
  return v_row;
end $$;

-- Avant la suppression d'un compte : ses bouteilles réservées pour des événements sont libérées
-- (sinon ses lots ne pourraient pas être supprimés).
create function public.prepare_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  r event_wines;
begin
  for r in select * from event_wines where owner_id = v_me and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  -- Suppression explicite dans l'ordre (lots, vins, caves) : la suppression en cascade du compte
  -- se heurterait sinon à la protection « cave non vide ».
  delete from lots where owner_id = v_me;
  delete from wines where owner_id = v_me;
  delete from cellars where owner_id = v_me;
end $$;

-- ───────────── Assistant IA (appelées par le serveur uniquement, sauf my_ai_status et l'administration) ─────────────

create function public.ai_effective_limits(p_user uuid, out daily integer, out monthly numeric, out blocked boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(l.daily_requests, s.default_daily_requests), coalesce(l.monthly_usd, s.default_monthly_user_usd), coalesce(l.blocked, false)
  from ai_settings s left join ai_user_limits l on l.user_id = p_user
  where s.id = 1
$$;

-- Les demandes restées « en cours » plus de 10 minutes (serveur interrompu) sont closes en comptant
-- prudemment toute l'enveloppe réservée comme dépensée.
create function public.ai_close_stale() returns void
language sql security definer set search_path = public as $$
  update ai_usage set status = 'failed', cost_usd = cost_usd + reserved_usd, reserved_usd = 0, error_code = 'timeout', finished_at = now()
  where status = 'reserved' and created_at < now() - interval '10 minutes'
$$;

-- Début d'une demande : contrôles (activation, blocage, fréquence, appels simultanés, quota du jour, budget de la
-- personne et budget global) puis réservation de l'enveloppe maximale du premier appel. Verrou global : les
-- demandes simultanées sont contrôlées l'une après l'autre.
create function public.ai_begin(p_user uuid, p_action text, p_model text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ai_settings;
  v_lim record;
  v_count integer;
  v_user_month numeric;
  v_month numeric;
  v_id uuid;
begin
  select * into s from ai_settings where id = 1 for update;
  perform ai_close_stale();
  if not s.enabled and p_action <> 'admin_test' then
    return jsonb_build_object('ok', false, 'code', 'ai_disabled');
  end if;
  select * into v_lim from ai_effective_limits(p_user);
  if p_action <> 'admin_test' then
    if v_lim.blocked then
      return jsonb_build_object('ok', false, 'code', 'user_blocked');
    end if;
    select count(*) into v_count from ai_usage where user_id = p_user and created_at > now() - interval '1 minute';
    if v_count >= s.rate_per_minute then
      return jsonb_build_object('ok', false, 'code', 'rate_limited');
    end if;
    select count(*) into v_count from ai_usage where user_id = p_user and status = 'reserved';
    if v_count >= s.max_concurrent_per_user then
      return jsonb_build_object('ok', false, 'code', 'too_many_concurrent');
    end if;
    select count(*) into v_count from ai_usage
    where user_id = p_user and action <> 'admin_test' and (created_at at time zone 'Europe/Paris')::date = today_paris();
    if v_count >= v_lim.daily then
      return jsonb_build_object('ok', false, 'code', 'quota_daily');
    end if;
    select coalesce(sum(cost_usd + reserved_usd), 0) into v_user_month from ai_usage
    where user_id = p_user and created_at >= month_start_paris();
    if v_user_month + p_amount > v_lim.monthly then
      return jsonb_build_object('ok', false, 'code', 'quota_monthly');
    end if;
  end if;
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage where created_at >= month_start_paris();
  if v_month + p_amount > s.monthly_budget_usd then
    return jsonb_build_object('ok', false, 'code', 'budget_exhausted');
  end if;
  insert into ai_usage (user_id, action, model, reserved_usd) values (p_user, p_action, p_model, p_amount) returning id into v_id;
  return jsonb_build_object('ok', true, 'usage_id', v_id);
end $$;

-- Appel supplémentaire dans la même demande (outil, recherche) : nouvelle enveloppe, mêmes plafonds.
create function public.ai_reserve_more(p_usage uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ai_settings;
  u ai_usage;
  v_lim record;
  v_user_month numeric;
  v_month numeric;
begin
  select * into s from ai_settings where id = 1 for update;
  select * into u from ai_usage where id = p_usage for update;
  if not found or u.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'invalid_usage');
  end if;
  if u.action <> 'admin_test' then
    select * into v_lim from ai_effective_limits(u.user_id);
    select coalesce(sum(cost_usd + reserved_usd), 0) into v_user_month from ai_usage
    where user_id = u.user_id and created_at >= month_start_paris();
    if v_user_month + p_amount > v_lim.monthly then
      return jsonb_build_object('ok', false, 'code', 'quota_monthly');
    end if;
  end if;
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage where created_at >= month_start_paris();
  if v_month + p_amount > s.monthly_budget_usd then
    return jsonb_build_object('ok', false, 'code', 'budget_exhausted');
  end if;
  update ai_usage set reserved_usd = reserved_usd + p_amount where id = p_usage;
  return jsonb_build_object('ok', true);
end $$;

-- Après un appel : coût réel ajouté, enveloppe de cet appel libérée.
create function public.ai_settle(
  p_usage uuid, p_cost numeric, p_release numeric, p_input integer, p_output integer, p_cache_read integer, p_cache_write integer,
  p_searches integer
) returns void
language sql security definer set search_path = public as $$
  update ai_usage set
    cost_usd = cost_usd + greatest(p_cost, 0),
    reserved_usd = greatest(reserved_usd - greatest(p_release, 0), 0),
    input_tokens = input_tokens + coalesce(p_input, 0),
    output_tokens = output_tokens + coalesce(p_output, 0),
    cache_read_tokens = cache_read_tokens + coalesce(p_cache_read, 0),
    cache_write_tokens = cache_write_tokens + coalesce(p_cache_write, 0),
    web_searches = web_searches + coalesce(p_searches, 0),
    api_calls = api_calls + 1
  where id = p_usage
$$;

-- Fin de la demande : l'enveloppe restante est rendue.
-- p_keep : le coût réel d'un appel n'a pas pu être enregistré ; l'enveloppe réservée est comptée comme dépensée (prudence).
create function public.ai_finish(p_usage uuid, p_status text, p_error text, p_keep boolean default false) returns void
language sql security definer set search_path = public as $$
  update ai_usage set status = p_status, cost_usd = cost_usd + case when p_keep then reserved_usd else 0 end,
    reserved_usd = 0, error_code = p_error, finished_at = now()
  where id = p_usage and status = 'reserved'
$$;

create function public.ai_log_error(p_user uuid, p_action text, p_code text, p_detail text, p_model text) returns void
language sql security definer set search_path = public as $$
  insert into ai_errors (user_id, action, code, detail, model) values (p_user, p_action, left(p_code, 60), left(p_detail, 500), left(p_model, 80))
$$;

create function public.ai_set_key_status(p_status text, p_models jsonb) returns void
language sql security definer set search_path = public as $$
  update ai_settings set key_status = p_status, key_checked_at = now(),
    available_models = case when p_models is null then available_models else p_models end
  where id = 1
$$;

create function public.ai_config() returns ai_settings
language sql stable security definer set search_path = public as $$
  select * from ai_settings where id = 1
$$;

-- Ce que la personne connectée peut savoir de son accès à l'assistant (sans les montants globaux).
create function public.my_ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  s ai_settings;
  v_lim record;
  v_today integer;
  v_month numeric;
  v_global numeric;
begin
  select * into s from ai_settings where id = 1;
  select * into v_lim from ai_effective_limits(v_me);
  select count(*) into v_today from ai_usage
  where user_id = v_me and action <> 'admin_test' and (created_at at time zone 'Europe/Paris')::date = today_paris();
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage where user_id = v_me and created_at >= month_start_paris();
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_global from ai_usage where created_at >= month_start_paris();
  return jsonb_build_object(
    'enabled', s.enabled,
    'key_status', s.key_status,
    'web_search', s.web_search_enabled and s.max_web_searches > 0,
    'blocked', v_lim.blocked,
    'requests_today', v_today,
    'daily_limit', v_lim.daily,
    'month_pct', case when v_lim.monthly > 0 then round(100 * v_month / v_lim.monthly) else 100 end,
    'budget_reached', v_global >= s.monthly_budget_usd,
    'max_input_chars', s.max_input_chars,
    'max_image_bytes', s.max_image_bytes,
    'is_admin', public.is_admin()
  );
end $$;

-- ───────────── Administration ─────────────

create function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
end $$;

create function public.admin_ai_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s ai_settings;
  v_month jsonb;
  v_users jsonb;
  v_errors jsonb;
  v_days jsonb;
begin
  perform require_admin();
  select * into s from ai_settings where id = 1;
  select jsonb_build_object(
    'cost_usd', coalesce(sum(cost_usd), 0),
    'reserved_usd', coalesce(sum(reserved_usd), 0),
    'requests', count(*) filter (where action <> 'admin_test'),
    'failed', count(*) filter (where status = 'failed'),
    'input_tokens', coalesce(sum(input_tokens), 0),
    'output_tokens', coalesce(sum(output_tokens), 0),
    'web_searches', coalesce(sum(web_searches), 0),
    'in_flight', count(*) filter (where status = 'reserved')
  ) into v_month from ai_usage where created_at >= month_start_paris();
  select coalesce(jsonb_agg(u order by (u ->> 'month_cost_usd')::numeric desc, u ->> 'display_name'), '[]'::jsonb) into v_users from (
    select jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'email', au.email,
      'is_admin', p.is_admin,
      'requests_today', (select count(*) from ai_usage x where x.user_id = p.id and x.action <> 'admin_test'
                          and (x.created_at at time zone 'Europe/Paris')::date = today_paris()),
      'month_requests', (select count(*) from ai_usage x where x.user_id = p.id and x.action <> 'admin_test' and x.created_at >= month_start_paris()),
      'month_cost_usd', (select coalesce(sum(x.cost_usd + x.reserved_usd), 0) from ai_usage x where x.user_id = p.id and x.created_at >= month_start_paris()),
      'daily_limit', (select daily from ai_effective_limits(p.id)),
      'monthly_limit_usd', (select monthly from ai_effective_limits(p.id)),
      'blocked', (select blocked from ai_effective_limits(p.id)),
      'custom', exists (select 1 from ai_user_limits l where l.user_id = p.id)
    ) as u
    from profiles p left join auth.users au on au.id = p.id
  ) t;
  select coalesce(jsonb_agg(e order by e ->> 'created_at' desc), '[]'::jsonb) into v_errors from (
    select jsonb_build_object('created_at', er.created_at, 'action', er.action, 'code', er.code, 'detail', er.detail, 'model', er.model,
                              'user_name', p.display_name) as e
    from ai_errors er left join profiles p on p.id = er.user_id
    order by er.created_at desc limit 50
  ) t;
  select coalesce(jsonb_agg(d order by d ->> 'day'), '[]'::jsonb) into v_days from (
    select jsonb_build_object('day', x.day, 'cost_usd', sum(x.cost_usd + x.reserved_usd), 'requests', count(*)) as d
    from (select (created_at at time zone 'Europe/Paris')::date as day, cost_usd, reserved_usd from ai_usage where created_at >= month_start_paris()) x
    group by x.day
  ) t;
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'updated_by',
    'month', v_month,
    'budget_pct', case when s.monthly_budget_usd > 0
                    then round(100 * ((v_month ->> 'cost_usd')::numeric + (v_month ->> 'reserved_usd')::numeric) / s.monthly_budget_usd)
                    else 100 end,
    'users', v_users,
    'errors', v_errors,
    'days', v_days
  );
end $$;

create function public.admin_update_ai_settings(p jsonb) returns ai_settings
language plpgsql security definer set search_path = public as $$
declare
  v ai_settings;
begin
  perform require_admin();
  update ai_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    model = coalesce(nullif(btrim(p ->> 'model'), ''), model),
    effort = coalesce(p ->> 'effort', effort),
    max_output_tokens = coalesce((p ->> 'max_output_tokens')::integer, max_output_tokens),
    max_input_chars = coalesce((p ->> 'max_input_chars')::integer, max_input_chars),
    max_image_bytes = coalesce((p ->> 'max_image_bytes')::integer, max_image_bytes),
    max_api_calls = coalesce((p ->> 'max_api_calls')::integer, max_api_calls),
    history_messages = coalesce((p ->> 'history_messages')::integer, history_messages),
    web_search_enabled = coalesce((p ->> 'web_search_enabled')::boolean, web_search_enabled),
    max_web_searches = coalesce((p ->> 'max_web_searches')::integer, max_web_searches),
    web_search_token_allowance = coalesce((p ->> 'web_search_token_allowance')::integer, web_search_token_allowance),
    web_search_price_per_1000 = coalesce((p ->> 'web_search_price_per_1000')::numeric, web_search_price_per_1000),
    monthly_budget_usd = coalesce((p ->> 'monthly_budget_usd')::numeric, monthly_budget_usd),
    alert_pct = coalesce((p ->> 'alert_pct')::integer, alert_pct),
    default_daily_requests = coalesce((p ->> 'default_daily_requests')::integer, default_daily_requests),
    default_monthly_user_usd = coalesce((p ->> 'default_monthly_user_usd')::numeric, default_monthly_user_usd),
    rate_per_minute = coalesce((p ->> 'rate_per_minute')::integer, rate_per_minute),
    max_concurrent_per_user = coalesce((p ->> 'max_concurrent_per_user')::integer, max_concurrent_per_user),
    prices = case when jsonb_typeof(p -> 'prices') = 'object' then p -> 'prices' else prices end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into v;
  return v;
end $$;

create function public.admin_set_user_limits(p_user uuid, p_daily integer, p_monthly numeric, p_blocked boolean, p_reset boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_reset then
    delete from ai_user_limits where user_id = p_user;
    return;
  end if;
  insert into ai_user_limits (user_id, daily_requests, monthly_usd, blocked, updated_at)
  values (p_user, p_daily, p_monthly, coalesce(p_blocked, false), now())
  on conflict (user_id) do update set daily_requests = excluded.daily_requests, monthly_usd = excluded.monthly_usd,
    blocked = excluded.blocked, updated_at = now();
end $$;

-- ═════════════════════════════ Droits d'accès (RLS) ═════════════════════════════

alter table public.profiles enable row level security;
alter table public.cellars enable row level security;
alter table public.locations enable row level security;
alter table public.wines enable row level security;
alter table public.lots enable row level security;
alter table public.movements enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_invites enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_dishes enable row level security;
alter table public.event_wines enable row level security;
alter table public.tastings enable row level security;
alter table public.wishlist enable row level security;
alter table public.price_checks enable row level security;
alter table public.market_prices enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_user_limits enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_errors enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Profils : le mien, ceux de mes amis, ceux des personnes avec qui je partage un événement.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_friend(id) or public.shares_event(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Données personnelles : uniquement leur propriétaire.
create policy cellars_own on public.cellars for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy locations_own on public.locations for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy wines_own on public.wines for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lots_read on public.lots for select to authenticated using (owner_id = auth.uid());
create policy lots_update on public.lots for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lots_delete on public.lots for delete to authenticated using (owner_id = auth.uid());
create policy movements_read on public.movements for select to authenticated using (owner_id = auth.uid());
create policy wishlist_own on public.wishlist for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy price_checks_read on public.price_checks for select to authenticated using (user_id = auth.uid());
create policy price_checks_delete on public.price_checks for delete to authenticated using (user_id = auth.uid());
create policy market_prices_read on public.market_prices for select to authenticated using (owner_id = auth.uid());
-- Saisie manuelle seulement : les relevés « web » passent par save_price_check (sources vérifiées par le serveur).
create policy market_prices_insert on public.market_prices for insert to authenticated
  with check (owner_id = auth.uid() and method = 'manual' and check_id is null);
create policy market_prices_update on public.market_prices for update to authenticated
  using (owner_id = auth.uid() and method = 'manual') with check (owner_id = auth.uid() and method = 'manual' and check_id is null);
create policy market_prices_delete on public.market_prices for delete to authenticated using (owner_id = auth.uid());

-- Amis.
create policy friendships_read on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy friend_invites_read on public.friend_invites for select to authenticated
  using (inviter_id = auth.uid());

-- Événements : visibles par leurs participants ; modifiables par l'organisateur.
create policy events_read on public.events for select to authenticated using (public.is_event_participant(id));
create policy events_update on public.events for update to authenticated
  using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());
create policy event_participants_read on public.event_participants for select to authenticated
  using (public.is_event_participant(event_id));
create policy event_dishes_read on public.event_dishes for select to authenticated using (public.is_event_participant(event_id));
create policy event_dishes_insert on public.event_dishes for insert to authenticated with check (public.is_event_participant(event_id));
create policy event_dishes_change on public.event_dishes for update to authenticated
  using (created_by = auth.uid() or public.is_event_organizer(event_id))
  with check (public.is_event_participant(event_id));
create policy event_dishes_delete on public.event_dishes for delete to authenticated
  using (created_by = auth.uid() or public.is_event_organizer(event_id));
create policy event_wines_read on public.event_wines for select to authenticated using (public.is_event_participant(event_id));

-- Dégustations : privées ; partagées avec les participants de l'événement si la personne l'a choisi.
create policy tastings_read on public.tastings for select to authenticated
  using (user_id = auth.uid() or (share_with_event and public.is_event_participant(event_id)));
create policy tastings_update on public.tastings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tastings_delete on public.tastings for delete to authenticated using (user_id = auth.uid());

-- Conversations avec l'assistant : lues et supprimées par leur auteur uniquement (écrites par le serveur).
create policy ai_conversations_own on public.ai_conversations for select to authenticated using (user_id = auth.uid());
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated using (user_id = auth.uid());
create policy ai_messages_own on public.ai_messages for select to authenticated using (user_id = auth.uid());
-- ai_settings, ai_user_limits, ai_usage, ai_errors : aucune politique pour les utilisateurs (fonctions dédiées).

-- ═════════════════════════════ Privilèges ═════════════════════════════

grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated;
-- Objets créés par de futures migrations : aucun droit implicite (chaque migration accorde explicitement ce qu'il faut).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- Le droit d'exécution donné à PUBLIC est global dans PostgreSQL : il se retire sans « in schema ».
alter default privileges revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select on public.profiles to authenticated;
grant update (display_name, currency, preferences) on public.profiles to authenticated;
grant select, insert, update, delete on public.cellars to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, delete on public.wines to authenticated;
grant update (
  name, domaine, producer, cuvee, country, region, appellation, color, wine_type, grapes, vintage, non_vintage,
  label_photo, bottle_photo, drink_from, drink_until, window_source, window_note, serve_temp_min, serve_temp_max, temp_source,
  aeration, aeration_source, pairings, pairings_source, notes, favorite
) on public.wines to authenticated;
grant select, delete on public.lots to authenticated;
grant update (
  wine_id, cellar_id, location_id, volume_ml, purchase_price, currency, purchase_date, purchase_place,
  visibility, hide_price, hide_quantity, hide_notes, notes
) on public.lots to authenticated;
grant select on public.movements to authenticated;
grant select on public.friendships to authenticated;
grant select on public.friend_invites to authenticated;
grant select on public.events to authenticated;
grant update (kind, title, starts_at, place, description, theme, budget) on public.events to authenticated;
grant select on public.event_participants to authenticated;
grant select, insert, delete on public.event_dishes to authenticated;
grant update (course, name, position) on public.event_dishes to authenticated;
grant select on public.event_wines to authenticated;
grant select, delete on public.tastings to authenticated;
grant update (
  wine_name, producer, vintage, non_vintage, color, region, appellation, grapes, tasted_on, place, occasion, rating, comment,
  robe, nez, bouche, acidite, tanins, longueur, dish, price_paid, price_kind, currency, rebuy, favorite, photo, share_with_event
) on public.tastings to authenticated;
grant select, insert, update, delete on public.wishlist to authenticated;
grant select, delete on public.price_checks to authenticated;
grant select, insert, update, delete on public.market_prices to authenticated;
grant select, delete on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

grant execute on function
  public.today_paris(), public.is_friend(uuid), public.is_admin(), public.is_event_participant(uuid), public.is_event_organizer(uuid),
  public.shares_event(uuid), public.can_read_photo(text), public.normalize_code(text),
  public.create_friend_invite(), public.friend_invite_info(text), public.respond_friend_invite(text, boolean),
  public.revoke_friend_invite(uuid), public.remove_friend(uuid), public.shared_lots(uuid),
  public.record_movement(uuid, text, integer, date, text, uuid), public.set_lot_quantity(uuid, integer, text, uuid),
  public.reverse_movement(uuid, uuid), public.create_lot(jsonb, uuid),
  public.create_event(jsonb, uuid[]), public.invite_to_event(uuid, uuid[]), public.respond_event(uuid, text),
  public.remove_participant(uuid, uuid), public.propose_event_wine(uuid, uuid, integer, text, boolean, uuid),
  public.confirm_event_wine(uuid, integer), public.decline_event_wine(uuid), public.withdraw_event_wine(uuid),
  public.cancel_event(uuid), public.delete_event(uuid), public.close_event(uuid),
  public.confirm_event_consumption(uuid, integer, uuid), public.set_service_order(uuid, uuid[]),
  public.event_suggestable_lots(uuid), public.create_tasting(jsonb, uuid, uuid), public.save_price_check(uuid),
  public.prepare_account_deletion(),
  public.my_ai_status(), public.admin_ai_overview(), public.admin_update_ai_settings(jsonb),
  public.admin_set_user_limits(uuid, integer, numeric, boolean, boolean)
to authenticated;
grant execute on function public.friend_invite_info(text), public.normalize_code(text) to anon;
-- Nécessaires aux règles RLS et aux politiques du stockage évaluées pour les utilisateurs.
grant execute on function public.require_user(), public.touch_updated_at() to authenticated;
