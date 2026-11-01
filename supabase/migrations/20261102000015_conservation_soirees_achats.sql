-- Cave & Amis — durées de conservation du mode soirée, des achats groupés et des déplacements (décision de l'éditeur du
-- 01/11/2026, après l'audit de sécurité, constat R3 ; politique de confidentialité version 4, publiée AVEC cette purge) :
-- - messages et notes d'une soirée : effacés 12 mois après la date de l'événement (events.starts_at) ;
-- - achats groupés clos ou annulés : effacés 12 mois après leur clôture (closed_at), avec leurs vins et leurs parts ;
--   un achat encore ouvert reste ;
-- - historique des déplacements de bouteilles (bottle_moves) : effacé 24 mois après le déplacement.
-- retention_purge (purge de chaque nuit) reprend celle de 20261102000001 et y ajoute ces quatre règles.
--
-- UNE PURGE EST IRRÉVERSIBLE : avant de l'exécuter, lancer l'aperçu en lecture seule (supabase/sql/conservation-apercu.sql)
-- et obtenir l'accord de l'éditeur. À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000014. Ne
-- supprime rien par elle-même : la purge passe la nuit suivante (tâche cave-retention-daily). Retour arrière (avant la
-- première purge) : supabase/sql/retour-20261102000015.sql.

create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_conversations integer;
  v_usage integer;
  v_errors integer;
  v_prices integer;
  v_invites integer;
  v_requests integer;
  v_access integer;
  v_visits integer;
  v_devices integer;
  v_proofs integer;
  v_consents integer;
  v_audit integer;
  v_messages integer;
  v_votes integer;
  v_purchases integer;
  v_moves integer;
begin
  -- Conversations avec Lia : 12 mois après le dernier message.
  delete from ai_conversations c where c.updated_at < now() - interval '12 months'
    and not exists (select 1 from ai_messages m where m.conversation_id = c.id and m.created_at >= now() - interval '12 months');
  get diagnostics v_conversations = row_count;
  -- Journaux d'usage de l'IA : 13 mois ; erreurs techniques : 3 mois.
  delete from ai_usage where created_at < now() - interval '13 months';
  get diagnostics v_usage = row_count;
  delete from ai_errors where created_at < now() - interval '3 months';
  get diagnostics v_errors = row_count;
  -- Relevés de prix : 24 mois.
  delete from price_checks where created_at < now() - interval '24 months';
  get diagnostics v_prices = row_count;
  -- Liens d'invitation : 90 jours après leur expiration ou leur annulation (code et note « Pour qui ? » partent avec la
  -- ligne). Un lien annulé avant cette mise à jour n'a pas de date d'annulation : sa date d'expiration compte.
  delete from friend_invites i where least(i.expires_at, i.revoked_at) < now() - interval '90 days';
  get diagnostics v_invites = row_count;
  -- Demandes de contact ou d'accès refusées : 6 mois.
  delete from friend_requests r where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months';
  get diagnostics v_requests = row_count;
  delete from cellar_access_requests r where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months';
  get diagnostics v_access = row_count;
  -- Visites de magasin : 30 jours, une fois leurs analyses supprimées.
  delete from scan_visits v where v.created_at < now() - interval '30 days'
    and not exists (select 1 from scans s where s.visit_id = v.id);
  get diagnostics v_visits = row_count;
  delete from scan_cache where expires_at < now();
  -- Appareils de notification qui ne répondent plus depuis 90 jours.
  delete from push_subscriptions s where s.failures > 0 and coalesce(s.last_success_at, s.created_at) < now() - interval '90 days';
  get diagnostics v_devices = row_count;
  -- Preuves et consentements : 5 ans après la suppression du compte. Un compte disparu sans passer par la suppression
  -- habituelle (tableau de bord) est rattrapé ici.
  update legal_acceptances a set account_deleted_at = now()
    where a.account_deleted_at is null and not exists (select 1 from auth.users u where u.id = a.user_id);
  update user_consents c set account_deleted_at = now()
    where c.account_deleted_at is null and not exists (select 1 from auth.users u where u.id = c.user_id);
  perform set_config('cave.legal_purge', 'on', true);
  delete from legal_acceptances where account_deleted_at < now() - interval '5 years';
  get diagnostics v_proofs = row_count;
  delete from user_consents where account_deleted_at < now() - interval '5 years';
  get diagnostics v_consents = row_count;
  perform set_config('cave.legal_purge', 'off', true);
  -- Journal des actions de l'administrateur : 12 mois.
  perform set_config('cave.audit_purge', 'on', true);
  delete from admin_audit_log where at < now() - interval '12 months';
  get diagnostics v_audit = row_count;
  perform set_config('cave.audit_purge', 'off', true);
  -- Mode soirée : messages et notes, 12 mois après la date de l'événement (décision du 01/11/2026).
  delete from event_messages m using events e where e.id = m.event_id and e.starts_at < now() - interval '12 months';
  get diagnostics v_messages = row_count;
  delete from event_votes v using event_wines w, events e
    where w.id = v.event_wine_id and e.id = w.event_id and e.starts_at < now() - interval '12 months';
  get diagnostics v_votes = row_count;
  -- Achats groupés clos ou annulés : 12 mois après la clôture, avec leurs vins et leurs parts (cascade). Un achat ouvert reste.
  delete from group_purchases where status in ('closed', 'cancelled') and closed_at < now() - interval '12 months';
  get diagnostics v_purchases = row_count;
  -- Historique des déplacements de bouteilles : 24 mois.
  delete from bottle_moves where created_at < now() - interval '24 months';
  get diagnostics v_moves = row_count;
  return jsonb_build_object('conversations', v_conversations, 'ai_usage', v_usage, 'ai_errors', v_errors, 'price_checks', v_prices,
    'invites', v_invites, 'friend_requests', v_requests, 'access_requests', v_access, 'scan_visits', v_visits,
    'push_devices', v_devices, 'legal_acceptances', v_proofs, 'user_consents', v_consents, 'admin_audit', v_audit,
    'event_messages', v_messages, 'event_votes', v_votes, 'group_purchases', v_purchases, 'bottle_moves', v_moves);
end $$;

revoke all on function public.retention_purge() from public, anon, authenticated;
grant execute on function public.retention_purge() to service_role;
