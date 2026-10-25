-- Cave & Amis — retour arrière de 20261025000007_integration_nous.sql.
-- Ne supprime QUE les objets ajoutés par l'intégration Nous (liaisons, codes, file d'envoi) : aucun événement, participant
-- ni bouteille n'est touché. À exécuter dans Supabase › SQL Editor, après avoir arrêté la tâche planifiée :
--   select cron.unschedule('cave-nous-sync');

drop trigger if exists events_nous on public.events;
drop trigger if exists events_nous_deleting on public.events;
drop trigger if exists event_participants_nous on public.event_participants;
drop trigger if exists event_wines_nous on public.event_wines;
drop trigger if exists nous_links_deleted on public.nous_links;

drop function if exists public.nous_events_changed();
drop function if exists public.nous_events_deleting();
drop function if exists public.nous_participants_changed();
drop function if exists public.nous_wines_changed();
drop function if exists public.nous_links_deleted();
drop function if exists public.nous_enqueue_event(uuid);
drop function if exists public.nous_enqueue_user(uuid, uuid, text);
drop function if exists public.nous_backfill(uuid);
drop function if exists public.nous_link_create();
drop function if exists public.nous_unlink();
drop function if exists public.nous_set_sync(boolean);
drop function if exists public.nous_link_peek(text);
drop function if exists public.nous_link_redeem(text, uuid, text);
drop function if exists public.nous_code_owner(text);
drop function if exists public.nous_link_check(uuid, uuid);
drop function if exists public.nous_link_revoked(uuid, uuid);
drop function if exists public.nous_event_payload(uuid, uuid);
drop function if exists public.nous_version();
drop function if exists public.nous_outbox_claim(integer);
drop function if exists public.nous_outbox_done(bigint, integer, boolean, text);
drop function if exists public.nous_respond(uuid, uuid, uuid, text);
drop function if exists public.nous_cron_token_ok(text);
drop function if exists public.nous_zero_uuid();

drop table if exists public.nous_outbox;
drop table if exists public.nous_link_codes;
drop table if exists public.nous_links;
drop table if exists public.nous_config;
