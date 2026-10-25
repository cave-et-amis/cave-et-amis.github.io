-- Cave & Amis — contacts et accès à la cave : inviter sans ouvrir sa cave.
--
-- Trois notions séparées :
-- * la RELATION (table friendships, symétrique) : être en contact, s'inviter à un groupe ou à un événement, se voir ;
-- * l'ACCÈS À LA CAVE (nouvelle table cellar_access, à sens unique) : j'ouvre ma cave à X sans que X m'ouvre la sienne ;
--   avec, pour X seulement, des exceptions bouteille par bouteille (masquer / montrer) et un niveau de détail ;
-- * la participation aux groupes et événements, qui ne demande que la relation.
-- Vocabulaire de l'application : « contact » = relation sans cave ouverte ; « ami » = au moins une cave ouverte.
--
-- Aucune lecture de bouteille ne dépend plus de la simple relation : les lots « amis » / « événement », leurs photos,
-- les compteurs et l'assistant passent par can_see_cellar / can_see_lot. Une seule définition (cellar_view) sert la
-- vue réelle (shared_lots) et l'aperçu du propriétaire (preview_my_cellar_as), qui ne peuvent donc pas diverger.
-- Les amitiés existantes reçoivent l'accès dans les deux sens : rien ne change pour les amis actuels.
--
-- Invitations par lien : « découvrir l'application » (relation seule, 10 utilisations, 30 jours), « ami » (relation
-- + accès à ma cave, usage unique, 14 jours), « groupe » et « événement » (relation + invitation, 20 utilisations).
-- Les liens #/ami/CODE déjà envoyés restent valables (type « ami »).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000008_vie_de_groupe.sql (et, si elle est
-- en place, 20261025000007_integration_nous.sql, dont elle ne dépend pas). Rejouable sans danger.

-- ───────────── Tables ─────────────

create table if not exists public.cellar_access (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- « restricted » : prix, quantités exactes et notes toujours masqués pour cette personne.
  detail_level text not null default 'standard' check (detail_level in ('standard', 'restricted')),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index if not exists cellar_access_viewer on public.cellar_access (viewer_id);

-- Exceptions pour une personne : masquer un lot partagé avec mes amis, ou montrer un lot privé.
create table if not exists public.cellar_access_exceptions (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  lot_id uuid not null references public.lots (id) on delete cascade,
  mode text not null check (mode in ('hide', 'show')),
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id, lot_id),
  check (owner_id <> viewer_id)
);
create index if not exists cellar_access_exceptions_viewer on public.cellar_access_exceptions (viewer_id);
create index if not exists cellar_access_exceptions_lot on public.cellar_access_exceptions (lot_id);

-- « Demander à voir la cave de X ».
create table if not exists public.cellar_access_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists cellar_access_requests_pending on public.cellar_access_requests (from_id, to_id) where status = 'pending';
create index if not exists cellar_access_requests_to on public.cellar_access_requests (to_id, status);
create index if not exists cellar_access_requests_from on public.cellar_access_requests (from_id, created_at);

-- Invitations : type, cible, utilisations. Les anciens liens deviennent des liens « ami » à usage unique.
alter table public.friend_invites add column if not exists kind text not null default 'friend'
  check (kind in ('discovery', 'friend', 'group', 'event'));
alter table public.friend_invites add column if not exists target_id uuid;
alter table public.friend_invites add column if not exists max_uses integer not null default 1 check (max_uses between 1 and 50);
alter table public.friend_invites add column if not exists uses integer not null default 0 check (uses >= 0);

create table if not exists public.invite_redemptions (
  invite_id uuid not null references public.friend_invites (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);
create index if not exists invite_redemptions_user on public.invite_redemptions (user_id);

-- Demande de contact : la personne qui demande peut ouvrir sa cave d'emblée.
alter table public.friend_requests add column if not exists open_cellar boolean not null default false;

-- Affichage de la section « Bouteilles partagées par mes amis ».
alter table public.profiles add column if not exists show_shared_wines boolean not null default true;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request'));

-- ───────────── Données existantes (une seule fois) ─────────────

create table if not exists public.migration_marks (name text primary key, done_at timestamptz not null default now());
alter table public.migration_marks enable row level security;

do $$
begin
  if not exists (select 1 from migration_marks where name = 'contacts_acces_cave') then
    -- Chaque amitié existante : les deux caves restent ouvertes l'une à l'autre.
    insert into cellar_access (owner_id, viewer_id, granted_at)
    select user_a, user_b, created_at from friendships
    union all
    select user_b, user_a, created_at from friendships
    on conflict do nothing;
    -- Liens déjà utilisés : une utilisation enregistrée.
    insert into invite_redemptions (invite_id, user_id, redeemed_at)
    select id, responded_by, coalesce(responded_at, created_at) from friend_invites
    where status = 'accepted' and responded_by is not null
    on conflict do nothing;
    update friend_invites set uses = greatest(uses, 1) where status in ('accepted', 'declined');
    insert into migration_marks (name) values ('contacts_acces_cave');
  end if;
end $$;

-- ───────────── Règles internes (non exposées : elles prennent une personne en paramètre) ─────────────

-- Relation entre deux personnes.
create or replace function public.connected_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from friendships where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b)
  )
$$;

-- p_owner a ouvert sa cave à p_viewer : accès accordé, relation en cours, aucun blocage.
create or replace function public.cellar_open_to(p_owner uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cellar_access where owner_id = p_owner and viewer_id = p_viewer)
    and public.connected_between(p_owner, p_viewer)
    and not public.is_blocked_between(p_owner, p_viewer)
$$;

