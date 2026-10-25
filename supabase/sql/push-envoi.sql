-- Cave & Amis — envoi des notifications push : appelle la fonction « cave-api » (action push_flush) dès qu'une
-- notification est mise en file, et chaque minute pour les nouvelles tentatives.
-- À exécuter UNE fois dans Supabase › SQL Editor, après la migration 20261030000001_notifications_push.sql et après le
-- déploiement de cave-api. (Ce n'est pas une migration : il dépend de l'adresse du projet et des extensions hébergées.)
-- Le jeton des tâches planifiées est celui de public.nous_config (déjà utilisé pour Nous) ; il est lu à chaque appel et
-- n'apparaît dans aucune définition. L'offre gratuite de Supabase comprend pg_cron et pg_net.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Envoi immédiat : un appel par instruction qui met des notifications en file (pas un par ligne). pg_net envoie la
-- requête après la validation de la transaction : la fonction trouve donc la file à jour.
create or replace function public.push_kick() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"push_flush"}'::jsonb,
    timeout_milliseconds := 20000
  );
  return null;
end $$;

drop trigger if exists push_outbox_kick on public.push_outbox;
create trigger push_outbox_kick after insert on public.push_outbox
  for each statement execute function public.push_kick();

-- Filet de sécurité : nouvelles tentatives chaque minute, seulement s'il reste des envois dus (aucun appel sinon).
select cron.unschedule(jobid) from cron.job where jobname = 'cave-push-retry';
select cron.schedule(
  'cave-push-retry',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"push_flush"}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (select 1 from public.push_outbox o where o.sent_at is null and o.next_attempt_at <= now() and o.attempts < 5);
  $$
);

-- Vérification : le déclencheur et la tâche doivent apparaître.
select tgname from pg_trigger where tgname in ('notifications_push', 'push_outbox_kick') order by tgname;
select jobname, schedule, active from cron.job where jobname = 'cave-push-retry';
