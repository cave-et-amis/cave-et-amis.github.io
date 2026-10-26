-- Cave & Amis — sécurité, priorité 1 (audit du 26/10/2026).
--
-- 1. Supprimer un événement (ou le compte de son organisateur) ne bute plus sur une note de dégustation qu'un invité
--    avait partagée avec cet événement : la note redevient privée chez son auteur, puis l'événement disparaît.
-- 2. Suppression du compte « tout ou rien » : le nettoyage (réservations, photos prêtées, partages, accès, lots, vins,
--    caves) se fait maintenant PENDANT la suppression du compte, dans la même transaction. Si quoi que ce soit échoue,
--    rien n'est effacé. prepare_account_deletion ne supprime plus rien (gardée pour la compatibilité).
-- 3. Les blocages ne se devinent plus : is_blocked_between n'est plus appelable directement par les comptes. Toutes les
--    fonctions qui l'utilisent s'exécutent avec les droits du serveur, et aucune règle d'accès ne l'appelle.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261030000001_notifications_push.sql. Rejouable sans
-- danger. La mise à jour elle-même ne modifie aucune donnée. Retour arrière : supabase/sql/retour-20261031000001.sql.

-- ───────────── 1. Événement supprimé : les notes partagées avec lui redeviennent privées ─────────────

create or replace function public.events_before_delete_tastings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Leur auteur les garde dans son carnet ; seul le partage avec l'événement disparaît (sinon la règle
  -- « une note partagée a un événement » interdirait la suppression).
  update tastings set share_with_event = false where event_id = old.id and share_with_event;
  return old;
end $$;

drop trigger if exists events_before_delete_tastings on public.events;
create trigger events_before_delete_tastings before delete on public.events
  for each row execute function public.events_before_delete_tastings();

-- ───────────── 2. Suppression du compte en une seule transaction ─────────────

-- Nettoyage d'un compte supprimé (mêmes étapes qu'avant, dans le même ordre) : appelé par le déclencheur ci-dessous,
-- jamais directement par une personne.
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

-- La suppression du compte (auth.users) efface le profil en cascade : le nettoyage a lieu juste avant, dans la même
-- transaction. Une erreur plus loin annule tout, nettoyage compris.
create or replace function public.profiles_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.account_cleanup(old.id);
  return old;
end $$;

drop trigger if exists profiles_before_delete on public.profiles;
create trigger profiles_before_delete before delete on public.profiles
  for each row execute function public.profiles_before_delete();

-- Conservée pour la compatibilité (ancienne fonction serveur, tests) : elle ne supprime plus rien.
create or replace function public.prepare_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
end $$;

-- ───────────── 3. Blocages ─────────────

revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

-- ───────────── Droits ─────────────

revoke execute on function public.account_cleanup(uuid), public.profiles_before_delete(), public.events_before_delete_tastings()
from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
