-- Cave & Amis — retour arrière de 20261102000007_soiree_achats.sql (seulement en cas de problème).
--
-- 0) Si la migration 20261102000008 (alerte de prix) est en place, exécuter d'abord retour-20261102000008.sql :
--    sinon l'export « mes données » de la migration 8 appellerait une fonction disparue.
-- 1) Republier d'abord le site d'avant (il n'utilise ni le mode soirée ni les achats groupés).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : les soirées en cours, leurs messages et leurs notes,
--    ainsi que tous les achats groupés (vins et parts) sont effacés. Le reste ne change pas.

-- Export « mes données » : la version d'avant (20261101000001) reprend son nom.
drop function if exists public.export_my_data();
alter function public.export_my_data_v1() rename to export_my_data;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.export_my_data() to service_role;

drop trigger if exists group_members_after_delete_purchases on public.group_members;
drop function if exists public.group_members_after_delete_purchases();
drop function if exists public.group_purchases_list(uuid);
drop function if exists public.set_group_purchase_status(uuid, text);
drop function if exists public.validate_purchase_parts(uuid, boolean);
drop function if exists public.set_purchase_part(uuid, integer);
drop function if exists public.remove_group_purchase_item(uuid);
drop function if exists public.add_group_purchase_item(uuid, jsonb);
drop function if exists public.create_group_purchase(uuid, jsonb);
drop function if exists public.open_purchase_group(uuid);
drop table if exists public.group_purchase_parts;
drop table if exists public.group_purchase_items;
drop table if exists public.group_purchases;

drop function if exists public.event_live_state(uuid);
drop function if exists public.vote_event_wine(uuid, smallint);
drop function if exists public.post_event_message(uuid, text);
drop function if exists public.end_event_live(uuid);
drop function if exists public.event_live_reveal(uuid, uuid);
drop function if exists public.event_live_serve(uuid, uuid);
drop function if exists public.start_event_live(uuid, boolean);
drop function if exists public.event_live_wine_ok(uuid, uuid);
drop table if exists public.event_votes;
drop table if exists public.event_messages;
drop table if exists public.event_live;
