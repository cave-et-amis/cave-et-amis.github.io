-- Cave & Amis — retour arrière de 20261102000006_profil_gustatif.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il n'utilise pas ces repères).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : les repères fruité, puissance, boisé et minéralité
--    notés dans les fiches de dégustation sont effacés ; le reste des fiches ne change pas.

-- Création d'une dégustation : la version d'avant (20261025000008).
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

revoke update (fruite, puissance, boise, mineralite) on public.tastings from authenticated;
alter table public.tastings drop constraint if exists tastings_profil_check;
alter table public.tastings drop column if exists fruite;
alter table public.tastings drop column if exists puissance;
alter table public.tastings drop column if exists boise;
alter table public.tastings drop column if exists mineralite;
