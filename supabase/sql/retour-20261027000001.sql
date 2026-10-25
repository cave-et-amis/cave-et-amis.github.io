-- Cave & Amis — retour arrière de 20261027000001_scanner.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api et le site depuis la version précédente (sans le scanner).
-- 2) Exécuter la requête A ci-dessous et garder son résultat : ce sont les photos des analyses, rangées dans le dossier
--    privé de chaque personne. Supabase interdit de les supprimer en SQL ; elles restent invisibles des autres et sont
--    supprimées avec le compte. Pour les retirer : Storage › photos, ou l'API de stockage avec la clé secrète.
-- 3) Exécuter la partie B dans Supabase › SQL Editor.
--
-- Sont conservés, sans effet une fois le scanner retiré : les colonnes scan_* de ai_settings, la valeur « scan »
-- autorisée dans ai_usage.action (les demandes déjà facturées gardent leur coût) et dans ai_conversations.context_kind,
-- et la version de admin_update_ai_settings qui sait les enregistrer.

-- A) Photos des analyses (à garder avant la partie B).
-- select p ->> 'path' as photo from public.scans s, jsonb_array_elements(s.photos) p;

-- B) Retrait du scanner.
drop table if exists public.scans;
drop table if exists public.scan_cache;
drop function if exists public.my_scan_status();
drop function if exists public.scan_quota(uuid);
drop function if exists public.scans_before();
