-- Cave & Amis — retour arrière de 20261101000002_liaison_nous_durcie.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api et le site depuis la version précédente : la nouvelle cave-api refuse toutes les
--    requêtes de Nous tant que l'anti-rejeu manque, alors que l'ancienne fonctionne avec cette mise à jour en place.
-- 2) Exécuter ensuite CE fichier dans Supabase › SQL Editor.
--
-- Effacés : les avis « Votre compte est relié à l'agenda Nous… » (l'ancienne version ne sait pas les afficher) et les
-- empreintes de l'anti-rejeu (10 minutes au plus). Gardé, sans effet : le choix « ouvrir depuis Nous sans mot de passe »
-- de chaque liaison (colonne nous_links.allow_jump), retrouvé tel quel si la mise à jour est rejouée.
-- Attention : l'ancienne version ouvre de nouveau Cave & Amis depuis Nous sans mot de passe pour toutes les liaisons,
-- accepte une requête signée rejouée et ne prévient plus des nouvelles liaisons.

drop trigger if exists nous_links_notify on public.nous_links;
drop function if exists public.nous_links_notify();
drop function if exists public.nous_set_allow_jump(boolean);
drop function if exists public.nous_jump_check(uuid, uuid);
drop function if exists public.eco_replay_claim(text, timestamptz);
drop table if exists public.eco_replay;

-- Types de notifications tels qu'avant (20261026000001_contacts_acces_cave.sql).
delete from public.notifications where kind = 'nous_linked';
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request'));
