-- Cave & Amis — retour arrière de 20261102000011_deplacer_entre_caves.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il n'appelle que move_bottles à 4 paramètres).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : les caves de départ et d'arrivée de l'historique
--    des déplacements sont effacées. Les bouteilles déjà passées dans une autre cave y restent ; le stock ne change pas.

-- move_bottles à 4 paramètres : la version de 20261102000009 (même cave seulement).
drop function if exists public.move_bottles(uuid, integer, uuid, uuid, uuid, boolean);
create function public.move_bottles(p_lot uuid, p_quantity integer, p_location uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_move bottle_moves;
  v_new uuid;
begin
  if p_request is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or not public.can_manage_lot(p_lot) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_move from bottle_moves where request_id = p_request;
  if found then
    if v_move.user_id <> v_me or v_move.lot_id <> p_lot then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return jsonb_build_object('lot_id', v_move.lot_id, 'moved_lot_id', coalesce(v_move.new_lot_id, v_move.lot_id), 'quantity', v_move.quantity);
  end if;
  if p_location is not null and not exists (select 1 from locations where id = p_location and cellar_id = v_lot.cellar_id) then
    raise exception 'location_mismatch' using errcode = 'P0001';
  end if;
  if p_location is not distinct from v_lot.location_id then
    raise exception 'same_location' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_lot.quantity - v_lot.reserved then
    raise exception 'not_enough_free' using errcode = 'P0001',
      detail = json_build_object('available', v_lot.quantity - v_lot.reserved)::text;
  end if;
  if p_quantity = v_lot.quantity and v_lot.reserved = 0 then
    update lots set location_id = p_location where id = p_lot;
  else
    insert into lots (
      owner_id, wine_id, cellar_id, location_id, volume_ml, quantity, purchase_price, currency, purchase_date, purchase_place,
      visibility, hide_price, hide_quantity, hide_notes, notes
    ) values (
      v_lot.owner_id, v_lot.wine_id, v_lot.cellar_id, p_location, v_lot.volume_ml, p_quantity, v_lot.purchase_price, v_lot.currency,
      v_lot.purchase_date, v_lot.purchase_place, v_lot.visibility, v_lot.hide_price, v_lot.hide_quantity, v_lot.hide_notes, v_lot.notes
    ) returning id into v_new;
    update lots set quantity = quantity - p_quantity where id = p_lot;
    insert into group_shares (lot_id, group_id, owner_id, allocated)
    select v_new, group_id, owner_id, 0 from group_shares where lot_id = p_lot;
    insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode)
    select owner_id, viewer_id, v_new, mode from cellar_access_exceptions where lot_id = p_lot;
  end if;
  insert into bottle_moves (request_id, user_id, lot_id, new_lot_id, quantity, from_location, to_location)
  values (p_request, v_me, p_lot, v_new, p_quantity, v_lot.location_id, p_location);
  return jsonb_build_object('lot_id', p_lot, 'moved_lot_id', coalesce(v_new, p_lot), 'quantity', p_quantity);
end $$;


-- Export « mes données » : la version de 20261102000009.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return public.export_my_data_v3() || jsonb_build_object(
    'deplacements_de_bouteilles', coalesce((select jsonb_agg(jsonb_build_object(
                         'vin', (select concat_ws(' ', w.name, w.vintage::text) from lots l join wines w on w.id = l.wine_id
                                 where l.id = m.lot_id and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'bouteilles', m.quantity,
                         'de', (select x.name from locations x join lots l on l.id = m.lot_id
                                where x.id = m.from_location and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'vers', (select x.name from locations x join lots l on l.id = m.lot_id
                                  where x.id = m.to_location and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'par_moi', m.user_id = me, 'le', m.created_at) order by m.created_at)
                       from bottle_moves m
                       where m.user_id = me or exists (select 1 from lots l where l.id = m.lot_id and l.owner_id = me)), '[]'::jsonb));
end $$;

alter table public.bottle_moves drop column if exists to_cellar;
alter table public.bottle_moves drop column if exists from_cellar;

revoke all on function public.move_bottles(uuid, integer, uuid, uuid), public.export_my_data() from public, anon;
grant execute on function public.move_bottles(uuid, integer, uuid, uuid), public.export_my_data() to authenticated;
grant execute on all functions in schema public to service_role;
