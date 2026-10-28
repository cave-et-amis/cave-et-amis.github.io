-- Cave & Amis — retour arrière de 20261102000009_cave_visuelle.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il n'utilise ni la cave visuelle ni le déplacement de bouteilles).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : l'historique des déplacements et la disposition
--    des étagères (rangées, places par rangée) sont effacés. Les bouteilles restent où elles ont été déplacées : les lots
--    jumeaux déjà créés sont des lots ordinaires et restent en place, le stock ne change pas.

-- Export « mes données » : la version d'avant (20261102000008) reprend son nom.
drop function if exists public.export_my_data();
alter function public.export_my_data_v3() rename to export_my_data;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.export_my_data() to service_role;

drop function if exists public.move_bottles(uuid, integer, uuid, uuid);
drop table if exists public.bottle_moves;
alter table public.locations drop column if exists slots_per_row;
alter table public.locations drop constraint if exists locations_layout_check;
alter table public.locations drop column if exists rows;
