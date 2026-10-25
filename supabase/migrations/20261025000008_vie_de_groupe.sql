-- Cave & Amis — phase E « Amis & Groupes » : vie de groupe.
--
-- * Soirées de groupe : un événement peut être rattaché à un groupe (events.group_id). Ses membres peuvent y être invités
--   même s'ils ne sont pas amis de l'organisateur, et y suggérer les bouteilles visibles dans le groupe ; comme toujours,
--   le propriétaire confirme.
-- * Une bouteille mise à disposition du groupe et réservée pour sa soirée est PRISE SUR cette mise à disposition : le
--   compteur unique lots.reserved ne bouge pas, rien n'est compté deux fois. Si elle n'est pas ouverte (soirée annulée,
--   bouteille retirée ou rapportée), elle revient au groupe (event_wines.from_group).
-- * Notes partagées : une dégustation peut être partagée avec un de mes groupes (tastings.group_id), lisible par ses
--   membres ; quitter le groupe retire le partage.
-- * Envies communes : liste d'envies du groupe, avec « je participe ».
-- * L'activité du groupe garde la trace (soirée, bouteille ouverte, note, envie).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000006_caves_partagees.sql.

-- ───────────── Données ─────────────

alter table public.events add column group_id uuid references public.groups (id) on delete set null;
create index events_group on public.events (group_id) where group_id is not null;

alter table public.event_wines add column from_group integer not null default 0 check (from_group >= 0);
alter table public.event_wines add constraint event_wines_from_group_le_reserved check (from_group <= reserved_qty);

alter table public.tastings add column group_id uuid references public.groups (id) on delete set null;
create index tastings_group on public.tastings (group_id, tasted_on) where group_id is not null;
grant update (group_id) on public.tastings to authenticated;

alter table public.group_activity drop constraint group_activity_kind_check;
alter table public.group_activity add constraint group_activity_kind_check
  check (kind in ('created', 'updated', 'invited', 'joined', 'left', 'removed', 'role', 'shared', 'unshared', 'allocated', 'consumed',
                  'event', 'note', 'wish'));

