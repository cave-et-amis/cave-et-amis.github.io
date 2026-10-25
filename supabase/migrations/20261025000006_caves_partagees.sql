-- Cave & Amis — phase D « Amis & Groupes » : caves gérées à plusieurs (un couple, une famille…).
--
-- Principes :
-- * une cave a toujours une seule personne propriétaire, qui peut y associer des amis, chacun avec son propre compte ;
-- * une personne associée voit cette cave comme la sienne (bouteilles, emplacements, fiches, prix) et peut ajouter, boire,
--   corriger et ranger des bouteilles ; ses autres caves et celles du propriétaire restent séparées ;
-- * il n'y a qu'un seul stock, celui de la cave : les bouteilles ajoutées par une personne associée appartiennent au
--   propriétaire ; mêmes fonctions protégées pour tous, donc aucune copie ni double comptage ;
-- * chaque mouvement de stock garde la personne qui l'a fait (movements.done_by) ;
-- * restent au propriétaire : supprimer la cave, un vin ou un lot ; le partage avec les amis et les masques ; les groupes
--   et les événements ; associer ou retirer quelqu'un. Une personne associée peut partir quand elle veut et n'emporte rien ;
-- * bloquer quelqu'un met fin aux caves partagées entre vous deux.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000005_mise_a_disposition.sql.

-- ───────────── Personnes associées ─────────────

