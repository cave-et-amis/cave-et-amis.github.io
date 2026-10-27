-- Cave & Amis — alertes de maturité : tâche planifiée (à exécuter une fois dans Supabase › SQL Editor, après la
-- migration 20261102000004_maturite.sql, et seulement avec l'accord de l'éditeur).
--
-- Chaque matin à 7 h 10 (temps universel), maturity_alerts() prévient les personnes qui l'ont demandé dans les Réglages.
-- Sans danger si elle tourne deux fois : une alerte par vin et par type au plus chaque année.
-- Pour l'arrêter : select cron.unschedule('cave-maturity-daily');

select cron.schedule('cave-maturity-daily', '10 7 * * *', $$select public.maturity_alerts()$$);
