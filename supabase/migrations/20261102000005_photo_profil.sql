-- Cave & Amis 2.0 — photo de profil (facultative).
--
-- Chacun peut ajouter une photo à son profil, la changer ou la retirer.
--  1. profiles.avatar_photo : chemin de la photo dans le stockage privé « photos », toujours dans le dossier de la
--     personne et nommé avatar-… (une photo d'un vin ou d'une dégustation ne peut pas devenir une photo de profil).
--  2. Qui la voit : les personnes qui voient déjà le prénom (moi, mes contacts, les participants d'un même événement),
--     par profile_names() et can_read_photo(), sauf une personne bloquée (dans un sens ou dans l'autre). Rien de plus.
--  3. Une ancienne photo de profil qui ne sert plus est supprimée avec les autres photos inutiles (purge mensuelle).
-- L'export « mes données » la contient déjà (ligne du profil et liste des photos) ; la suppression du compte efface
-- tout le dossier de la personne, photo comprise.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000004_maturite.sql. Rejouable sans danger. Ne
-- modifie aucune donnée existante. À déployer AVANT le nouveau site (l'ancien site ignore la nouvelle colonne).
-- Retour arrière : supabase/sql/retour-20261102000005.sql.

-- ───────────── 1. Colonne ─────────────

alter table public.profiles add column if not exists avatar_photo text;
alter table public.profiles drop constraint if exists profiles_avatar_photo_check;
alter table public.profiles add constraint profiles_avatar_photo_check
  check (avatar_photo is null or avatar_photo ~ ('^' || id::text || '/avatar-[a-z0-9-]{6,60}\.jpg$'));
create index if not exists profiles_avatar_photo on public.profiles (avatar_photo) where avatar_photo is not null;

grant update (avatar_photo) on public.profiles to authenticated;

-- ───────────── 2. Prénom et photo des autres ─────────────

-- Même règle qu'avant (moi, mes contacts, les participants d'un même événement), avec la photo en plus : jamais pour une
-- personne bloquée (un participant d'un même événement garde son prénom, comme avant).
drop function if exists public.profile_names();
create function public.profile_names()
returns table (id uuid, display_name text, avatar_photo text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name,
    case when p.id = auth.uid() or not public.is_blocked_between(auth.uid(), p.id) then p.avatar_photo end
  from profiles p
  where p.id = auth.uid() or public.is_connected(p.id) or public.shares_event(p.id)
  order by p.display_name, p.id
$$;

-- Lecture d'une photo : règle précédente (20261026000001), plus la photo de profil des personnes dont je vois le prénom.
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

-- ───────────── 3. Anciennes photos de profil ─────────────

-- Règle précédente (20261101000001), sans toucher à la photo de profil en cours.
create or replace function public.retention_orphan_photos(p_limit integer default 1000) returns table (name text)
language sql stable security definer set search_path = public, storage as $$
  select o.name::text from storage.objects o
  where o.bucket_id = 'photos' and o.created_at < now() - interval '30 days'
    and not exists (select 1 from wines w where o.name in (w.label_photo, w.bottle_photo, w.bottle_photo_original))
    and not exists (select 1 from tastings t where t.photo = o.name)
    and not exists (select 1 from groups g where g.photo = o.name)
    and not exists (select 1 from event_wines e where e.label_photo = o.name)
    and not exists (select 1 from scans s, jsonb_array_elements(s.photos) p where p ->> 'path' = o.name)
    and not exists (select 1 from profiles pr where pr.avatar_photo = o.name)
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 1000), 5000))
$$;

-- ───────────── 4. Droits ─────────────

revoke all on function public.profile_names() from public, anon;
grant execute on function public.profile_names() to authenticated;
grant execute on all functions in schema public to service_role;
