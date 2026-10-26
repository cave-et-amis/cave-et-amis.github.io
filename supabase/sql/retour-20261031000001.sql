-- Cave & Amis — retour arrière de 20261031000001_securite_priorite1.sql (seulement en cas de problème).
--
-- 1) Exécuter CE fichier dans Supabase › SQL Editor : l'état d'avant revient (suppression du compte en deux temps,
--    is_blocked_between appelable par les comptes).
-- 2) Redéployer cave-api et le site depuis la version précédente.
--
-- Rien n'est effacé. Attention : l'ancien comportement réintroduit les défauts corrigés (suppression d'événement ou de
-- compte bloquée par une note partagée, suppression partielle, blocages devinables).

drop trigger if exists events_before_delete_tastings on public.events;
drop trigger if exists profiles_before_delete on public.profiles;
drop function if exists public.events_before_delete_tastings();
drop function if exists public.profiles_before_delete();
drop function if exists public.account_cleanup(uuid);

-- prepare_account_deletion telle qu'avant (20261026000001_contacts_acces_cave.sql).
create or replace function public.prepare_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  r event_wines;
begin
  for r in select * from event_wines where owner_id = v_me and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  update wines set label_photo = null where owner_id <> v_me and label_photo like v_me::text || '/%';
  update wines set bottle_photo = null, bottle_photo_source = null, bottle_photo_credit = null, bottle_photo_original = null
  where owner_id <> v_me and bottle_photo like v_me::text || '/%';
  update wines set bottle_photo_original = null where owner_id <> v_me and bottle_photo_original like v_me::text || '/%';
  delete from group_shares where owner_id = v_me;
  delete from cellar_access where owner_id = v_me or viewer_id = v_me;
  delete from cellar_access_exceptions where owner_id = v_me or viewer_id = v_me;
  delete from cellar_access_requests where from_id = v_me or to_id = v_me;
  delete from lots where owner_id = v_me;
  delete from wines where owner_id = v_me;
  delete from cellars where owner_id = v_me;
end $$;

grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