-- L'assistant peut être ouvert depuis la page d'un groupe.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.ai_conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%context_kind%'
  loop
    execute format('alter table public.ai_conversations drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_conversations add constraint ai_conversations_context_kind_check check (context_kind in ('wine', 'event', 'group'));

create table public.group_wishes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  wine_name text not null check (char_length(btrim(wine_name)) between 1 and 120),
  producer text check (char_length(producer) <= 120),
  vintage integer check (vintage between 1800 and 2100),
  color text check (color in ('rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default clock_timestamp()
);
create index group_wishes_group on public.group_wishes (group_id, created_at);

create table public.group_wish_votes (
  wish_id uuid not null references public.group_wishes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wish_id, user_id)
);
create index group_wish_votes_user on public.group_wish_votes (user_id);

alter table public.group_wishes enable row level security;
alter table public.group_wish_votes enable row level security;
create policy group_wishes_read on public.group_wishes for select to authenticated using (public.is_group_member(group_id));
create policy group_wish_votes_read on public.group_wish_votes for select to authenticated
  using (exists (select 1 from group_wishes w where w.id = wish_id and public.is_group_member(w.group_id)));
grant select on public.group_wishes, public.group_wish_votes to authenticated;

-- ───────────── Soirées de groupe : invitations ─────────────

-- Invitable à un événement : un ami, ou, pour la soirée d'un groupe, un membre de ce groupe ; jamais une personne bloquée.
create function public.can_invite_to_event(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_blocked_between(auth.uid(), p_user) and (
    public.is_friend(p_user)
    or (p_group is not null and exists (select 1 from group_members where group_id = p_group and user_id = p_user and status = 'active'))
  )
$$;

create or replace function public.create_event(p jsonb, p_guests uuid[]) returns events
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event events;
  v_guest uuid;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
begin
  -- Soirée d'un groupe : réservée à ses membres.
  if v_group is not null and not public.is_group_member(v_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  insert into events (organizer_id, kind, title, starts_at, place, description, theme, budget, group_id)
  values (
    v_me, coalesce(p ->> 'kind', 'diner'), btrim(p ->> 'title'), (p ->> 'starts_at')::timestamptz,
    nullif(btrim(p ->> 'place'), ''), nullif(btrim(p ->> 'description'), ''), nullif(btrim(p ->> 'theme'), ''),
    nullif(p ->> 'budget', '')::numeric, v_group
  ) returning * into v_event;
  insert into event_participants (event_id, user_id, role, rsvp, responded_at) values (v_event.id, v_me, 'organizer', 'yes', now());
  foreach v_guest in array coalesce(p_guests, '{}') loop
    continue when v_guest = v_me;
    if not public.can_invite_to_event(v_group, v_guest) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    insert into event_participants (event_id, user_id) values (v_event.id, v_guest) on conflict do nothing;
  end loop;
  if v_group is not null then
    perform public.group_log(v_group, 'event', v_event.title, to_char(v_event.starts_at at time zone 'Europe/Paris', 'YYYY-MM-DD'));
  end if;
  return v_event;
end $$;

create or replace function public.invite_to_event(p_event uuid, p_guests uuid[]) returns void
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
    if not public.can_invite_to_event(v_event.group_id, v_guest) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    insert into event_participants (event_id, user_id) values (p_event, v_guest) on conflict do nothing;
  end loop;
end $$;

-- ───────────── Soirées de groupe : bouteilles ─────────────

-- Réservation pour un événement. Soirée d'un groupe : les bouteilles mises à disposition de ce groupe sont prises en
-- premier (elles sont déjà comptées dans lots.reserved), le reste sur les bouteilles libres.
create or replace function public.reserve_event_wine(p_row event_wines, p_quantity integer) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_row event_wines;
  v lots;
  v_group uuid;
  v_take integer := 0;
begin
  if p_quantity < 1 or p_quantity > 24 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if p_row.lot_id is null then
    raise exception 'lot_missing' using errcode = 'P0001';
  end if;
  select group_id into v_group from events where id = p_row.event_id;
  if v_group is not null then
    select least(allocated, p_quantity) into v_take from group_shares where lot_id = p_row.lot_id and group_id = v_group for update;
    v_take := coalesce(v_take, 0);
    if v_take > 0 then
      update group_shares set allocated = allocated - v_take where lot_id = p_row.lot_id and group_id = v_group;
    end if;
  end if;
  begin
    update lots set reserved = reserved + (p_quantity - v_take) where id = p_row.lot_id and owner_id = p_row.owner_id;
  exception when check_violation then
    select * into v from lots where id = p_row.lot_id;
    raise exception 'over_reservation' using errcode = 'P0001', detail = json_build_object('available', v.quantity - v.reserved + v_take)::text;
  end;
  update event_wines set status = 'confirmed', quantity = p_quantity, reserved_qty = p_quantity, from_group = v_take, decided_at = now()
  where id = p_row.id returning * into v_row;
  return v_row;
end $$;

-- Libération : les bouteilles prises sur la mise à disposition reviennent au groupe (si elle existe encore), les autres
-- redeviennent libres.
create or replace function public.release_event_wine(p_row event_wines, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_back integer := 0;
begin
  if p_row.status = 'confirmed' and p_row.reserved_qty > 0 and p_row.lot_id is not null then
    if p_row.from_group > 0 then
      update group_shares set allocated = allocated + p_row.from_group
      where lot_id = p_row.lot_id and group_id = (select group_id from events where id = p_row.event_id);
      if found then
        v_back := p_row.from_group;
      end if;
    end if;
    update lots set reserved = reserved - (p_row.reserved_qty - v_back) where id = p_row.lot_id;
  end if;
  update event_wines set status = p_status, reserved_qty = 0, from_group = 0, decided_at = now() where id = p_row.id;
end $$;

create or replace function public.event_wines_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_back integer := 0;
begin
  if old.status = 'confirmed' and old.reserved_qty > 0 and old.lot_id is not null then
    if old.from_group > 0 then
      update group_shares set allocated = allocated + old.from_group
      where lot_id = old.lot_id and group_id = (select group_id from events where id = old.event_id);
      if found then
        v_back := old.from_group;
      end if;
    end if;
    update lots set reserved = greatest(reserved - (old.reserved_qty - v_back), 0) where id = old.lot_id;
  end if;
  return old;
end $$;

-- Après l'événement : les bouteilles ouvertes sortent du stock une seule fois ; celles prises sur la mise à disposition
-- d'un groupe et restées fermées lui reviennent.
create or replace function public.confirm_event_consumption(p_id uuid, p_consumed integer, p_request uuid) returns event_wines
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_wines;
  v_event events;
  v_back integer := 0;
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
  if v_row.from_group > 0 and v_row.reserved_qty > p_consumed then
    update group_shares set allocated = allocated + least(v_row.from_group, v_row.reserved_qty - p_consumed)
    where lot_id = v_row.lot_id and group_id = v_event.group_id;
    if found then
      v_back := least(v_row.from_group, v_row.reserved_qty - p_consumed);
    end if;
  end if;
  update lots set reserved = reserved - (v_row.reserved_qty - v_back), quantity = quantity - p_consumed where id = v_row.lot_id;
  if p_consumed > 0 then
    insert into movements (owner_id, lot_id, kind, delta, occurred_on, note, event_id, event_wine_id, request_id)
    values (v_me, v_row.lot_id, 'consommation', -p_consumed, (v_event.starts_at at time zone 'Europe/Paris')::date,
            left('Événement : ' || v_event.title, 300), v_event.id, v_row.id, p_request);
    if v_event.group_id is not null and public.is_group_member(v_event.group_id) then
      perform public.group_log(v_event.group_id, 'consumed', concat_ws(' ', v_row.wine_name, v_row.wine_vintage::text), p_consumed::text);
    end if;
  end if;
  update event_wines
  set status = case when p_consumed > 0 then 'consumed' else 'not_consumed' end, consumed_qty = p_consumed, reserved_qty = 0,
      from_group = 0, decided_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end $$;

-- Proposer une bouteille : la sienne ; celle d'un ami participant, si elle est « proposable » ; ou, pour la soirée d'un
-- groupe, une bouteille visible dans ce groupe dont le propriétaire participe. Le propriétaire confirme toujours.
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
    (v_lot.visibility = 'event' and public.is_friend(v_lot.owner_id))
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

-- Bouteilles qu'on peut suggérer pour un événement : les « proposables » des amis participants et, pour la soirée d'un
-- groupe, celles visibles dans le groupe (for_group : combien sont mises à sa disposition).
drop function public.event_suggestable_lots(uuid);
create function public.event_suggestable_lots(p_event uuid)
returns table (
  lot_id uuid, owner_id uuid, owner_name text, name text, producer text, vintage integer, non_vintage boolean,
  color text, region text, appellation text, volume_ml integer, quantity integer, available integer, in_stock boolean, label_photo text,
  for_group integer
)
language sql stable security definer set search_path = public as $$
  select distinct on (x.lot_id) x.*
  from (
    select s.lot_id, s.owner_id, s.owner_name, s.name, coalesce(s.producer, s.domaine) as producer, s.vintage, s.non_vintage,
           s.color, s.region, s.appellation, s.volume_ml, s.quantity, s.available, s.in_stock, s.label_photo, null::integer as for_group
    from public.shared_lots(null) s
    where public.is_event_participant(p_event)
      and s.visibility = 'event'
      and exists (select 1 from event_participants p where p.event_id = p_event and p.user_id = s.owner_id and p.rsvp <> 'no')
    union all
    select g.lot_id, g.owner_id, g.owner_name, g.name, coalesce(g.producer, g.domaine), g.vintage, g.non_vintage,
           g.color, g.region, g.appellation, g.volume_ml, g.quantity, g.available, g.in_stock, g.label_photo, g.allocated
    from events e cross join lateral public.group_lots(e.group_id) g
    where e.id = p_event and e.group_id is not null and public.is_event_participant(p_event) and not g.mine
      and exists (select 1 from event_participants p where p.event_id = p_event and p.user_id = g.owner_id and p.rsvp <> 'no')
  ) x
  order by x.lot_id, x.for_group nulls last
$$;

-- ───────────── Notes partagées avec un groupe ─────────────

create or replace function public.tastings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- Une dégustation peut renvoyer à une fiche de ma cave, ou d'une cave à laquelle je suis associé.
  if new.wine_id is not null and new.wine_id is distinct from (case when tg_op = 'UPDATE' then old.wine_id end)
     and not exists (select 1 from wines where id = new.wine_id and owner_id = new.user_id)
     and not public.can_manage_wine(new.wine_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if new.event_id is not null and new.event_id is distinct from (case when tg_op = 'UPDATE' then old.event_id end)
     and not exists (select 1 from event_participants where event_id = new.event_id and user_id = new.user_id) then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  if new.event_wine_id is not null and not exists (select 1 from event_wines where id = new.event_wine_id and event_id = new.event_id) then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  -- Partage avec un groupe : seulement un groupe dont je suis membre.
  if new.group_id is not null and new.group_id is distinct from (case when tg_op = 'UPDATE' then old.group_id end)
     and not exists (select 1 from group_members where group_id = new.group_id and user_id = new.user_id and status = 'active') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.wine_name := btrim(new.wine_name);
  return new;
end $$;

-- Note partagée avec le groupe : l'activité du groupe la signale.
create function public.tastings_after_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and (tg_op = 'INSERT' or new.group_id is distinct from old.group_id) then
    perform public.group_log(new.group_id, 'note', concat_ws(' ', new.wine_name, new.vintage::text), new.rating::text);
  end if;
  return new;
end $$;
create trigger tastings_after_group after insert or update of group_id on public.tastings
for each row execute function public.tastings_after_group();

create or replace function public.create_tasting(p jsonb, p_consume_lot uuid, p_request uuid) returns tastings
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
    select * into v_lot from lots where id = p_consume_lot and (owner_id = v_me or public.is_cellar_member(cellar_id));
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    v_mov := record_movement(p_consume_lot, 'consommation', 1, nullif(p ->> 'tasted_on', '')::date, 'Dégustation', p_request);
    v_wine := coalesce(v_wine, v_lot.wine_id);
  end if;
  insert into tastings (
    user_id, wine_id, lot_id, movement_id, event_id, event_wine_id, wine_name, producer, vintage, non_vintage, color, region, appellation,
    grapes, tasted_on, place, occasion, rating, comment, robe, nez, bouche, acidite, tanins, longueur, dish, price_paid, price_kind,
    currency, rebuy, favorite, photo, share_with_event, group_id, request_id
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
    coalesce((p ->> 'share_with_event')::boolean, false), nullif(p ->> 'group_id', '')::uuid, p_request
  ) returning * into v_row;
  return v_row;
end $$;

-- Notes partagées avec le groupe, avec le nom de leur auteur (même s'il n'est pas mon ami).
create function public.group_notes(p_group uuid)
returns table (
  id uuid, user_id uuid, author_name text, wine_name text, producer text, vintage integer, non_vintage boolean, color text,
  region text, appellation text, rating smallint, comment text, dish text, photo text, tasted_on date, event_id uuid, mine boolean
)
language sql stable security definer set search_path = public as $$
  select t.id, t.user_id, p.display_name, t.wine_name, t.producer, t.vintage, t.non_vintage, t.color, t.region, t.appellation,
         t.rating, t.comment, t.dish, t.photo, t.tasted_on, t.event_id, t.user_id = auth.uid()
  from tastings t join profiles p on p.id = t.user_id
  where t.group_id = p_group and public.is_group_member(p_group)
  order by t.tasted_on desc, t.created_at desc
  limit 300
$$;

-- ───────────── Envies communes ─────────────

create function public.add_group_wish(p_group uuid, p jsonb) returns group_wishes
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_wishes;
begin
  if not public.is_group_member(p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from group_wishes where group_id = p_group) >= 100 then
    raise exception 'group_wishes_full' using errcode = 'P0001';
  end if;
  insert into group_wishes (group_id, created_by, wine_name, producer, vintage, color, note)
  values (
    p_group, v_me, btrim(p ->> 'wine_name'), nullif(btrim(p ->> 'producer'), ''), nullif(p ->> 'vintage', '')::integer,
    nullif(p ->> 'color', ''), nullif(btrim(p ->> 'note'), '')
  ) returning * into v_row;
  -- La personne qui propose l'envie y participe d'emblée.
  insert into group_wish_votes (wish_id, user_id) values (v_row.id, v_me);
  perform public.group_log(p_group, 'wish', concat_ws(' ', v_row.wine_name, v_row.vintage::text), null);
  return v_row;
end $$;

-- « Je participe » (ou plus).
create function public.vote_group_wish(p_wish uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_group uuid;
begin
  select group_id into v_group from group_wishes where id = p_wish;
  if v_group is null or not public.is_group_member(v_group) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_on then
    insert into group_wish_votes (wish_id, user_id) values (p_wish, v_me) on conflict do nothing;
  else
    delete from group_wish_votes where wish_id = p_wish and user_id = v_me;
  end if;
end $$;

-- Retirer une envie : la personne qui l'a proposée, ou un administrateur / gestionnaire du groupe.
create function public.delete_group_wish(p_wish uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_wishes;
begin
  select * into v_row from group_wishes where id = p_wish;
  if not found or not public.is_group_member(v_row.group_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.created_by is distinct from v_me and public.group_role(v_row.group_id) not in ('admin', 'manager') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  delete from group_wishes where id = p_wish;
end $$;

create function public.group_wishes_list(p_group uuid)
returns table (
  id uuid, wine_name text, producer text, vintage integer, color text, note text, created_by uuid, author_name text,
  votes integer, voters text[], voted boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select w.id, w.wine_name, w.producer, w.vintage, w.color, w.note, w.created_by, a.display_name,
         (select count(*)::int from group_wish_votes v where v.wish_id = w.id),
         coalesce(array(select p.display_name from group_wish_votes v join profiles p on p.id = v.user_id where v.wish_id = w.id order by v.created_at), '{}'),
         exists (select 1 from group_wish_votes v where v.wish_id = w.id and v.user_id = auth.uid()),
         w.created_at
  from group_wishes w left join profiles a on a.id = w.created_by
  where w.group_id = p_group and public.is_group_member(p_group)
  order by 9 desc, w.created_at desc
$$;

-- ───────────── Départ d'un groupe, photos ─────────────

-- Quitter un groupe (ou en être retiré) : mes partages et mises à disposition sont rendus, mes notes ne sont plus partagées
-- avec lui et mes « je participe » sont retirés. Mes envies restent (le groupe les a peut-être adoptées).
create or replace function public.group_members_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_next group_members;
begin
  if not exists (select 1 from groups where id = old.group_id) then
    return old;
  end if;
  delete from group_shares where group_id = old.group_id and owner_id = old.user_id;
  update tastings set group_id = null where user_id = old.user_id and group_id = old.group_id;
  delete from group_wish_votes v using group_wishes w where w.id = v.wish_id and w.group_id = old.group_id and v.user_id = old.user_id;
  if not exists (select 1 from group_members where group_id = old.group_id and status = 'active') then
    delete from groups where id = old.group_id;
    return old;
  end if;
  if not exists (select 1 from group_members where group_id = old.group_id and status = 'active' and role = 'admin') then
    select * into v_next from group_members
    where group_id = old.group_id and status = 'active'
    order by (role = 'manager') desc, joined_at nulls last
    limit 1;
    update group_members set role = 'admin' where group_id = v_next.group_id and user_id = v_next.user_id;
    insert into group_activity (group_id, actor_id, actor_name, kind, target_name, detail)
    values (old.group_id, null, null, 'role', (select display_name from profiles where id = v_next.user_id), 'admin');
  end if;
  return old;
end $$;

-- Photos : en plus des cas existants, celles des notes partagées avec un de mes groupes.
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
    or exists (select 1 from tastings t where t.photo = p_name and t.group_id is not null and public.is_group_member(t.group_id))
    or exists (select 1 from groups g where g.photo = p_name and public.is_group_member(g.id))
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id join group_shares s on s.lot_id = l.id
      where (w.label_photo = p_name or w.bottle_photo = p_name) and l.quantity > 0 and public.is_group_member(s.group_id)
    )
  )
$$;

grant execute on function
  public.can_invite_to_event(uuid, uuid), public.event_suggestable_lots(uuid), public.group_notes(uuid),
  public.add_group_wish(uuid, jsonb), public.vote_group_wish(uuid, boolean), public.delete_group_wish(uuid), public.group_wishes_list(uuid)
to authenticated;
