-- Cave & Amis — retour arrière de 20261102000014_corrections_audit.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site et la cave-api d'avant si besoin (ils n'utilisent pas closed_by).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. Les règles d'avant reviennent (sans la protection des photos par
--    le code, ni les règles de soirée et d'achats groupés). Aucune donnée n'est perdue, sauf la colonne closed_by.

drop policy if exists photos_read on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.can_read_photo(name));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and split_part(name, '/', 1) = auth.uid()::text);

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
    or exists (
      select 1 from profiles p
      where p.avatar_photo = p_name and (public.is_connected(p.id) or public.shares_event(p.id))
        and not public.is_blocked_between(auth.uid(), p.id)
    )
  )
$$;

create or replace function public.photo_path_allowed(p_path text, p_owner uuid) returns boolean
language sql stable as $$
  select p_path is null or split_part(p_path, '/', 1) in (p_owner::text, coalesce(auth.uid()::text, ''))
$$;

create or replace function public.post_event_message(p_event uuid, p_body text) returns event_messages
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_messages;
begin
  if not public.is_event_participant(p_event) or not exists (select 1 from event_live where event_id = p_event and ended_at is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- Verrou sur l'événement : deux messages simultanés ne dépassent pas la limite.
  perform 1 from events where id = p_event for update;
  if (select count(*) from event_messages where event_id = p_event) >= 500 then
    raise exception 'event_messages_full' using errcode = 'P0001';
  end if;
  insert into event_messages (event_id, user_id, body) values (p_event, v_me, btrim(p_body)) returning * into v_row;
  return v_row;
end $$;

create or replace function public.vote_event_wine(p_wine uuid, p_rating smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event uuid;
begin
  select event_id into v_event from event_wines where id = p_wine and status in ('confirmed', 'consumed', 'not_consumed');
  if v_event is null or not public.is_event_participant(v_event) or not exists (select 1 from event_live where event_id = v_event) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_rating is null then
    delete from event_votes where event_wine_id = p_wine and user_id = v_me;
  else
    insert into event_votes (event_wine_id, user_id, rating) values (p_wine, v_me, p_rating)
    on conflict (event_wine_id, user_id) do update set rating = excluded.rating, updated_at = now();
  end if;
end $$;

create or replace function public.event_live_state(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  -- Double authentification activée mais session non vérifiée : rien (comme require_user()).
  select case when not public.is_event_participant(p_event) or not public.mfa_ok() then null else jsonb_build_object(
    'live', (select to_jsonb(l) from event_live l where l.event_id = p_event),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'author', p.display_name, 'body', m.body,
                                          'created_at', m.created_at, 'mine', m.user_id = auth.uid()) order by m.created_at)
      from (select * from event_messages where event_id = p_event order by created_at desc limit 100) m
      join profiles p on p.id = m.user_id
      where not public.is_blocked_between(auth.uid(), m.user_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('event_wine_id', w.id,
        'average', (select round(avg(v.rating), 1) from event_votes v where v.event_wine_id = w.id),
        'count', (select count(*) from event_votes v where v.event_wine_id = w.id),
        'mine', (select v.rating from event_votes v where v.event_wine_id = w.id and v.user_id = auth.uid())))
      from event_wines w where w.event_id = p_event and w.status in ('confirmed', 'consumed', 'not_consumed')), '[]'::jsonb)
  ) end
$$;

