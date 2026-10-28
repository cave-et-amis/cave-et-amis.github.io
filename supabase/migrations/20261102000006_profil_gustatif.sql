-- Cave & Amis 2.0 — profil gustatif d'une dégustation (radar de « Mes goûts »).
--
-- Quatre repères facultatifs, de 1 (discret) à 5 (intense), notés par la personne dans sa fiche de dégustation : fruité,
-- puissance, boisé, minéralité. Le cinquième axe du radar, l'acidité, reprend le champ qui existe déjà (faible, moyenne,
-- vive). Le radar est calculé dans l'application à partir des seules dégustations de la personne, sans IA.
-- Ces repères suivent exactement les règles des observations de la fiche (robe, nez, acidité…) : lisibles par la personne
-- seule, sauf dans une note qu'elle partage avec un événement (event_tastings, comme l'acidité) ; modifiables, exportés
-- avec la fiche (export « mes données »), supprimés avec elle ou avec le compte.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000005_photo_profil.sql. Rejouable sans danger. Ne
-- modifie aucune donnée existante. À déployer AVANT le nouveau site (l'ancien site ignore les nouvelles colonnes).
-- Retour arrière : supabase/sql/retour-20261102000006.sql.

alter table public.tastings add column if not exists fruite smallint;
alter table public.tastings add column if not exists puissance smallint;
alter table public.tastings add column if not exists boise smallint;
alter table public.tastings add column if not exists mineralite smallint;
alter table public.tastings drop constraint if exists tastings_profil_check;
alter table public.tastings add constraint tastings_profil_check check (
  (fruite is null or fruite between 1 and 5) and (puissance is null or puissance between 1 and 5)
  and (boise is null or boise between 1 and 5) and (mineralite is null or mineralite between 1 and 5)
);

grant update (fruite, puissance, boise, mineralite) on public.tastings to authenticated;

-- Création d'une dégustation : version précédente (20261025000008), avec les quatre repères en plus.
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
    currency, rebuy, favorite, photo, share_with_event, group_id, request_id, fruite, puissance, boise, mineralite
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
    coalesce((p ->> 'share_with_event')::boolean, false), nullif(p ->> 'group_id', '')::uuid, p_request,
    nullif(p ->> 'fruite', '')::smallint, nullif(p ->> 'puissance', '')::smallint, nullif(p ->> 'boise', '')::smallint,
    nullif(p ->> 'mineralite', '')::smallint
  ) returning * into v_row;
  return v_row;
end $$;

