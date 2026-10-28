-- Cave & Amis 2.0 — cave visuelle (vue 3D des emplacements) et déplacement de bouteilles.
--
-- 1. Disposition d'une étagère : locations.rows (1 à 20 rangées) et locations.slots_per_row (1 à 48 places par rangée).
--    Vide = disposition automatique. Les droits sur locations sont donnés à la table entière (« grant select, insert,
--    update, delete » de 20261019000001, sans liste de colonnes) : les nouvelles colonnes sont donc lisibles, insérables
--    (from('locations').insert) et modifiables comme les autres, sans nouveau « grant ». Les règles d'accès (locations_all,
--    locations_mfa_ok) et le contrôle locations_before restent inchangés.
-- 2. move_bottles : déplacer des bouteilles d'un lot vers un autre emplacement de la même cave (ou « sans emplacement »).
--    Seules les bouteilles libres se déplacent (quantité moins réservées) : jamais celles réservées pour un événement ni
--    celles mises à disposition d'un groupe. Tout le lot (rien de réservé) : seul son emplacement change. Une partie :
--    un lot « jumeau » est créé à la nouvelle place (même achat, même partage, mêmes masques, mêmes notes) et le lot
--    d'origine perd autant de bouteilles. Un déplacement n'est PAS un mouvement de stock : aucune ligne dans movements,
--    les statistiques ne changent pas. Une clé par demande (p_request) évite un double déplacement (double clic, nouvel
--    envoi). Verrou sur la ligne du lot : deux déplacements simultanés des dernières bouteilles libres passent l'un après
--    l'autre, et le second est refusé s'il n'en reste plus assez.
-- 3. bottle_moves : la clé de chaque demande et l'historique des déplacements, lus par le propriétaire du lot et par la
--    personne qui a déplacé. Supprimés avec le compte (cascade).
-- 4. Export « mes données » : les déplacements s'y ajoutent.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000008_alerte_prix.sql. Ne modifie aucune donnée
-- existante. À déployer AVANT le nouveau site. Retour arrière : supabase/sql/retour-20261102000009.sql.

-- ───────────── 1. Disposition des étagères ─────────────

alter table public.locations add column rows smallint check (rows between 1 and 20);
alter table public.locations add column slots_per_row smallint check (slots_per_row between 1 and 48);
-- Les deux ensemble, ou aucun (disposition automatique).
alter table public.locations add constraint locations_layout_check check ((rows is null) = (slots_per_row is null));

-- ───────────── 2. Historique des déplacements ─────────────

create table public.bottle_moves (
  request_id uuid primary key,
  -- Personne qui a déplacé ; vide si son compte est supprimé (l'historique du propriétaire de la cave reste).
  user_id uuid references public.profiles (id) on delete set null,
  lot_id uuid not null references public.lots (id) on delete cascade,
  -- Lot jumeau créé pour une partie du lot ; vide quand tout le lot a changé de place.
  new_lot_id uuid references public.lots (id) on delete set null,
  quantity integer not null check (quantity between 1 and 10000),
  from_location uuid references public.locations (id) on delete set null,
  to_location uuid references public.locations (id) on delete set null,
  created_at timestamptz not null default now()
);
create index bottle_moves_user on public.bottle_moves (user_id);
create index bottle_moves_lot on public.bottle_moves (lot_id, created_at);
create index bottle_moves_new_lot on public.bottle_moves (new_lot_id) where new_lot_id is not null;
create index bottle_moves_from on public.bottle_moves (from_location) where from_location is not null;
create index bottle_moves_to on public.bottle_moves (to_location) where to_location is not null;

alter table public.bottle_moves enable row level security;
-- Écrit seulement par move_bottles ; lu par le propriétaire du lot et par la personne qui a déplacé.
create policy bottle_moves_read on public.bottle_moves for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from lots l where l.id = lot_id and l.owner_id = auth.uid()));
-- Même règle que les autres tables (alignement sur Cocon, 20261102000001).
create policy bottle_moves_mfa_ok on public.bottle_moves as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
grant select on public.bottle_moves to authenticated;

-- ───────────── 3. Déplacer des bouteilles ─────────────

-- p_location vide : « sans emplacement ». Retourne {lot_id, moved_lot_id, quantity} : moved_lot_id est le lot qui porte
-- désormais les bouteilles déplacées (le lot lui-même, ou son jumeau).
--
-- Stock : lots.quantity n'est pas modifiable par les comptes (absente du « grant update » de lots) ; seules les fonctions
-- de la base la changent. Aucun déclencheur ni aucune contrainte n'exige un mouvement pour la changer (record_movement et
-- les autres fonctions écrivent le mouvement elles-mêmes) : cette fonction retire donc les bouteilles du lot d'origine et
-- les met dans le jumeau directement, sans mouvement, le total du vin restant le même. lots_before vérifie toujours que
-- l'emplacement est dans la cave du lot, et « réservées ≤ stock » tient puisque seules les bouteilles libres partent.
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
  -- Double clic ou nouvel envoi : le déplacement déjà fait est renvoyé tel quel.
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
    -- Même partage que le lot d'origine : visible des mêmes groupes (sans bouteille mise à disposition) et mêmes
    -- exceptions par personne (lot masqué ou montré).
    insert into group_shares (lot_id, group_id, owner_id, allocated)
    select v_new, group_id, owner_id, 0 from group_shares where lot_id = p_lot;
    insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode)
    select owner_id, viewer_id, v_new, mode from cellar_access_exceptions where lot_id = p_lot;
  end if;
  insert into bottle_moves (request_id, user_id, lot_id, new_lot_id, quantity, from_location, to_location)
  values (p_request, v_me, p_lot, v_new, p_quantity, v_lot.location_id, p_location);
  return jsonb_build_object('lot_id', p_lot, 'moved_lot_id', coalesce(v_new, p_lot), 'quantity', p_quantity);
end $$;

-- ───────────── 4. Export « mes données » ─────────────

-- La version précédente (20261102000008) est gardée sous un autre nom ; la nouvelle y ajoute les déplacements.
alter function public.export_my_data() rename to export_my_data_v3;
revoke all on function public.export_my_data_v3() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return public.export_my_data_v3() || jsonb_build_object(
    'deplacements_de_bouteilles', coalesce((select jsonb_agg(jsonb_build_object(
                         -- Vin et emplacements seulement pour une cave que je gère encore (sinon : vides).
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

-- ───────────── 5. Droits ─────────────

revoke all on function public.move_bottles(uuid, integer, uuid, uuid), public.export_my_data() from public, anon;
grant execute on function public.move_bottles(uuid, integer, uuid, uuid), public.export_my_data() to authenticated;
grant execute on all functions in schema public to service_role;