create or replace function public.open_purchase_group(p_purchase uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
begin
  select group_id into v_group from group_purchases where id = p_purchase and status = 'open';
  if v_group is null or not public.is_group_member(v_group) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_group;
end $$;

create or replace function public.create_group_purchase(p_group uuid, p jsonb) returns group_purchases
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_purchases;
begin
  if not public.is_group_member(p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform 1 from groups where id = p_group for update;
  if (select count(*) from group_purchases where group_id = p_group and status = 'open') >= 20 then
    raise exception 'group_purchases_full' using errcode = 'P0001';
  end if;
  insert into group_purchases (group_id, created_by, title, budget, note)
  values (p_group, v_me, btrim(p ->> 'title'), nullif(p ->> 'budget', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.set_group_purchase_status(p_purchase uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_purchases;
begin
  select * into v_row from group_purchases where id = p_purchase;
  if not found or not public.is_group_member(v_row.group_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_me is distinct from v_row.created_by and public.group_role(v_row.group_id) not in ('admin', 'manager') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_status not in ('open', 'closed', 'cancelled') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  -- Rouvrir : même limite de 20 achats ouverts par groupe qu'à la création.
  if p_status = 'open' and v_row.status <> 'open' then
    perform 1 from groups where id = v_row.group_id for update;
    if (select count(*) from group_purchases where group_id = v_row.group_id and status = 'open') >= 20 then
      raise exception 'group_purchases_full' using errcode = 'P0001';
    end if;
  end if;
  update group_purchases set status = p_status, closed_at = case when p_status = 'open' then null else now() end where id = p_purchase;
end $$;

create or replace function public.move_bottles(p_lot uuid, p_quantity integer, p_location uuid, p_request uuid, p_cellar uuid default null, p_whole boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_move bottle_moves;
  v_new uuid;
  v_cellar uuid;
begin
  if p_request is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or not public.can_manage_lot(p_lot) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic ou nouvel envoi : le déplacement déjà fait est renvoyé tel quel.
  select * into v_move from bottle_moves where request_id = p_request;
  if found then
    if v_move.user_id <> v_me or v_move.lot_id <> p_lot then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return jsonb_build_object('lot_id', v_move.lot_id, 'moved_lot_id', coalesce(v_move.new_lot_id, v_move.lot_id), 'quantity', v_move.quantity);
  end if;
  v_cellar := coalesce(p_cellar, v_lot.cellar_id);
  -- Une cave du propriétaire du lot, que je gère. Sinon : comme une cave inconnue.
  if v_cellar <> v_lot.cellar_id
     and not exists (select 1 from cellars where id = v_cellar and owner_id = v_lot.owner_id and public.can_manage_cellar(id)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from locations where id = p_location and cellar_id = v_cellar) then
    raise exception 'location_mismatch' using errcode = 'P0001';
  end if;
  if v_cellar = v_lot.cellar_id and p_location is not distinct from v_lot.location_id then
    raise exception 'same_location' using errcode = 'P0001';
  end if;
  -- « Tout le lot » (p_whole, choisi explicitement) : réservations comprises, elles suivent le lot ; refusé si le lot a
  -- changé entre-temps (p_quantity ne correspond plus). Sinon : seulement des bouteilles libres, jamais de réservées,
  -- même si le nombre demandé égale par hasard ce qui reste dans le lot (deux déplacements simultanés).
  if p_quantity is null or p_quantity < 1
     or (coalesce(p_whole, false) and p_quantity <> v_lot.quantity)
     or (not coalesce(p_whole, false) and p_quantity > v_lot.quantity - v_lot.reserved) then
    raise exception 'not_enough_free' using errcode = 'P0001',
      detail = json_build_object('available', v_lot.quantity - v_lot.reserved)::text;
  end if;
  if p_quantity = v_lot.quantity then
    update lots set cellar_id = v_cellar, location_id = p_location where id = p_lot;
  else
    insert into lots (
      owner_id, wine_id, cellar_id, location_id, volume_ml, quantity, purchase_price, currency, purchase_date, purchase_place,
      visibility, hide_price, hide_quantity, hide_notes, notes
    ) values (
      v_lot.owner_id, v_lot.wine_id, v_cellar, p_location, v_lot.volume_ml, p_quantity, v_lot.purchase_price, v_lot.currency,
      v_lot.purchase_date, v_lot.purchase_place, v_lot.visibility, v_lot.hide_price, v_lot.hide_quantity, v_lot.hide_notes, v_lot.notes
    ) returning id into v_new;
    update lots set quantity = quantity - p_quantity where id = p_lot;
    -- Même partage que le lot d'origine : visible des mêmes groupes (sans bouteille mise à disposition) et mêmes
    -- exceptions par personne (lot masqué ou montré).
    insert into group_shares (lot_id, group_id, owner_id, allocated)
    select v_new, group_id, owner_id, 0 from group_shares where lot_id = p_lot;
    insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode)
    select owner_id, viewer_id, v_new, mode from cellar_access_exceptions where lot_id = p_lot;
  end if;
  insert into bottle_moves (request_id, user_id, lot_id, new_lot_id, quantity, from_location, to_location, from_cellar, to_cellar)
  values (p_request, v_me, p_lot, v_new, p_quantity, v_lot.location_id, p_location, v_lot.cellar_id, v_cellar);
  return jsonb_build_object('lot_id', p_lot, 'moved_lot_id', coalesce(v_new, p_lot), 'quantity', p_quantity);
end $$;

drop function if exists public.is_live_participant(uuid);
alter table public.group_purchases drop column if exists closed_by;

alter function public.require_user() reset search_path;
alter function public.wines_before() reset search_path;
alter function public.admin_audit_immutable() reset search_path;
alter function public.photo_path_allowed(text, uuid) reset search_path;

grant execute on all functions in schema public to service_role;
