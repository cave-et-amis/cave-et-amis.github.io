-- Cave & Amis — retour arrière de 20261026000002_accueil_invitations.sql (seulement en cas de problème).
--
-- 1) Exécuter CE fichier dans Supabase › SQL Editor.
-- 2) Puis exécuter à nouveau 20261026000001_contacts_acces_cave.sql (rejouable) : il remet les versions précédentes de
--    create_invite, my_relations, friend_invite_info, respond_friend_invite, grant_cellar_access, cellar_open_to,
--    lot_visible_to et cellar_view.
-- 3) Redéployer cave-api et le site depuis la version précédente.
--
-- Par prudence, les accès que les anciennes règles ne sauraient plus limiter sont FERMÉS (la relation est gardée) :
-- un accès limité à une sélection deviendrait un accès à toute la cave partagée, et un accès avec date de fin
-- deviendrait permanent. Chacun pourra rouvrir sa cave à ces personnes. Les nouvelles colonnes (scope, expires_at, code,
-- note, options) sont conservées : elles n'ont plus d'effet une fois les anciennes fonctions rétablies.

delete from public.cellar_access where scope = 'selection' or expires_at is not null;

drop function if exists public.set_cellar_access_options(uuid, jsonb);
drop function if exists public.merge_preferences(jsonb);
drop function if exists public.my_invite_redemptions();
drop function if exists public.create_invite(text, uuid, jsonb);
drop function if exists public.my_relations();
