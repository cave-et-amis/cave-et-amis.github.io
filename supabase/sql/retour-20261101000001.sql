-- Cave & Amis — retour arrière de 20261101000001_documents_legaux.sql (seulement en cas de problème).
--
-- ATTENTION : ce retour arrière supprime les documents publiés, les preuves d'acceptation et l'historique des
-- consentements. À n'utiliser qu'avant la première publication d'un document, ou après avoir sauvegardé les tables
-- legal_documents, legal_acceptances et user_consents.
--
-- 1) Exécuter CE fichier dans Supabase › SQL Editor. Il retire aussi les tâches planifiées des durées de conservation
--    (supabase/sql/conservation.sql) si elles ont été posées.
-- 2) Redéployer cave-api et le site depuis la version précédente.
--
-- Les données purgées entre-temps par les durées de conservation ne reviennent pas : une purge est définitive.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('cave-retention-daily', 'cave-photos-monthly');
  end if;
end $$;

drop trigger if exists profiles_after_delete_legal on public.profiles;
drop trigger if exists profiles_consent_discoverable on public.profiles;
drop trigger if exists nous_links_consent on public.nous_links;

drop function if exists public.export_my_data();
drop function if exists public.retention_purge();
drop function if exists public.retention_orphan_photos(integer);
drop function if exists public.admin_legal_stats();
drop function if exists public.admin_legal_publish(text, text, text, text, boolean);
drop function if exists public.admin_strong_session();
drop function if exists public.my_legal_history();
drop function if exists public.legal_accept(uuid, text, text);
drop function if exists public.legal_pending();
drop function if exists public.legal_current();
drop function if exists public.consent_set(text, boolean, text);
drop function if exists public.nous_links_consent();
drop function if exists public.profiles_consent_discoverable();
drop function if exists public.consent_note(uuid, text, boolean, text);
drop function if exists public.has_consent(uuid, text);
drop function if exists public.legal_current_version(text);
drop function if exists public.profiles_after_delete_legal();

drop table if exists public.legal_acceptances;
drop table if exists public.user_consents;
drop table if exists public.legal_documents;

drop function if exists public.legal_append_only();
drop function if exists public.legal_immutable();
drop function if exists public.legal_fill_hash();

-- Création d'un compte : version d'avant (profil, premier administrateur, première cave).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_first boolean;
begin
  perform pg_advisory_xact_lock(4242);
  v_name := left(btrim(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1), '')), 40);
  if v_name = '' then
    v_name := 'Amateur';
  end if;
  select not exists (select 1 from profiles) into v_first;
  insert into profiles (id, display_name, is_admin) values (new.id, v_name, v_first);
  insert into cellars (owner_id, name) values (new.id, 'Ma cave');
  return new;
end $$;
