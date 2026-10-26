-- Cave & Amis — durées de conservation : purge chaque nuit, et chaque mois purge des photos qui ne servent plus. Les deux
-- tâches appellent la fonction « cave-api » (actions retention_purge et photos_purge).
--
-- ATTENTION : chaque purge efface DÉFINITIVEMENT les données arrivées au terme de leur durée de conservation (liste dans
-- docs/SECURITE.md, « Durées de conservation »). À exécuter UNE fois dans Supabase › SQL Editor, avec l'accord du
-- responsable, après la migration 20261101000001_documents_legaux.sql et le déploiement de cave-api.
-- (Ce n'est pas une migration : il dépend de l'adresse du projet et des extensions hébergées.)
--
-- Le jeton des tâches planifiées est celui de public.nous_config (déjà utilisé pour Nous et les notifications) ; il est
-- lu à chaque appel et n'apparaît dans aucune définition. Rejouable sans danger. Pour arrêter les purges :
--   select cron.unschedule(jobid) from cron.job where jobname in ('cave-retention-daily', 'cave-photos-monthly');
-- L'offre gratuite de Supabase comprend pg_cron et pg_net. Les heures sont en temps universel (UTC).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('cave-retention-daily', 'cave-photos-monthly');

-- Chaque nuit à 2 h 20 (UTC) : conversations, journaux, relevés de prix, invitations, demandes refusées, scanner,
-- appareils de notification, preuves des comptes supprimés depuis plus de 5 ans.
select cron.schedule(
  'cave-retention-daily',
  '20 2 * * *',
  $$
  select net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"retention_purge"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Le 1er de chaque mois à 2 h 40 (UTC) : photos de plus de 30 jours qu'aucune fiche, dégustation, groupe, vin
-- d'événement ou analyse ne cite.
select cron.schedule(
  'cave-photos-monthly',
  '40 2 1 * *',
  $$
  select net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"photos_purge"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Vérification : les deux tâches doivent apparaître.
select jobname, schedule from cron.job where jobname in ('cave-retention-daily', 'cave-photos-monthly') order by jobname;