create table public.cellar_members (
  cellar_id uuid not null references public.cellars (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (cellar_id, user_id)
);
create index cellar_members_user on public.cellar_members (user_id);
alter table public.cellar_members enable row level security;
-- Aucune lecture directe : tout passe par les fonctions ci-dessous.

-- Qui a fait chaque mouvement de stock (le propriétaire ou une personne associée).
alter table public.movements add column done_by uuid default auth.uid() references public.profiles (id) on delete set null;
update public.movements set done_by = owner_id where done_by is null;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined'));

-- ───────────── Droits ─────────────

-- Personne associée (invitation acceptée) à cette cave.
create function public.is_cellar_member(p_cellar uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cellar_members where cellar_id = p_cellar and user_id = auth.uid() and status = 'active')
$$;

-- Propriétaire ou personne associée : voit et gère les bouteilles de cette cave.
create function public.can_manage_cellar(p_cellar uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cellars where id = p_cellar and owner_id = auth.uid()) or public.is_cellar_member(p_cellar)
$$;

create function public.can_manage_lot(p_lot uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lots where id = p_lot and (owner_id = auth.uid() or public.is_cellar_member(cellar_id)))
$$;

-- Fiche de vin : la mienne, ou présente dans une cave à laquelle je suis associé.
create function public.can_manage_wine(p_wine uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wines where id = p_wine and owner_id = auth.uid())
    or exists (
      select 1 from lots l join cellar_members m on m.cellar_id = l.cellar_id
      where l.wine_id = p_wine and m.user_id = auth.uid() and m.status = 'active'
    )
$$;

-- Je suis associé à au moins une cave de cette personne (je peux créer une fiche à son nom pour cette cave).
create function public.manages_cellar_of(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cellar_members m join cellars c on c.id = m.cellar_id
    where c.owner_id = p_owner and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

drop policy cellars_own on public.cellars;
create policy cellars_read on public.cellars for select to authenticated using (owner_id = auth.uid() or public.is_cellar_member(id));
create policy cellars_insert on public.cellars for insert to authenticated with check (owner_id = auth.uid());
create policy cellars_update on public.cellars for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy cellars_delete on public.cellars for delete to authenticated using (owner_id = auth.uid());

-- Emplacements : le propriétaire et les personnes associées rangent la cave.
drop policy locations_own on public.locations;
create policy locations_all on public.locations for all to authenticated
  using (owner_id = auth.uid() or public.is_cellar_member(cellar_id))
  with check (owner_id = auth.uid() or public.is_cellar_member(cellar_id));

drop policy wines_own on public.wines;
create policy wines_read on public.wines for select to authenticated using (owner_id = auth.uid() or public.can_manage_wine(id));
create policy wines_insert on public.wines for insert to authenticated with check (owner_id = auth.uid() or public.manages_cellar_of(owner_id));
create policy wines_update on public.wines for update to authenticated
  using (owner_id = auth.uid() or public.can_manage_wine(id)) with check (owner_id = auth.uid() or public.can_manage_wine(id));
create policy wines_delete on public.wines for delete to authenticated using (owner_id = auth.uid());

drop policy lots_read on public.lots;
drop policy lots_update on public.lots;
create policy lots_read on public.lots for select to authenticated using (owner_id = auth.uid() or public.is_cellar_member(cellar_id));
create policy lots_update on public.lots for update to authenticated
  using (owner_id = auth.uid() or public.is_cellar_member(cellar_id)) with check (owner_id = auth.uid() or public.is_cellar_member(cellar_id));
-- lots_delete : inchangé (propriétaire seulement).

drop policy movements_read on public.movements;
create policy movements_read on public.movements for select to authenticated using (owner_id = auth.uid() or public.can_manage_lot(lot_id));

-- Prix de marché d'une fiche : ceux de son propriétaire, lus et complétés aussi par les personnes associées.
drop policy market_prices_read on public.market_prices;
drop policy market_prices_insert on public.market_prices;
drop policy market_prices_update on public.market_prices;
drop policy market_prices_delete on public.market_prices;
create policy market_prices_read on public.market_prices for select to authenticated using (owner_id = auth.uid() or public.can_manage_wine(wine_id));
create policy market_prices_insert on public.market_prices for insert to authenticated
  with check ((owner_id = auth.uid() or public.can_manage_wine(wine_id)) and method = 'manual' and check_id is null);
create policy market_prices_update on public.market_prices for update to authenticated
  using ((owner_id = auth.uid() or public.can_manage_wine(wine_id)) and method = 'manual')
  with check ((owner_id = auth.uid() or public.can_manage_wine(wine_id)) and method = 'manual' and check_id is null);
create policy market_prices_delete on public.market_prices for delete to authenticated using (owner_id = auth.uid() or public.can_manage_wine(wine_id));

-- ───────────── Contrôles des données ─────────────

-- Photos d'une fiche : dans le dossier de son propriétaire, ou dans celui de la personne qui l'enregistre (une personne
-- associée dépose ses photos dans son propre dossier). Jamais le fichier d'un tiers.
-- Les trois anciennes règles « photo dans le dossier du propriétaire » (noms choisis par PostgreSQL) : retrouvées par leur
-- contenu, remplacées par le contrôle de wines_before.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.wines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%photo% ~~ %owner_id%'
  loop
    execute format('alter table public.wines drop constraint %I', r.conname);
    n := n + 1;
  end loop;
  if n <> 3 then
    raise exception 'Contraintes de photos inattendues (%)', n;
  end if;
end $$;

create or replace function public.photo_path_allowed(p_path text, p_owner uuid) returns boolean
language sql stable as $$
  select p_path is null or split_part(p_path, '/', 1) in (p_owner::text, coalesce(auth.uid()::text, ''))
$$;

create or replace function public.wines_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (new.label_photo is distinct from (case when tg_op = 'UPDATE' then old.label_photo end)
      and not public.photo_path_allowed(new.label_photo, new.owner_id))
     or (new.bottle_photo is distinct from (case when tg_op = 'UPDATE' then old.bottle_photo end)
      and not public.photo_path_allowed(new.bottle_photo, new.owner_id))
     or (new.bottle_photo_original is distinct from (case when tg_op = 'UPDATE' then old.bottle_photo_original end)
      and not public.photo_path_allowed(new.bottle_photo_original, new.owner_id)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;

-- Un emplacement appartient au propriétaire de la cave, même s'il a été créé par une personne associée.
create or replace function public.locations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from cellars where id = new.cellar_id;
  if v_owner is null or (v_owner <> new.owner_id and not public.can_manage_cellar(new.cellar_id)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.owner_id := v_owner;
  new.name := btrim(new.name);
  return new;
end $$;

-- Une personne associée range les bouteilles et corrige l'achat ou les notes ; le vin, le partage et les masques restent
-- au propriétaire.
create or replace function public.lots_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() <> old.owner_id
     and (new.wine_id <> old.wine_id or new.visibility <> old.visibility or new.hide_price <> old.hide_price
          or new.hide_quantity <> old.hide_quantity or new.hide_notes <> old.hide_notes) then
    raise exception 'owner_only' using errcode = 'P0001';
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
  new.wine_name := btrim(new.wine_name);
  return new;
end $$;

-- Les prix d'une fiche appartiennent à son propriétaire, même relevés par une personne associée.
create or replace function public.market_prices_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  v_owner uuid;
begin
  select owner_id into v_owner from wines where id = new.wine_id;
  if v_owner is null or (v_owner <> new.owner_id and not public.can_manage_wine(new.wine_id)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  new.owner_id := v_owner;
  for s in select * from jsonb_array_elements(new.sources) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s ->> 'url', '') !~ '^https?://[^\s]+$' then
      raise exception 'invalid_source' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

-- Photos : en plus des cas existants, celles des fiches que je gère (les miennes, ou celles d'une cave à laquelle je suis
-- associé), où qu'elles soient rangées.
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
    or exists (select 1 from groups g where g.photo = p_name and public.is_group_member(g.id))
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id join group_shares s on s.lot_id = l.id
      where (w.label_photo = p_name or w.bottle_photo = p_name) and l.quantity > 0 and public.is_group_member(s.group_id)
    )
  )
$$;

-- ───────────── Stock : mêmes fonctions protégées pour le propriétaire et les personnes associées ─────────────

create or replace function public.record_movement(p_lot uuid, p_kind text, p_quantity integer, p_date date, p_note text, p_request uuid)
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
  if not found or not (v_lot.owner_id = v_me or public.is_cellar_member(v_lot.cellar_id)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.done_by is distinct from v_me then
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
  values (v_lot.owner_id, p_lot, p_kind, v_delta, coalesce(p_date, today_paris()), nullif(btrim(p_note), ''), p_request)
  returning * into v_mov;
  return v_mov;
end $$;

create or replace function public.set_lot_quantity(p_lot uuid, p_quantity integer, p_note text, p_request uuid)
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
  if not found or not (v_lot.owner_id = v_me or public.is_cellar_member(v_lot.cellar_id)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.done_by is distinct from v_me then
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
  values (v_lot.owner_id, p_lot, 'correction', p_quantity - v_lot.quantity, nullif(btrim(p_note), ''), p_request)
  returning * into v_mov;
  return v_mov;
end $$;

create or replace function public.reverse_movement(p_movement uuid, p_request uuid)
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
  if not found or not public.can_manage_lot(v_src.lot_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_src.kind = 'annulation' then
    raise exception 'cannot_reverse' using errcode = 'P0001';
  end if;
  -- Bouteille d'un événement ou d'un groupe : c'est l'affaire du propriétaire.
  if v_src.owner_id <> v_me and (v_src.event_wine_id is not null or v_src.group_id is not null) then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  if v_src.event_wine_id is not null then
    perform 1 from event_wines where id = v_src.event_wine_id for update;
  end if;
  perform 1 from lots where id = v_src.lot_id for update;
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.done_by is distinct from v_me then
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
  values (v_src.owner_id, v_src.lot_id, 'annulation', -v_src.delta, 'Annulation d’une saisie', p_movement, p_request)
  returning * into v_mov;
  -- Consommation d'événement annulée : la bouteille est notée « non ouverte », sans nouvelle réservation.
  if v_src.event_wine_id is not null then
    update event_wines set status = 'not_consumed', consumed_qty = 0 where id = v_src.event_wine_id;
  end if;
  return v_mov;
end $$;

-- Nouveau lot : il appartient au propriétaire de la cave choisie, même ajouté par une personne associée.
create or replace function public.create_lot(p jsonb, p_request uuid) returns lots
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_qty integer := coalesce(nullif(p ->> 'quantity', '')::integer, 0);
  v_origin text := coalesce(p ->> 'origin', 'achat');
  v_cellar uuid := nullif(p ->> 'cellar_id', '')::uuid;
  v_owner uuid;
begin
  if p_request is null or v_qty < 0 or v_qty > 10000 or v_origin not in ('achat', 'cadeau_recu', 'entree') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where request_id = p_request;
  if found then
    if not public.can_manage_cellar(v_lot.cellar_id) then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_lot;
  end if;
  if v_cellar is null then
    select id into v_cellar from cellars where owner_id = v_me order by position, created_at limit 1;
  end if;
  select owner_id into v_owner from cellars where id = v_cellar;
  if v_owner is null or not public.can_manage_cellar(v_cellar) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- Le partage (amis, événements) reste le choix du propriétaire : sa préférence par défaut s'applique.
  if v_owner <> v_me then
    p := (p - 'visibility' - 'hide_price' - 'hide_quantity' - 'hide_notes')
      || jsonb_build_object('visibility', coalesce((select preferences ->> 'default_visibility' from profiles where id = v_owner), 'private'));
  end if;
  insert into lots (
    owner_id, wine_id, cellar_id, location_id, volume_ml, quantity, purchase_price, currency, purchase_date, purchase_place,
    visibility, hide_price, hide_quantity, hide_notes, notes, request_id
  ) values (
    v_owner, (p ->> 'wine_id')::uuid, v_cellar, nullif(p ->> 'location_id', '')::uuid,
    coalesce(nullif(p ->> 'volume_ml', '')::integer, 750), v_qty, nullif(p ->> 'purchase_price', '')::numeric,
    coalesce(nullif(p ->> 'currency', ''), (select currency from profiles where id = v_me), 'EUR'),
    nullif(p ->> 'purchase_date', '')::date, nullif(btrim(p ->> 'purchase_place'), ''),
    coalesce(p ->> 'visibility', 'private'), coalesce((p ->> 'hide_price')::boolean, true),
    coalesce((p ->> 'hide_quantity')::boolean, false), coalesce((p ->> 'hide_notes')::boolean, true),
    nullif(btrim(p ->> 'notes'), ''), p_request
  ) returning * into v_lot;
  if v_qty > 0 then
    insert into movements (owner_id, lot_id, kind, delta, occurred_on, request_id)
    values (v_owner, v_lot.id, v_origin, v_qty, coalesce(nullif(p ->> 'purchase_date', '')::date, today_paris()), gen_random_uuid());
  end if;
  return v_lot;
end $$;

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

-- ───────────── Associer, accepter, retirer, partir ─────────────

-- Le propriétaire associe des amis à sa cave : chacun reçoit une invitation (10 personnes au plus par cave).
create function public.invite_to_cellar(p_cellar uuid, p_users uuid[]) returns integer
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
    -- Seulement mes amis (chacun avec son compte) ; jamais une personne bloquée, dans un sens ou l'autre.
    if not public.is_friend(v_user) or public.is_blocked_between(v_me, v_user) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    continue when exists (select 1 from cellar_members where cellar_id = p_cellar and user_id = v_user);
    insert into cellar_members (cellar_id, user_id, invited_by) values (p_cellar, v_user, v_me);
    perform public.notify(v_user, 'cellar_invite', v_me, p_cellar);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.respond_cellar_invite(p_cellar uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row cellar_members;
begin
  select * into v_row from cellar_members where cellar_id = p_cellar and user_id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic : déjà associé.
  if v_row.status = 'active' then
    return 'active';
  end if;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'cellar_invite' and ref_id = p_cellar;
  if not p_accept then
    delete from cellar_members where cellar_id = p_cellar and user_id = v_me;
    return 'declined';
  end if;
  update cellar_members set status = 'active', joined_at = now() where cellar_id = p_cellar and user_id = v_me;
  perform public.notify((select owner_id from cellars where id = p_cellar), 'cellar_joined', v_me, p_cellar);
  return 'active';
end $$;

-- Le propriétaire retire une personne (ou annule son invitation) ; une personne associée peut partir. Rien ne bouge :
-- les bouteilles sont celles de la cave.
create function public.remove_cellar_member(p_cellar uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if p_user is distinct from v_me and not exists (select 1 from cellars where id = p_cellar and owner_id = v_me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from cellar_members where cellar_id = p_cellar and user_id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update notifications set read_at = coalesce(read_at, now()) where user_id = p_user and kind = 'cellar_invite' and ref_id = p_cellar;
end $$;

-- Toutes les associations qui me concernent : les personnes associées à mes caves, les caves où je suis associé ou
-- invité, et les autres personnes associées à ces caves.
create function public.my_cellar_links()
returns table (
  cellar_id uuid, cellar_name text, owner_id uuid, owner_name text, user_id uuid, user_name text, status text,
  invited_at timestamptz, joined_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.cellar_id, c.name, c.owner_id, po.display_name, m.user_id, pu.display_name, m.status, m.invited_at, m.joined_at
  from cellar_members m
  join cellars c on c.id = m.cellar_id
  join profiles po on po.id = c.owner_id
  join profiles pu on pu.id = m.user_id
  where c.owner_id = auth.uid() or m.user_id = auth.uid() or (m.status = 'active' and public.is_cellar_member(m.cellar_id))
  order by c.name, pu.display_name
$$;

-- Bloquer quelqu'un met fin à toute cave partagée entre vous deux.
create function public.blocks_after_insert_cellars() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from cellar_members m using cellars c
  where c.id = m.cellar_id
    and ((c.owner_id = new.blocker_id and m.user_id = new.blocked_id) or (c.owner_id = new.blocked_id and m.user_id = new.blocker_id));
  return new;
end $$;
create trigger blocks_after_insert_cellars after insert on public.blocks
for each row execute function public.blocks_after_insert_cellars();

-- Suppression de compte : mes photos déposées sur les fiches d'une cave partagée en sont d'abord retirées (mes fichiers
-- seront effacés), puis mes données sont supprimées comme avant.
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
  -- Suppression explicite dans l'ordre (lots, vins, caves) : la suppression en cascade du compte
  -- se heurterait sinon à la protection « cave non vide ».
  delete from lots where owner_id = v_me;
  delete from wines where owner_id = v_me;
  delete from cellars where owner_id = v_me;
end $$;

grant execute on function
  public.is_cellar_member(uuid), public.can_manage_cellar(uuid), public.can_manage_lot(uuid), public.can_manage_wine(uuid),
  public.manages_cellar_of(uuid), public.photo_path_allowed(text, uuid),
  public.invite_to_cellar(uuid, uuid[]), public.respond_cellar_invite(uuid, boolean), public.remove_cellar_member(uuid, uuid),
  public.my_cellar_links()
to authenticated;
