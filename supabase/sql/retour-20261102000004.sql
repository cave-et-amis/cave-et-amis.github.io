-- Cave & Amis — retour arrière de 20261102000004_maturite.sql (seulement en cas de problème).
--
-- 1) Arrêter d'abord la tâche planifiée, si elle a été activée : select cron.unschedule('cave-maturity-daily');
-- 2) Republier le site d'avant, puis exécuter CE fichier dans Supabase › SQL Editor. Les alertes de maturité déjà
--    reçues sont effacées (la liste des types de notification d'avant ne les accepte pas).

drop function if exists public.maturity_alerts();
drop table if exists public.maturity_alerts_sent;
delete from public.notifications where kind in ('maturity_ready', 'maturity_last', 'maturity_many');
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked'));
