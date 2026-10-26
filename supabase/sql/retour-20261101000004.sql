-- Cave & Amis — retour arrière de 20261101000004_durcissements.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api depuis la version précédente : la nouvelle appelle rate_take et rate_purge.
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor : l'état d'avant revient (aucune limite de fréquence en base,
--    détail des erreurs gardé tel quel sur 500 caractères, prénom gardé chez les autres après la suppression d'un compte).
--
-- Seuls les compteurs de fréquence (table rate_hits) sont effacés. Les détails d'erreurs déjà nettoyés et les prénoms
-- déjà remplacés par « Ancien membre » restent tels quels.

drop trigger if exists friend_invites_rate on public.friend_invites;
drop function if exists public.friend_invites_rate();

-- Journal des erreurs : version d'avant (20261019000001_init.sql), avant de retirer la fonction de nettoyage.
create or replace function public.ai_log_error(p_user uuid, p_action text, p_code text, p_detail text, p_model text) returns void
language sql security definer set search_path = public as $$
  insert into ai_errors (user_id, action, code, detail, model) values (p_user, p_action, left(p_code, 60), left(p_detail, 500), left(p_model, 80))
$$;
drop function if exists public.clean_error_detail(text);

-- Nettoyage d'un compte supprimé : version d'avant (20261031000001_securite_priorite1.sql), avant de retirer les compteurs.
create or replace function public.account_cleanup(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r event_wines;
begin
  for r in select * from event_wines where owner_id = p_user and status = 'confirmed' for update loop
    perform release_event_wine(r, 'withdrawn');
  end loop;
  update wines set label_photo = null where owner_id <> p_user and label_photo like p_user::text || '/%';
  update wines set bottle_photo = null, bottle_photo_source = null, bottle_photo_credit = null, bottle_photo_original = null
  where owner_id <> p_user and bottle_photo like p_user::text || '/%';
  update wines set bottle_photo_original = null where owner_id <> p_user and bottle_photo_original like p_user::text || '/%';
  delete from group_shares where owner_id = p_user;
  delete from cellar_access where owner_id = p_user or viewer_id = p_user;
  delete from cellar_access_exceptions where owner_id = p_user or viewer_id = p_user;
  delete from cellar_access_requests where from_id = p_user or to_id = p_user;
  -- Dans l'ordre (lots, vins, caves) : la protection « cave non vide » refuserait sinon la suppression des caves.
  delete from lots where owner_id = p_user;
  delete from wines where owner_id = p_user;
  delete from cellars where owner_id = p_user;
end $$;

drop function if exists public.rate_purge();
drop function if exists public.rate_take(text, text, integer, integer);
drop table if exists public.rate_hits;
