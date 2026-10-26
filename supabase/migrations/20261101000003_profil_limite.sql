-- Cave & Amis — profil limité au prénom pour les autres (priorité 3 de l'audit de sécurité et RGPD du 26/10/2026,
-- constat F8).
--
-- Jusqu'ici, mes contacts et les personnes avec qui je partage un événement lisaient toute la ligne de mon profil :
-- préférences, devise, date d'inscription, rôle d'administrateur, réglages.
--  1. profile_names() donne l'identifiant et le prénom des personnes que la règle d'avant laissait lire (moi, mes
--     contacts, les participants d'un même événement) : ni plus ni moins.
--  2. La table profiles ne se lit plus que pour sa propre ligne. Chacun lit et modifie tout son profil, comme avant.
-- Les fonctions qui lisent les profils pour les autres (recherche d'amis, membres d'un groupe, notifications…) ont
-- leurs propres droits (security definer) : elles ne changent pas.
-- La mise à jour ne modifie ni ne supprime aucune donnée. Rejouable sans danger.
-- À déployer AVANT la nouvelle version du site et de cave-api, qui lisent les prénoms par profile_names().
-- Retour arrière : supabase/sql/retour-20261101000003.sql.

-- ───────────── 1. Prénoms des autres ─────────────

-- Même règle que l'ancienne lecture de profiles, réduite à l'identifiant et au prénom.
create or replace function public.profile_names()
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name
  from profiles p
  where p.id = auth.uid() or public.is_connected(p.id) or public.shares_event(p.id)
  order by p.display_name, p.id
$$;

-- ───────────── 2. Le profil complet : à soi seul ─────────────

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid());

-- ───────────── 3. Droits ─────────────

revoke all on function public.profile_names() from public, anon;
grant execute on function public.profile_names() to authenticated;
grant execute on all functions in schema public to service_role;
