-- Cave & Amis — envoi des événements vers Nous : appelle la fonction « cave-api » (action nous_flush) chaque minute.
-- À exécuter UNE fois dans Supabase › SQL Editor, après la migration 20261025000007_integration_nous.sql
-- (qui crée le jeton dans public.nous_config) et après le déploiement de cave-api.
-- (Ce n'est pas une migration : il dépend de l'adresse du projet et des extensions hébergées.)
-- L'offre gratuite de Supabase comprend pg_cron et pg_net.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remplace la planification si elle existe déjà.
select cron.unschedule(jobid) from cron.job where jobname = 'cave-nous-sync';

-- Le jeton est lu à chaque exécution : il n'apparaît pas dans la définition de la tâche.
-- Rien n'est appelé s'il n'y a aucun envoi en attente (aucun coût d'invocation inutile).
select cron.schedule(
  'cave-nous-sync',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"nous_flush"}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (select 1 from public.nous_outbox o where o.sent_at is null and o.next_attempt_at <= now() and o.attempts < 20);
  $$
);

-- Vérification : la tâche doit apparaître, active.
select jobname, schedule, active from cron.job where jobname = 'cave-nous-sync';