-- Un lot est visible dans la cave ouverte à p_viewer : exception « masquer » ou « montrer » pour cette personne
-- d'abord, sinon le réglage du lot (partagé avec mes amis, ou proposable pour un événement).
create or replace function public.lot_visible_to(p_lot uuid, p_owner uuid, p_visibility text, p_quantity integer, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_viewer is not null and p_owner <> p_viewer and p_quantity > 0
    and public.cellar_open_to(p_owner, p_viewer)
    and coalesce(
      (select e.mode = 'show' from cellar_access_exceptions e where e.owner_id = p_owner and e.viewer_id = p_viewer and e.lot_id = p_lot),
      p_visibility in ('friends', 'event')
    )
$$;

-- Les caves ouvertes à p_viewer (ou celle de p_owner seulement), avec les masques du lot et le niveau de détail.
-- UNE seule définition, pour la vue servie (shared_lots) et l'aperçu du propriétaire (preview_my_cellar_as).
create or replace function public.cellar_view(p_viewer uuid, p_owner uuid)
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
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz,
  origin text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.owner_id, p.display_name, w.id,
    w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation,
    w.color, w.wine_type, w.grapes, w.vintage, w.non_vintage,
    w.label_photo, w.bottle_photo,
    w.drink_from, w.drink_until, w.window_source,
    w.serve_temp_min, w.serve_temp_max, w.aeration, w.pairings,
    l.volume_ml, l.visibility,
    case when l.hide_quantity or r.restricted then null else l.quantity end,
    case when l.hide_quantity or r.restricted then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0,
    case when l.hide_price or r.restricted then null else l.purchase_price end,
    case when l.hide_price or r.restricted then null else l.currency end,
    case when l.hide_notes or r.restricted then null
         else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price or r.restricted, l.hide_quantity or r.restricted, l.hide_notes or r.restricted, l.updated_at,
    -- Origine : le réglage du lot, sinon (lot privé) l'exception « montrer » qui le rend visible.
    case l.visibility when 'friends' then 'friends' when 'event' then 'proposable' else 'exception' end
  from cellar_access a
  cross join lateral (select a.detail_level = 'restricted' as restricted) r
  join lots l on l.owner_id = a.owner_id
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where a.viewer_id = p_viewer
    and (p_owner is null or a.owner_id = p_owner)
    and public.lot_visible_to(l.id, l.owner_id, l.visibility, l.quantity, p_viewer)
$$;

-- La cave d'un groupe telle qu'un membre la voit (même définition pour group_lots et pour l'aperçu).
create or replace function public.group_view(p_group uuid, p_viewer uuid)
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
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz, mine boolean,
  allocated integer
)
language sql stable security definer set search_path = public as $$
  select l.id, l.owner_id, p.display_name, w.id,
    w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation,
    w.color, w.wine_type, w.grapes, w.vintage, w.non_vintage,
    w.label_photo, w.bottle_photo,
    w.drink_from, w.drink_until, w.window_source,
    w.serve_temp_min, w.serve_temp_max, w.aeration, w.pairings,
    l.volume_ml, l.visibility,
    case when l.hide_quantity and l.owner_id <> p_viewer then null else l.quantity end,
    case when l.hide_quantity and l.owner_id <> p_viewer then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0 or s.allocated > 0,
    case when l.hide_price and l.owner_id <> p_viewer then null else l.purchase_price end,
    case when l.hide_price and l.owner_id <> p_viewer then null else l.currency end,
    case when l.hide_notes and l.owner_id <> p_viewer then null
         else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price, l.hide_quantity, l.hide_notes, l.updated_at, l.owner_id = p_viewer,
    -- Le nombre mis à disposition est toujours montré : c'est ce que le propriétaire a choisi d'offrir au groupe.
    s.allocated
  from group_shares s
  join lots l on l.id = s.lot_id
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where s.group_id = p_group and l.quantity > 0
    and exists (select 1 from group_members m where m.group_id = p_group and m.user_id = p_viewer and m.status = 'active')
  order by s.allocated > 0 desc, w.name, w.vintage, p.display_name
$$;

-- ───────────── Règles exposées (pour la personne connectée) ─────────────

create or replace function public.is_connected(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.connected_between(auth.uid(), p_other)
$$;

-- Compatibilité : l'ancien nom désigne désormais la seule relation et ne donne accès à aucune bouteille.
create or replace function public.is_friend(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_connected(p_other)
$$;

create or replace function public.can_see_cellar(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.cellar_open_to(p_owner, auth.uid())
$$;

create or replace function public.can_see_lot(p_lot uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lots l where l.id = p_lot and public.lot_visible_to(l.id, l.owner_id, l.visibility, l.quantity, auth.uid()))
$$;

-- ───────────── Lectures de bouteilles : désormais l'accès à la cave ─────────────

create or replace function public.shared_lots(p_owner uuid default null)
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
  select v.lot_id, v.owner_id, v.owner_name, v.wine_id,
    v.name, v.domaine, v.producer, v.cuvee, v.country, v.region, v.appellation,
    v.color, v.wine_type, v.grapes, v.vintage, v.non_vintage,
    v.label_photo, v.bottle_photo,
    v.drink_from, v.drink_until, v.window_source,
    v.serve_temp_min, v.serve_temp_max, v.aeration, v.pairings,
    v.volume_ml, v.visibility,
    v.quantity, v.available, v.in_stock,
    v.purchase_price, v.currency, v.notes,
    v.hide_price, v.hide_quantity, v.hide_notes, v.updated_at
  from public.cellar_view(auth.uid(), p_owner) v
  where auth.uid() is not null
  order by v.owner_name, v.name, v.vintage
$$;

create or replace function public.group_lots(p_group uuid)
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
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz, mine boolean,
  allocated integer
)
language sql stable security definer set search_path = public as $$
  select * from public.group_view(p_group, auth.uid()) g
  order by g.allocated > 0 desc, g.name, g.vintage, g.owner_name
$$;

-- Photos : celles des bouteilles que je peux voir dans une cave ouverte (au lieu de toute bouteille d'un « ami »).
create or replace function public.can_read_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from wines w
      where (w.label_photo = p_name or w.bottle_photo = p_name or w.bottle_photo_original = p_name)
        and (w.owner_id = auth.uid() or public.can_manage_wine(w.id))
    )
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id
      where (w.label_photo = p_name or w.bottle_photo = p_name) and public.can_see_lot(l.id)
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
    or exists (select 1 from tastings t where t.photo = p_name and t.group_id is not null and public.is_group_member(t.group_id))
    or exists (select 1 from groups g where g.photo = p_name and public.is_group_member(g.id))
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id join group_shares s on s.lot_id = l.id
      where (w.label_photo = p_name or w.bottle_photo = p_name) and l.quantity > 0 and public.is_group_member(s.group_id)
    )
  )
$$;

-- Suggérer la bouteille de quelqu'un pour un événement : « proposable » ET visible dans sa cave qui m'est ouverte
-- (ou, pour la soirée d'un groupe, partagée dans ce groupe). Les vins déjà proposés restent visibles de tous les
-- participants, sans accès à la cave.
create or replace function public.propose_event_wine(p_event uuid, p_lot uuid, p_quantity integer, p_note text, p_bring boolean, p_request uuid)
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
  if v_lot.quantity <= 0 or not (
    (v_lot.visibility = 'event' and public.can_see_lot(v_lot.id))
    or (v_event.group_id is not null and public.is_group_member(v_event.group_id)
        and exists (select 1 from group_shares where lot_id = v_lot.id and group_id = v_event.group_id))
  ) then
    raise exception 'not_proposable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from event_participants where event_id = p_event and user_id = v_lot.owner_id and rsvp <> 'no') then
    raise exception 'owner_not_participant' using errcode = 'P0001';
  end if;
  return event_snapshot_insert(p_event, v_lot, v_me, p_quantity, p_note, p_request);
end $$;

-- ───────────── Invitations à un groupe, un événement, une cave : la relation suffit ─────────────

create or replace function public.can_invite_to_event(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_blocked_between(auth.uid(), p_user) and (
    public.is_connected(p_user)
    or (p_group is not null and exists (select 1 from group_members where group_id = p_group and user_id = p_user and status = 'active'))
  )
$$;

create or replace function public.invite_to_group(p_group uuid, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_user uuid;
  v_count integer := 0;
begin
  if public.group_role(p_group) not in ('admin', 'manager') or public.group_role(p_group) is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from group_members where group_id = p_group) + coalesce(cardinality(p_users), 0) > 50 then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  foreach v_user in array coalesce(p_users, '{}') loop
    continue when v_user = v_me;
    -- Seulement mes relations ; une personne bloquée (dans un sens ou l'autre) n'est jamais invitable.
    if not public.is_connected(v_user) or public.is_blocked_between(v_me, v_user) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    continue when exists (select 1 from group_members where group_id = p_group and user_id = v_user);
    insert into group_members (group_id, user_id, invited_by) values (p_group, v_user, v_me);
    perform public.notify(v_user, 'group_invite', v_me, p_group);
    perform public.group_log(p_group, 'invited', (select display_name from profiles where id = v_user), null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.invite_to_cellar(p_cellar uuid, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_user uuid;
  v_count integer := 0;
begin
  if not exists (select 1 from cellars where id = p_cellar and owner_id = v_me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if (select count(*) from cellar_members where cellar_id = p_cellar) + coalesce(cardinality(p_users), 0) > 10 then
    raise exception 'cellar_members_full' using errcode = 'P0001';
  end if;
  foreach v_user in array coalesce(p_users, '{}') loop
    continue when v_user = v_me;
    -- Seulement mes relations (chacune avec son compte) ; jamais une personne bloquée, dans un sens ou l'autre.
    if not public.is_connected(v_user) or public.is_blocked_between(v_me, v_user) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    continue when exists (select 1 from cellar_members where cellar_id = p_cellar and user_id = v_user);
    insert into cellar_members (cellar_id, user_id, invited_by) values (p_cellar, v_user, v_me);
    perform public.notify(v_user, 'cellar_invite', v_me, p_cellar);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ───────────── Recherche et demandes de contact ─────────────

create or replace function public.search_users(p_query text)
returns table (id uuid, display_name text, relation text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_q text := public.fold_text(regexp_replace(btrim(coalesce(p_query, '')), '[%_\\]', '', 'g'));
begin
  if char_length(v_q) < 3 or char_length(v_q) > 40 then
    return;
  end if;
  return query
  select p.id, p.display_name,
    case
      when public.is_connected(p.id) then
        case when public.cellar_open_to(v_me, p.id) or public.cellar_open_to(p.id, v_me) then 'friend' else 'contact' end
      when exists (select 1 from friend_requests r where r.from_id = v_me and r.to_id = p.id and r.status = 'pending') then 'requested'
      when exists (select 1 from friend_requests r where r.from_id = p.id and r.to_id = v_me and r.status = 'pending') then 'incoming'
      else 'none'
    end
  from profiles p
  where p.discoverable and p.id <> v_me and not public.is_blocked_between(v_me, p.id)
    and public.fold_text(p.display_name) like '%' || v_q || '%'
  order by (public.fold_text(p.display_name) like v_q || '%') desc, p.display_name
  limit 10;
end $$;

-- Demande de contact. p_open_cellar : j'ouvre aussi ma cave à cette personne dès qu'elle accepte.
drop function if exists public.send_friend_request(uuid);
create or replace function public.send_friend_request(p_to uuid, p_open_cellar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req friend_requests;
begin
  if p_to is null or p_to = v_me then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  -- Une personne qui m'a bloqué (ou que j'ai bloquée) est « introuvable » : le blocage n'est jamais révélé.
  if not exists (select 1 from profiles where id = p_to) or public.is_blocked_between(v_me, p_to) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if public.is_connected(p_to) then
    if coalesce(p_open_cellar, false) then
      perform public.grant_cellar_access(p_to);
    end if;
    return jsonb_build_object('status', 'already_friends');
  end if;
  -- Elle m'a déjà fait une demande : nous voilà en relation, chacun ouvrant sa cave s'il l'a choisi.
  select * into v_req from friend_requests where from_id = p_to and to_id = v_me and status = 'pending' for update;
  if found then
    perform public.make_friends(v_me, p_to, p_to);
    if v_req.open_cellar then
      insert into cellar_access (owner_id, viewer_id) values (p_to, v_me) on conflict do nothing;
    end if;
    if coalesce(p_open_cellar, false) then
      perform public.grant_cellar_access(p_to);
    end if;
    update friend_requests set status = 'accepted', responded_at = now() where id = v_req.id;
    perform public.notify(p_to, 'friend_accepted', v_me, v_req.id);
    return jsonb_build_object('status', 'accepted', 'id', v_req.id);
  end if;
  select * into v_req from friend_requests where from_id = v_me and to_id = p_to and status = 'pending';
  if found then
    if coalesce(p_open_cellar, false) and not v_req.open_cellar then
      update friend_requests set open_cellar = true where id = v_req.id;
    end if;
    return jsonb_build_object('status', 'requested', 'id', v_req.id);
  end if;
  if not exists (select 1 from profiles where id = p_to and discoverable) and not public.shares_event(p_to) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from friend_requests
    where from_id = v_me and to_id = p_to and status = 'declined' and responded_at > now() - interval '30 days'
  ) then
    raise exception 'request_cooldown' using errcode = 'P0001';
  end if;
  if (select count(*) from friend_requests where from_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into friend_requests (from_id, to_id, open_cellar) values (v_me, p_to, coalesce(p_open_cellar, false)) returning * into v_req;
  perform public.notify(p_to, 'friend_request', v_me, v_req.id);
  return jsonb_build_object('status', 'requested', 'id', v_req.id);
end $$;

-- Accepter une demande : la relation, et la cave de la personne qui demande si elle a choisi de l'ouvrir.
create or replace function public.respond_friend_request(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req friend_requests;
begin
  select * into v_req from friend_requests where id = p_id and to_id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic : la réponse déjà donnée est renvoyée telle quelle.
  if v_req.status in ('accepted', 'declined') then
    return jsonb_build_object('status', v_req.status, 'friend_id', v_req.from_id);
  end if;
  if v_req.status <> 'pending' or public.is_blocked_between(v_me, v_req.from_id) then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.make_friends(v_me, v_req.from_id, v_req.from_id);
    if v_req.open_cellar then
      insert into cellar_access (owner_id, viewer_id) values (v_req.from_id, v_me) on conflict do nothing;
    end if;
    perform public.notify(v_req.from_id, 'friend_accepted', v_me, v_req.id);
  end if;
  update friend_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'friend_request' and ref_id = p_id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'friend_id', v_req.from_id);
end $$;

-- Mes demandes en attente, avec le choix d'ouvrir sa cave fait par la personne qui demande.
drop function if exists public.my_friend_requests();
create function public.my_friend_requests()
returns table (id uuid, direction text, other_id uuid, other_name text, created_at timestamptz, open_cellar boolean)
language sql stable security definer set search_path = public as $$
  select r.id, case when r.to_id = auth.uid() then 'in' else 'out' end,
    case when r.to_id = auth.uid() then r.from_id else r.to_id end, p.display_name, r.created_at, r.open_cellar
  from friend_requests r
  join profiles p on p.id = case when r.to_id = auth.uid() then r.from_id else r.to_id end
  where r.status = 'pending' and auth.uid() in (r.from_id, r.to_id)
  order by r.created_at desc
$$;

-- Supprimer le contact : plus de relation, donc plus aucun accès ni aucune demande entre nous.
create or replace function public.remove_friend(p_friend uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  delete from friendships where user_a = least(v_me, p_friend) and user_b = greatest(v_me, p_friend);
  delete from cellar_access where (owner_id = v_me and viewer_id = p_friend) or (owner_id = p_friend and viewer_id = v_me);
  delete from cellar_access_exceptions where (owner_id = v_me and viewer_id = p_friend) or (owner_id = p_friend and viewer_id = v_me);
  update cellar_access_requests set status = 'cancelled', responded_at = now()
  where status = 'pending' and ((from_id = v_me and to_id = p_friend) or (from_id = p_friend and to_id = v_me));
end $$;

-- ───────────── Liens d'invitation ─────────────

-- Nouveau lien : « discovery » (relation seule), « friend » (relation + ma cave), « group » (relation + invitation au
-- groupe, administrateur ou gestionnaire), « event » (relation + invitation à l'événement, organisateur).
create or replace function public.create_invite(p_kind text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
  v_code text := '';
  v_invite friend_invites;
  v_event events;
  v_max integer;
  v_expires timestamptz;
begin
  if p_kind is null or p_kind not in ('discovery', 'friend', 'group', 'event') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from friend_invites where inviter_id = v_me and status = 'pending' and expires_at > now() and uses < max_uses) >= 20 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  case p_kind
    when 'discovery' then
      v_max := 10;
      v_expires := now() + interval '30 days';
    when 'friend' then
      v_max := 1;
      v_expires := now() + interval '14 days';
    when 'group' then
      if p_target is null or coalesce(public.group_role(p_target), '') not in ('admin', 'manager') then
        raise exception 'forbidden' using errcode = 'P0001';
      end if;
      v_max := 20;
      v_expires := now() + interval '14 days';
    else
      select * into v_event from events where id = p_target;
      if not found or v_event.organizer_id <> v_me then
        raise exception 'forbidden' using errcode = 'P0001';
      end if;
      if v_event.status <> 'planned' or v_event.starts_at <= now() then
        raise exception 'event_not_planned' using errcode = 'P0001';
      end if;
      v_max := 20;
      -- Valable jusqu'à l'événement.
      v_expires := v_event.starts_at;
  end case;
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  insert into friend_invites (inviter_id, code_hash, kind, target_id, max_uses, expires_at)
  values (v_me, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), p_kind,
          case when p_kind in ('group', 'event') then p_target end, v_max, v_expires)
  returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'code', v_code, 'expires_at', v_invite.expires_at, 'kind', p_kind, 'max_uses', v_max);
end $$;

-- Compatibilité : l'ancien bouton crée un lien « ami ».
create or replace function public.create_friend_invite() returns jsonb
language sql security definer set search_path = public as $$
  select public.create_invite('friend', null)
$$;

-- Lisible sans être connecté (page vitrine du lien) : le prénom de l'inviteur, le type, et pour un groupe son nom,
-- pour un événement son titre et sa date. Jamais d'adresse, d'invités ni de bouteilles.
create or replace function public.friend_invite_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invite friend_invites;
  v_name text;
  v_status text;
  v_label text;
  v_date timestamptz;
  v_result jsonb;
begin
  select * into v_invite from friend_invites where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select split_part(btrim(display_name), ' ', 1) into v_name from profiles where id = v_invite.inviter_id;
  v_status := case
    when v_invite.status = 'revoked' then 'revoked'
    when auth.uid() is not null and exists (select 1 from invite_redemptions r where r.invite_id = v_invite.id and r.user_id = auth.uid()) then 'accepted'
    when v_invite.status = 'declined' and v_invite.responded_by = auth.uid() then 'declined'
    when v_invite.uses >= v_invite.max_uses or v_invite.status in ('accepted', 'declined') then 'used'
    when v_invite.expires_at <= now() then 'expired'
    else 'pending'
  end;
  -- Le nom du groupe, le titre et la date de l'événement : seulement pour un lien encore valable.
  if v_status in ('pending', 'accepted') then
    if v_invite.kind = 'group' then
      select name into v_label from groups where id = v_invite.target_id;
    elsif v_invite.kind = 'event' then
      select title, starts_at into v_label, v_date from events where id = v_invite.target_id;
    end if;
  end if;
  v_result := jsonb_build_object('status', v_status, 'kind', v_invite.kind, 'inviter_name', v_name,
                                 'target_label', v_label, 'target_date', v_date);
  if auth.uid() is not null then
    v_result := v_result || jsonb_build_object(
      'is_self', v_invite.inviter_id = auth.uid(),
      'already_friends', public.connected_between(auth.uid(), v_invite.inviter_id)
    );
  end if;
  return v_result;
end $$;

-- Utiliser un lien. Idempotent : un même compte ne compte qu'une fois, un double clic renvoie la même réponse.
create or replace function public.respond_friend_invite(p_code text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_invite friend_invites;
  v_name text;
  v_event events;
  v_member text;
  v_result jsonb;
begin
  select * into v_invite from friend_invites
  where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex')
  for update;
  if not found or public.is_blocked_between(v_me, v_invite.inviter_id) then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if v_invite.inviter_id = v_me then
    raise exception 'invite_self' using errcode = 'P0001';
  end if;
  select display_name into v_name from profiles where id = v_invite.inviter_id;
  v_result := jsonb_build_object('friend_id', v_invite.inviter_id, 'friend_name', v_name, 'kind', v_invite.kind,
                                 'target_id', case when v_invite.kind in ('group', 'event') then v_invite.target_id end);
  if exists (select 1 from invite_redemptions where invite_id = v_invite.id and user_id = v_me) then
    return v_result || jsonb_build_object('status', 'accepted');
  end if;
  if v_invite.status = 'declined' and v_invite.responded_by = v_me then
    return v_result || jsonb_build_object('status', 'declined');
  end if;
  if v_invite.status = 'revoked' then
    raise exception 'invite_revoked' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' or v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if not p_accept then
    -- Lien à usage unique : il est consommé. Lien réutilisable : rien ne change pour les autres.
    if v_invite.max_uses = 1 then
      update friend_invites set status = 'declined', responded_by = v_me, responded_at = now() where id = v_invite.id;
    end if;
    return v_result || jsonb_build_object('status', 'declined');
  end if;
  -- La cible est vérifiée avant de créer quoi que ce soit.
  if v_invite.kind = 'group' then
    if not exists (select 1 from groups where id = v_invite.target_id) then
      raise exception 'invite_invalid' using errcode = 'P0001';
    end if;
    if not exists (select 1 from group_members where group_id = v_invite.target_id and user_id = v_me)
       and (select count(*) from group_members where group_id = v_invite.target_id) >= 50 then
      raise exception 'group_full' using errcode = 'P0001';
    end if;
  elsif v_invite.kind = 'event' then
    select * into v_event from events where id = v_invite.target_id for update;
    if not found or v_event.status <> 'planned' then
      raise exception 'event_not_planned' using errcode = 'P0001';
    end if;
  end if;
  perform public.make_friends(v_me, v_invite.inviter_id, v_invite.inviter_id);
  if v_invite.kind = 'friend' then
    insert into cellar_access (owner_id, viewer_id) values (v_invite.inviter_id, v_me) on conflict do nothing;
  elsif v_invite.kind = 'group' then
    -- Accepter le lien vaut acceptation de l'invitation : membre actif d'emblée.
    select status into v_member from group_members where group_id = v_invite.target_id and user_id = v_me for update;
    if v_member is null then
      insert into group_members (group_id, user_id, status, invited_by, joined_at)
      values (v_invite.target_id, v_me, 'active', v_invite.inviter_id, now());
    elsif v_member = 'invited' then
      update group_members set status = 'active', joined_at = now() where group_id = v_invite.target_id and user_id = v_me;
      update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'group_invite' and ref_id = v_invite.target_id;
    end if;
    if v_member is distinct from 'active' then
      perform public.group_log(v_invite.target_id, 'joined', (select display_name from profiles where id = v_me), null);
    end if;
  elsif v_invite.kind = 'event' then
    insert into event_participants (event_id, user_id) values (v_invite.target_id, v_me) on conflict do nothing;
    -- L'invitation à l'événement vient d'être acceptée par le lien : sa notification est déjà lue.
    update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'event_invite' and ref_id = v_invite.target_id;
  end if;
  insert into invite_redemptions (invite_id, user_id) values (v_invite.id, v_me);
  update friend_invites
  set uses = uses + 1,
      status = case when uses + 1 >= max_uses then 'accepted' else status end,
      responded_by = v_me, responded_at = now()
  where id = v_invite.id;
  if v_invite.kind = 'group' and v_member is distinct from 'active' then
    perform public.notify(v_invite.inviter_id, 'group_joined', v_me, v_invite.target_id);
  else
    perform public.notify(v_invite.inviter_id, 'invite_joined', v_me, v_invite.id);
  end if;
  return v_result || jsonb_build_object('status', 'accepted');
end $$;

-- ───────────── Ouvrir, fermer, régler l'accès à ma cave ─────────────

create or replace function public.grant_cellar_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if p_user is null or p_user = v_me or not public.connected_between(v_me, p_user) or public.is_blocked_between(v_me, p_user) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  insert into cellar_access (owner_id, viewer_id) values (v_me, p_user) on conflict do nothing;
  if found then
    perform public.notify(p_user, 'cellar_opened', v_me, null);
  end if;
  -- Sa demande d'accès éventuelle est satisfaite.
  update cellar_access_requests set status = 'accepted', responded_at = now() where from_id = p_user and to_id = v_me and status = 'pending';
end $$;

-- Fermer ma cave à une personne : la relation, les groupes et les événements communs restent.
create or replace function public.revoke_cellar_access(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from cellar_access where owner_id = public.require_user() and viewer_id = p_user
$$;

-- « Retirer de mes amis » : plus aucune cave ouverte entre nous, dans un sens ni dans l'autre, ni demande d'accès en
-- attente ; nous restons en contact.
create or replace function public.unfriend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  delete from cellar_access where (owner_id = v_me and viewer_id = p_user) or (owner_id = p_user and viewer_id = v_me);
  update cellar_access_requests set status = 'cancelled', responded_at = now()
  where status = 'pending' and ((from_id = v_me and to_id = p_user) or (from_id = p_user and to_id = v_me));
end $$;

-- « Fermer ma cave à tout le monde » : seulement les accès ; ni les relations, ni les groupes, ni les événements.
create or replace function public.close_my_cellar_to_everyone() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from cellar_access where owner_id = require_user();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.set_cellar_detail_level(p_user uuid, p_level text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_level is null or p_level not in ('standard', 'restricted') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  update cellar_access set detail_level = p_level where owner_id = require_user() and viewer_id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end $$;

-- Exception pour une personne sur un de MES lots : « hide » (masquer un lot partagé), « show » (montrer un lot privé),
-- null pour la retirer.
create or replace function public.set_cellar_exception(p_user uuid, p_lot uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if not exists (select 1 from lots where id = p_lot and owner_id = v_me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_mode is null then
    delete from cellar_access_exceptions where owner_id = v_me and viewer_id = p_user and lot_id = p_lot;
    return;
  end if;
  if p_mode not in ('hide', 'show') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if not public.connected_between(v_me, p_user) or public.is_blocked_between(v_me, p_user) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  if (select count(*) from cellar_access_exceptions where owner_id = v_me and viewer_id = p_user) >= 500 then
    raise exception 'too_many_exceptions' using errcode = 'P0001';
  end if;
  insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode) values (v_me, p_user, p_lot, p_mode)
  on conflict (owner_id, viewer_id, lot_id) do update set mode = excluded.mode, created_at = now();
end $$;

-- « Voir ce que X voit de moi » : MES bouteilles seulement, telles que X les voit vraiment — ma cave (même fonction
-- que la vue servie à X), nos groupes communs (même fonction que group_lots), nos événements communs.
create or replace function public.preview_my_cellar_as(p_viewer uuid)
returns table (
  lot_id uuid, wine_id uuid, name text, producer text, vintage integer, non_vintage boolean, color text, region text,
  appellation text, volume_ml integer, quantity integer, available integer, in_stock boolean,
  purchase_price numeric, currency text, notes text, hide_price boolean, hide_quantity boolean, hide_notes boolean,
  label_photo text, origin text, origin_id uuid, origin_label text, origin_date timestamptz
)
language sql stable security definer set search_path = public as $$
  select x.* from (
    -- Ma cave, telle qu'elle est servie à cette personne (origine : friends, proposable ou exception).
    select v.lot_id, v.wine_id, v.name, coalesce(v.producer, v.domaine) as producer, v.vintage, v.non_vintage, v.color, v.region,
           v.appellation, v.volume_ml, v.quantity, v.available, v.in_stock,
           v.purchase_price, v.currency, v.notes, v.hide_price, v.hide_quantity, v.hide_notes,
           v.label_photo, v.origin, null::uuid as origin_id, null::text as origin_label, null::timestamptz as origin_date
    from public.cellar_view(p_viewer, auth.uid()) v
    union all
    -- Mes bouteilles partagées dans nos groupes communs.
    select g.lot_id, g.wine_id, g.name, coalesce(g.producer, g.domaine), g.vintage, g.non_vintage, g.color, g.region,
           g.appellation, g.volume_ml, g.quantity, g.available, g.in_stock,
           g.purchase_price, g.currency, g.notes, g.hide_price, g.hide_quantity, g.hide_notes,
           g.label_photo, 'group', gr.id, gr.name, null::timestamptz
    from group_members m
    join groups gr on gr.id = m.group_id
    cross join lateral public.group_view(m.group_id, p_viewer) g
    where m.user_id = auth.uid() and m.status = 'active' and g.owner_id = auth.uid()
    union all
    -- Mes vins proposés pour nos événements communs (la « photographie » faite à la proposition).
    select ew.lot_id, null::uuid, ew.wine_name, ew.wine_producer, ew.wine_vintage, ew.wine_non_vintage, ew.wine_color, ew.wine_region,
           ew.wine_appellation, ew.volume_ml, ew.quantity, null::integer, true,
           null::numeric, null::text, ew.note, true, false, false,
           ew.label_photo, 'event', e.id, e.title, e.starts_at
    from event_wines ew
    join events e on e.id = ew.event_id
    where ew.owner_id = auth.uid() and ew.status in ('proposed', 'confirmed', 'consumed', 'not_consumed')
      and exists (select 1 from event_participants p where p.event_id = e.id and p.user_id = p_viewer)
  ) x
  where auth.uid() is not null and p_viewer is distinct from auth.uid()
  order by case x.origin when 'group' then 2 when 'event' then 3 else 1 end, x.origin_label, x.name, x.vintage
$$;

-- Mes relations : qui voit la cave de qui, ce que je montre, les demandes en attente.
create or replace function public.my_relations()
returns table (
  user_id uuid, display_name text, since timestamptz,
  they_see_mine boolean, i_see_theirs boolean, detail_level text, exceptions integer,
  visible_lots integer, visible_bottles integer, shared_with_me integer,
  request_in uuid, request_out uuid
)
language sql stable security definer set search_path = public as $$
  select o.id, p.display_name, f.created_at,
    public.cellar_open_to(auth.uid(), o.id),
    public.cellar_open_to(o.id, auth.uid()),
    a.detail_level,
    (select count(*)::int from cellar_access_exceptions e where e.owner_id = auth.uid() and e.viewer_id = o.id),
    mine.lots, mine.bottles,
    (select count(*)::int from public.cellar_view(auth.uid(), o.id)),
    (select r.id from cellar_access_requests r where r.from_id = o.id and r.to_id = auth.uid() and r.status = 'pending'),
    (select r.id from cellar_access_requests r where r.from_id = auth.uid() and r.to_id = o.id and r.status = 'pending')
  from friendships f
  cross join lateral (select case when f.user_a = auth.uid() then f.user_b else f.user_a end as id) o
  join profiles p on p.id = o.id
  left join cellar_access a on a.owner_id = auth.uid() and a.viewer_id = o.id
  -- Ce que cette personne voit de ma cave (même règle que la vue qui lui est servie) : vins et bouteilles.
  cross join lateral (
    select count(*)::int as lots, coalesce(sum(l.quantity), 0)::int as bottles
    from public.cellar_view(o.id, auth.uid()) v join lots l on l.id = v.lot_id
  ) mine
  where auth.uid() in (f.user_a, f.user_b)
  order by p.display_name
$$;

-- Ce que nous avons en commun : groupes, événements, caves gérées à plusieurs.
create or replace function public.relation_overview(p_other uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.connected_between(auth.uid(), p_other) then jsonb_build_object('connected', false)
  else jsonb_build_object(
    'connected', true,
    'common_groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'emoji', g.emoji) order by g.name)
      from groups g
      where exists (select 1 from group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.status = 'active')
        and exists (select 1 from group_members m where m.group_id = g.id and m.user_id = p_other and m.status = 'active')
    ), '[]'::jsonb),
    'common_events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'status', e.status) order by e.starts_at desc)
      from events e
      where exists (select 1 from event_participants p where p.event_id = e.id and p.user_id = auth.uid())
        and exists (select 1 from event_participants p where p.event_id = e.id and p.user_id = p_other)
    ), '[]'::jsonb),
    'shared_cellars', coalesce((
      select jsonb_agg(jsonb_build_object('cellar_id', c.id, 'cellar_name', c.name, 'mine', c.owner_id = auth.uid(), 'status', m.status))
      from cellar_members m join cellars c on c.id = m.cellar_id
      where (c.owner_id = auth.uid() and m.user_id = p_other) or (c.owner_id = p_other and m.user_id = auth.uid())
    ), '[]'::jsonb)
  ) end
$$;

-- ───────────── Demandes d'accès à une cave ─────────────

create or replace function public.request_cellar_access(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req cellar_access_requests;
begin
  if p_owner is null or p_owner = v_me or public.is_blocked_between(v_me, p_owner) or not public.connected_between(v_me, p_owner) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  if public.cellar_open_to(p_owner, v_me) then
    return jsonb_build_object('status', 'already_open');
  end if;
  select * into v_req from cellar_access_requests where from_id = v_me and to_id = p_owner and status = 'pending';
  if found then
    return jsonb_build_object('status', 'requested', 'id', v_req.id);
  end if;
  if exists (
    select 1 from cellar_access_requests
    where from_id = v_me and to_id = p_owner and status = 'declined' and responded_at > now() - interval '30 days'
  ) then
    raise exception 'request_cooldown' using errcode = 'P0001';
  end if;
  if (select count(*) from cellar_access_requests where from_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into cellar_access_requests (from_id, to_id) values (v_me, p_owner) returning * into v_req;
  perform public.notify(p_owner, 'cellar_access_request', v_me, v_req.id);
  return jsonb_build_object('status', 'requested', 'id', v_req.id);
end $$;

create or replace function public.respond_cellar_access_request(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req cellar_access_requests;
begin
  select * into v_req from cellar_access_requests where id = p_id and to_id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'cellar_access_request' and ref_id = p_id;
  if v_req.status <> 'pending' then
    return jsonb_build_object('status', v_req.status);
  end if;
  if public.is_blocked_between(v_me, v_req.from_id) or not public.connected_between(v_me, v_req.from_id) then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.grant_cellar_access(v_req.from_id);
  end if;
  update cellar_access_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

create or replace function public.cancel_cellar_access_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update cellar_access_requests set status = 'cancelled', responded_at = now()
  where id = p_id and from_id = require_user() and status = 'pending';
  if found then
    delete from notifications where kind = 'cellar_access_request' and ref_id = p_id;
  end if;
end $$;

-- ───────────── Blocage, suppression de compte ─────────────

-- Bloquer quelqu'un supprime aussi les accès, les exceptions et les demandes entre nous (la relation est supprimée
-- par block_user).
create or replace function public.blocks_after_insert_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from cellar_access
  where (owner_id = new.blocker_id and viewer_id = new.blocked_id) or (owner_id = new.blocked_id and viewer_id = new.blocker_id);
  delete from cellar_access_exceptions
  where (owner_id = new.blocker_id and viewer_id = new.blocked_id) or (owner_id = new.blocked_id and viewer_id = new.blocker_id);
  update cellar_access_requests set status = 'cancelled', responded_at = now()
  where status = 'pending'
    and ((from_id = new.blocker_id and to_id = new.blocked_id) or (from_id = new.blocked_id and to_id = new.blocker_id));
  return new;
end $$;
drop trigger if exists blocks_after_insert_access on public.blocks;
create trigger blocks_after_insert_access after insert on public.blocks
for each row execute function public.blocks_after_insert_access();

create or replace function public.prepare_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  r event_wines;
begin
  for r in select * from event_wines where owner_id = v_me and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  update wines set label_photo = null where owner_id <> v_me and label_photo like v_me::text || '/%';
  update wines set bottle_photo = null, bottle_photo_source = null, bottle_photo_credit = null, bottle_photo_original = null
  where owner_id <> v_me and bottle_photo like v_me::text || '/%';
  update wines set bottle_photo_original = null where owner_id <> v_me and bottle_photo_original like v_me::text || '/%';
  delete from group_shares where owner_id = v_me;
  delete from cellar_access where owner_id = v_me or viewer_id = v_me;
  delete from cellar_access_exceptions where owner_id = v_me or viewer_id = v_me;
  delete from cellar_access_requests where from_id = v_me or to_id = v_me;
  -- Suppression explicite dans l'ordre (lots, vins, caves) : la suppression en cascade du compte
  -- se heurterait sinon à la protection « cave non vide ».
  delete from lots where owner_id = v_me;
  delete from wines where owner_id = v_me;
  delete from cellars where owner_id = v_me;
end $$;

-- ───────────── Droits ─────────────

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_connected(id) or public.shares_event(id));

alter table public.cellar_access enable row level security;
alter table public.cellar_access_exceptions enable row level security;
alter table public.cellar_access_requests enable row level security;
alter table public.invite_redemptions enable row level security;

-- Mes réglages ne sont lisibles que par moi : la personne à qui j'ouvre ma cave l'apprend par my_relations, sans
-- voir le niveau de détail ni les exceptions. Toute écriture passe par les fonctions ci-dessus.
drop policy if exists cellar_access_read on public.cellar_access;
create policy cellar_access_read on public.cellar_access for select to authenticated using (owner_id = auth.uid());
drop policy if exists cellar_access_exceptions_read on public.cellar_access_exceptions;
create policy cellar_access_exceptions_read on public.cellar_access_exceptions for select to authenticated using (owner_id = auth.uid());
drop policy if exists cellar_access_requests_read on public.cellar_access_requests;
create policy cellar_access_requests_read on public.cellar_access_requests for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists invite_redemptions_read on public.invite_redemptions;
create policy invite_redemptions_read on public.invite_redemptions for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from friend_invites i where i.id = invite_id and i.inviter_id = auth.uid()));

grant select on public.cellar_access, public.cellar_access_exceptions, public.cellar_access_requests, public.invite_redemptions to authenticated;
grant update (show_shared_wines) on public.profiles to authenticated;

-- Règles internes : jamais appelables directement, elles prennent la personne en paramètre.
revoke execute on function
  public.connected_between(uuid, uuid), public.cellar_open_to(uuid, uuid),
  public.lot_visible_to(uuid, uuid, text, integer, uuid), public.cellar_view(uuid, uuid), public.group_view(uuid, uuid),
  public.blocks_after_insert_access()
from public, anon, authenticated;

grant execute on function
  public.is_connected(uuid), public.can_see_cellar(uuid), public.can_see_lot(uuid),
  public.send_friend_request(uuid, boolean), public.my_friend_requests(), public.create_invite(text, uuid),
  public.grant_cellar_access(uuid), public.revoke_cellar_access(uuid), public.unfriend(uuid), public.close_my_cellar_to_everyone(),
  public.set_cellar_detail_level(uuid, text), public.set_cellar_exception(uuid, uuid, text),
  public.preview_my_cellar_as(uuid), public.my_relations(), public.relation_overview(uuid),
  public.request_cellar_access(uuid), public.respond_cellar_access_request(uuid, boolean), public.cancel_cellar_access_request(uuid)
to authenticated;
