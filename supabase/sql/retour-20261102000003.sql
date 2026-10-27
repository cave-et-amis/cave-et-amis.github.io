-- Cave & Amis — retour arrière de 20261102000003_gouts.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il n'utilise pas la table des goûts).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : les préférences de goûts déclarées par chacun sont
--    effacées (le reste du profil, calculé à partir du carnet, ne dépend pas de cette table).

drop table if exists public.taste_profiles;
