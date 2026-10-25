-- Cave & Amis — retour arrière de 20261030000001_notifications_push.sql (seulement en cas de problème).
--
-- 1) Exécuter CE fichier dans Supabase › SQL Editor : plus aucune notification n'est mise en file ni envoyée.
-- 2) Redéployer cave-api et le site depuis la version précédente.
--
-- Rien n'est effacé : les abonnements des appareils, la file et les clés du serveur restent en base, sans effet. La
-- mise à jour pourra être rejouée plus tard telle quelle.

drop trigger if exists notifications_push on public.notifications;
drop trigger if exists push_outbox_kick on public.push_outbox;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'cave-push-retry'$q$;
  end if;
end $$;
