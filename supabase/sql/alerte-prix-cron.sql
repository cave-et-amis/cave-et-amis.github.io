-- Cave & Amis — alertes de baisse de prix : appelle la fonction « cave-api » (action price_alerts_run) le vendredi soir.
-- À exécuter UNE fois dans Supabase › SQL Editor, après la migration 20261102000008_alerte_prix.sql et après le
-- déploiement de cave-api. (Ce n'est pas une migration : il dépend de l'adresse du projet et des extensions hébergées.)
-- Décision de l'utilisateur du 28/10/2026 : une vérification par semaine au plus, le vendredi soir ; un vin suivi par
-- personne ; 2 $ par mois au plus pour toutes les alertes (ai_settings.price_alert_budget_usd), dans le budget de
-- l'assistant. La fonction ne fait rien un autre jour, ni avant 18 h (heure de Paris), même si la tâche est lancée.
-- L'offre gratuite de Supabase comprend pg_cron et pg_net.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'cave-alerte-prix';

-- Vendredi 19 h UTC (20 h à Paris en hiver, 21 h en été). Rien n'est appelé si aucun vin n'est suivi.
select cron.schedule(
  'cave-alerte-prix',
  '0 19 * * 5',
  $$
  select net.http_post(
    url := 'https://ogkmucrjqomsqtjmkipd.supabase.co/functions/v1/cave-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select c.cron_token from public.nous_config c where c.id = 1)
    ),
    body := '{"action":"price_alerts_run"}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (select 1 from public.price_watches);
  $$
);

-- Vérification : la tâche doit apparaître, active.
select jobname, schedule, active from cron.job where jobname = 'cave-alerte-prix';

-- Pour arrêter les alertes : select cron.unschedule('cave-alerte-prix');
