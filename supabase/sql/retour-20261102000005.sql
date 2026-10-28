-- Cave & Amis — retour arrière de 20261102000005_photo_profil.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il n'utilise pas la photo de profil).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : le lien vers la photo de profil de chacun est
--    effacé. Les fichiers restent dans le stockage ; la purge mensuelle des photos inutiles les supprimera ensuite.

-- Prénoms des autres : la version d'avant (20261101000003), sans la photo.
drop function if exists public.profile_names();
create function public.profile_names()
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name
  from profiles p
  where p.id = auth.uid() or public.is_connected(p.id) or public.shares_event(p.id)
  order by p.display_name, p.id
$$;
revoke all on function public.profile_names() from public, anon;
grant execute on function public.profile_names() to authenticated;
grant execute on function public.profile_names() to service_role;

-- Lecture des photos : la version d'avant (20261026000001).
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

-- Photos inutiles : la version d'avant (20261101000001).
create or replace function public.retention_orphan_photos(p_limit integer default 1000) returns table (name text)
language sql stable security definer set search_path = public, storage as $$
  select o.name::text from storage.objects o
  where o.bucket_id = 'photos' and o.created_at < now() - interval '30 days'
    and not exists (select 1 from wines w where o.name in (w.label_photo, w.bottle_photo, w.bottle_photo_original))
    and not exists (select 1 from tastings t where t.photo = o.name)
    and not exists (select 1 from groups g where g.photo = o.name)
    and not exists (select 1 from event_wines e where e.label_photo = o.name)
    and not exists (select 1 from scans s, jsonb_array_elements(s.photos) p where p ->> 'path' = o.name)
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 1000), 5000))
$$;

drop index if exists public.profiles_avatar_photo;
alter table public.profiles drop constraint if exists profiles_avatar_photo_check;
alter table public.profiles drop column if exists avatar_photo;
