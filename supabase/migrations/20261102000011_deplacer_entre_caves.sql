-- Cave & Amis 2.0 — déplacer des bouteilles vers une autre cave.
--
-- 1. move_bottles reçoit la cave d'arrivée (p_cellar, dernier paramètre, facultatif). Vide : la cave du lot, comme avant. Une autre cave n'est
--    acceptée que si elle appartient au propriétaire du lot (règle de lots_before : un lot est toujours dans une cave de
--    son propriétaire) et si la personne qui déplace la gère (propriétaire ou membre actif : can_manage_cellar). Le
--    reste ne change pas : seules les bouteilles libres partent, aucun mouvement de stock, lot jumeau pour une partie,
--    verrou sur la ligne du lot, une clé par demande. Une seule fonction (pas de surcharge) : le site d'avant, qui
--    l'appelle avec 4 paramètres nommés, reste dans la cave du lot.
--    Nouveau : TOUT un lot (p_whole, choisi explicitement) peut changer de place même s'il a des bouteilles réservées (événement, mise à disposition
--    d'un groupe). Les réservations sont rattachées au lot (event_wines.lot_id, group_shares.lot_id) : elles le suivent,
--    rien ne change pour l'événement ni pour le groupe. Pour une partie du lot, seules les bouteilles libres partent.
-- 2. bottle_moves garde aussi la cave de départ et d'arrivée (vides si la cave est supprimée).
-- 3. Export « mes données » : les déplacements y montrent aussi la cave de départ et d'arrivée.
--
-- Changer de cave peut changer qui voit les bouteilles : chaque cave a ses propres accès. Les masques propres au lot
-- (réglages, exceptions par personne, partages de groupe) suivent le lot.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000009_cave_visuelle.sql (indépendante de la 10,
-- fiche du vin d'un ami, d'une autre session : l'ordre entre les deux est libre). Ne modifie aucune
-- donnée existante. À déployer AVANT le nouveau site. Retour arrière : supabase/sql/retour-20261102000011.sql.

-- ───────────── 1. Historique : caves de départ et d'arrivée ─────────────

alter table public.bottle_moves add column from_cellar uuid references public.cellars (id) on delete set null;
alter table public.bottle_moves add column to_cellar uuid references public.cellars (id) on delete set null;
create index bottle_moves_from_cellar on public.bottle_moves (from_cellar) where from_cellar is not null;
create index bottle_moves_to_cellar on public.bottle_moves (to_cellar) where to_cellar is not null;

-- ───────────── 2. Déplacer, y compris vers une autre cave ─────────────

drop function public.move_bottles(uuid, integer, uuid, uuid);
create function public.move_bottles(p_lot uuid, p_quantity integer, p_location uuid, p_request uuid, p_cellar uuid default null, p_whole boolean default false) returns jsonb
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

-- ───────────── 3. Export « mes données » ─────────────

-- Même export que 20261102000009, avec les caves de départ et d'arrivée.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return public.export_my_data_v3() || jsonb_build_object(
    'deplacements_de_bouteilles', coalesce((select jsonb_agg(jsonb_build_object(
                         -- Vin, caves et emplacements seulement pour une cave que je gère encore (sinon : vides).
                         'vin', (select concat_ws(' ', w.name, w.vintage::text) from lots l join wines w on w.id = l.wine_id
                                 where l.id = m.lot_id and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'bouteilles', m.quantity,
                         'de_la_cave', (select c.name from cellars c join lots l on l.id = m.lot_id
                                        where c.id = m.from_cellar and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'de', (select x.name from locations x join lots l on l.id = m.lot_id
                                where x.id = m.from_location and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'vers_la_cave', (select c.name from cellars c join lots l on l.id = m.lot_id
                                          where c.id = m.to_cellar and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'vers', (select x.name from locations x join lots l on l.id = m.lot_id
                                  where x.id = m.to_location and (l.owner_id = me or public.can_manage_lot(l.id))),
                         'par_moi', m.user_id = me, 'le', m.created_at) order by m.created_at)
                       from bottle_moves m
                       where m.user_id = me or exists (select 1 from lots l where l.id = m.lot_id and l.owner_id = me)), '[]'::jsonb));
end $$;

-- ───────────── 4. Droits ─────────────

revoke all on function public.move_bottles(uuid, integer, uuid, uuid, uuid, boolean), public.export_my_data() from public, anon;
grant execute on function public.move_bottles(uuid, integer, uuid, uuid, uuid, boolean), public.export_my_data() to authenticated;
grant execute on all functions in schema public to service_role;
