-- Cave & Amis — phase C « Amis & Groupes » : mise à disposition de bouteilles pour un groupe.
--
-- Principes :
-- * mettre N bouteilles à disposition d'un groupe les RÉSERVE : elles restent à leur propriétaire mais ne sont plus
--   libres (ni pour lui, ni pour un autre groupe, ni pour un événement) ;
-- * un seul compteur par lot : lots.reserved = réservations d'événements + mises à disposition des groupes ; la
--   contrainte existante « réservées ≤ stock » rend impossible tout double comptage, même en cas d'actions simultanées ;
-- * le détail (quel groupe, combien) est dans group_shares.allocated ;
-- * seul le propriétaire ouvre une bouteille mise à disposition : la mise à disposition et le stock baissent ensemble,
--   une seule fois (clé anti-double-clic), avec l'historique (mouvement relié au groupe, activité du groupe) ;
-- * reprendre, ne plus partager, quitter le groupe, être retiré ou supprimer son compte rend les bouteilles libres.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000004_groupes.sql.

alter table public.group_shares add column allocated integer not null default 0 check (allocated between 0 and 10000);

-- Sortie de stock liée à un groupe (bouteille mise à disposition puis ouverte).
alter table public.movements add column group_id uuid references public.groups (id) on delete set null;
create index movements_group on public.movements (group_id) where group_id is not null;

alter table public.group_activity drop constraint group_activity_kind_check;
alter table public.group_activity add constraint group_activity_kind_check
  check (kind in ('created', 'updated', 'invited', 'joined', 'left', 'removed', 'role', 'shared', 'unshared', 'allocated', 'consumed'));

-- Une mise à disposition qui disparaît (partage retiré, départ, groupe supprimé) rend ses bouteilles libres.
create function public.group_shares_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.allocated > 0 then
    update lots set reserved = greatest(reserved - old.allocated, 0) where id = old.lot_id;
  end if;
  return old;
end $$;
create trigger group_shares_after_delete after delete on public.group_shares
for each row execute function public.group_shares_after_delete();

