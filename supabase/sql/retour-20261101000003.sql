-- Cave & Amis — retour arrière de 20261101000003_profil_limite.sql (seulement en cas de problème).
--
-- 1) Exécuter CE fichier dans Supabase › SQL Editor : l'état d'avant revient (mes contacts et les participants de mes
--    événements lisent de nouveau toute la ligne de mon profil).
-- 2) Redéployer cave-api et le site depuis la version précédente : la version actuelle lit les prénoms par
--    profile_names(), qui n'existe plus après ce retour arrière.
--
-- Rien n'est effacé. Attention : l'ancien comportement réintroduit le défaut corrigé (préférences, devise, date
-- d'inscription et rôle d'administrateur lisibles par les contacts et les participants d'un même événement).

-- Règle de lecture telle qu'avant (20261026000001_contacts_acces_cave.sql).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_connected(id) or public.shares_event(id));

drop function if exists public.profile_names();
