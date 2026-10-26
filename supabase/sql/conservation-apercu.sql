-- Cave & Amis — aperçu des purges de conservation : combien de lignes chaque purge effacerait si elle passait maintenant.
--
-- LECTURE SEULE : ce script ne modifie ni ne supprime rien, et ne montre que des nombres (jamais le contenu). À exécuter
-- dans Supabase › SQL Editor avant de poser les purges (supabase/sql/conservation.sql), puis à tout moment pour
-- contrôler. Mêmes règles que retention_purge (migration 20261101000001_documents_legaux.sql), que les analyses du
-- scanner et les photos supprimées par cave-api, et que rate_purge (migration 20261101000004_durcissements.sql) ; un test
-- vérifie qu'il annonce exactement ce que la purge efface (tests/sql/documents-legaux.test.ts).
select cle, donnees, a_effacer from (values
  (1, 'scans', 'Analyses du scanner arrivées à échéance (30 jours), avec leurs photos',
    (select count(*)::int from public.scans s where s.expires_at < now())),
  (2, 'conversations', 'Conversations avec Lia (12 mois après le dernier message)',
    (select count(*)::int from public.ai_conversations c where c.updated_at < now() - interval '12 months'
       and not exists (select 1 from public.ai_messages m where m.conversation_id = c.id and m.created_at >= now() - interval '12 months'))),
  (3, 'ai_usage', 'Journaux d''usage de l''assistant (13 mois)',
    (select count(*)::int from public.ai_usage where created_at < now() - interval '13 months')),
  (4, 'ai_errors', 'Journaux d''erreurs techniques (3 mois)',
    (select count(*)::int from public.ai_errors where created_at < now() - interval '3 months')),
  (5, 'price_checks', 'Relevés de prix (24 mois)',
    (select count(*)::int from public.price_checks where created_at < now() - interval '24 months')),
  (6, 'invites', 'Liens d''invitation expirés ou annulés (90 jours)',
    (select count(*)::int from public.friend_invites i where i.expires_at < now() - interval '90 days'
       or (i.status = 'revoked' and coalesce(i.responded_at, i.created_at) < now() - interval '90 days'))),
  (7, 'friend_requests', 'Demandes de contact refusées (6 mois)',
    (select count(*)::int from public.friend_requests r
       where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months')),
  (8, 'access_requests', 'Demandes d''accès à une cave refusées (6 mois)',
    (select count(*)::int from public.cellar_access_requests r
       where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months')),
  (9, 'scan_visits', 'Visites de magasin (30 jours), une fois leurs analyses parties',
    (select count(*)::int from public.scan_visits v where v.created_at < now() - interval '30 days'
       and not exists (select 1 from public.scans s where s.visit_id = v.id and s.expires_at >= now()))),
  (10, 'push_devices', 'Appareils de notification qui ne répondent plus (90 jours)',
    (select count(*)::int from public.push_subscriptions s
       where s.failures > 0 and coalesce(s.last_success_at, s.created_at) < now() - interval '90 days')),
  (11, 'legal_acceptances', 'Preuves d''acceptation des comptes supprimés depuis plus de 5 ans',
    (select count(*)::int from public.legal_acceptances where account_deleted_at < now() - interval '5 years')),
  (12, 'user_consents', 'Historique des consentements des comptes supprimés depuis plus de 5 ans',
    (select count(*)::int from public.user_consents where account_deleted_at < now() - interval '5 years')),
  (13, 'rate_hits', 'Compteurs des limites de fréquence (1 jour)',
    (select count(*)::int from public.rate_hits where at < now() - interval '1 day')),
  (14, 'photos', 'Photos de plus de 30 jours que rien ne cite (le 1er du mois, 2 000 par passage ; comptées jusqu''à 5 000)',
    (select count(*)::int from public.retention_orphan_photos(5000)))
) as t(ordre, cle, donnees, a_effacer)
order by ordre;