-- Nombre de bouteilles mises à disposition d'un groupe (valeur finale : 0 = tout reprendre).
create function public.allocate_to_group(p_lot uuid, p_group uuid, p_quantity integer) returns group_shares
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_share group_shares;
  v_exists boolean;
  v_old integer;
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 10000 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or v_lot.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_share from group_shares where lot_id = p_lot and group_id = p_group for update;
  v_exists := found;
  v_old := coalesce(v_share.allocated, 0);
  -- Reprendre ses bouteilles reste possible ; en mettre à disposition exige d'être membre.
  if p_quantity > v_old and not public.is_group_member(p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_quantity = v_old then
    return v_share;
  end if;
  begin
    update lots set reserved = reserved + (p_quantity - v_old) where id = p_lot;
  exception when check_violation then
    raise exception 'over_allocation' using errcode = 'P0001',
      detail = json_build_object('available', v_lot.quantity - v_lot.reserved + v_old)::text;
  end;
  if v_exists then
    update group_shares set allocated = p_quantity where lot_id = p_lot and group_id = p_group returning * into v_share;
  else
    insert into group_shares (lot_id, group_id, owner_id, allocated) values (p_lot, p_group, v_me, p_quantity) returning * into v_share;
  end if;
  perform public.group_log(p_group, 'allocated',
    (select concat_ws(' ', w.name, w.vintage::text) from wines w where w.id = v_lot.wine_id), p_quantity::text);
  return v_share;
end $$;

-- Le propriétaire ouvre des bouteilles qu'il avait mises à disposition du groupe : une seule fois par clé.
create function public.consume_from_group(p_lot uuid, p_group uuid, p_quantity integer, p_date date, p_note text, p_request uuid) returns movements
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_lot lots;
  v_share group_shares;
  v_mov movements;
begin
  if p_request is null or p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_lot from lots where id = p_lot for update;
  if not found or v_lot.owner_id <> v_me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic ou nouvel envoi : la sortie déjà enregistrée est renvoyée telle quelle.
  select * into v_mov from movements where request_id = p_request;
  if found then
    if v_mov.owner_id <> v_me then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    return v_mov;
  end if;
  select * into v_share from group_shares where lot_id = p_lot and group_id = p_group for update;
  if not found or v_share.allocated < p_quantity then
    raise exception 'allocation_insufficient' using errcode = 'P0001', detail = json_build_object('available', coalesce(v_share.allocated, 0))::text;
  end if;
  update group_shares set allocated = allocated - p_quantity where lot_id = p_lot and group_id = p_group;
  update lots set reserved = reserved - p_quantity, quantity = quantity - p_quantity where id = p_lot;
  insert into movements (owner_id, lot_id, kind, delta, occurred_on, note, group_id, request_id)
  values (v_me, p_lot, 'consommation', -p_quantity, coalesce(p_date, today_paris()), nullif(btrim(p_note), ''), p_group, p_request)
  returning * into v_mov;
  perform public.group_log(p_group, 'consumed',
    (select concat_ws(' ', w.name, w.vintage::text) from wines w where w.id = v_lot.wine_id), p_quantity::text);
  return v_mov;
end $$;

-- Suppression de compte : les mises à disposition sont d'abord rendues (sinon les lots resteraient « réservés »).
create or replace function public.prepare_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  r event_wines;
begin
  for r in select * from event_wines where owner_id = v_me and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  delete from group_shares where owner_id = v_me;
  -- Suppression explicite dans l'ordre (lots, vins, caves) : la suppression en cascade du compte
  -- se heurterait sinon à la protection « cave non vide ».
  delete from lots where owner_id = v_me;
  delete from wines where owner_id = v_me;
  delete from cellars where owner_id = v_me;
end $$;

-- ───────────── Lectures (nouvelles colonnes : mises à disposition) ─────────────

drop function public.my_groups();
create function public.my_groups()
returns table (
  id uuid, name text, emoji text, description text, photo text, my_role text, my_status text,
  members integer, bottles integer, available_bottles integer, invited_by_name text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.emoji, g.description, g.photo, m.role, m.status,
    (select count(*)::int from group_members x where x.group_id = g.id and x.status = 'active'),
    (select count(*)::int from group_shares s join lots l on l.id = s.lot_id where s.group_id = g.id and l.quantity > 0),
    (select coalesce(sum(s.allocated), 0)::int from group_shares s where s.group_id = g.id),
    (select display_name from profiles where id = m.invited_by),
    g.created_at
  from group_members m join groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by m.status desc, g.name
$$;

drop function public.group_lots(uuid);
create function public.group_lots(p_group uuid)
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
    case when l.hide_quantity and l.owner_id <> auth.uid() then null else l.quantity end,
    case when l.hide_quantity and l.owner_id <> auth.uid() then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0 or s.allocated > 0,
    case when l.hide_price and l.owner_id <> auth.uid() then null else l.purchase_price end,
    case when l.hide_price and l.owner_id <> auth.uid() then null else l.currency end,
    case when l.hide_notes and l.owner_id <> auth.uid() then null else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price, l.hide_quantity, l.hide_notes, l.updated_at, l.owner_id = auth.uid(),
    -- Le nombre mis à disposition est toujours montré : c'est ce que le propriétaire a choisi d'offrir au groupe.
    s.allocated
  from group_shares s
  join lots l on l.id = s.lot_id
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where s.group_id = p_group and public.is_group_member(p_group) and l.quantity > 0
  order by s.allocated > 0 desc, w.name, w.vintage, p.display_name
$$;

grant execute on function
  public.allocate_to_group(uuid, uuid, integer), public.consume_from_group(uuid, uuid, integer, date, text, uuid),
  public.my_groups(), public.group_lots(uuid)
to authenticated;
