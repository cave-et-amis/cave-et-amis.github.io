-- Cave & Amis — double authentification de l'administrateur (audit de sécurité et RGPD du 26/10/2026).
--
-- L'administrateur peut activer un code à 6 chiffres (application d'authentification, facteur TOTP de Supabase), que
-- l'application demande à chaque connexion. La base l'exige déjà pour publier un document légal (20261101000001) ; ici,
-- les fonctions d'administration de l'assistant (vue d'ensemble avec les adresses e-mail, réglages et budget, limites des
-- personnes) l'exigent aussi. Avec le seul mot de passe, même en appelant directement le serveur, elles sont refusées
-- (« mfa_required »). Sans code activé, rien ne change.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261101000001_documents_legaux.sql. Rejouable sans danger.
-- La mise à jour ne modifie ni ne supprime aucune donnée. Retour arrière : supabase/sql/retour-20261101000005.sql.

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- Code de double authentification activé : session vérifiée par ce code (niveau aal2) exigée.
  if not public.admin_strong_session() then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
end $$;

-- Appelée seulement par les fonctions d'administration, jamais directement par les comptes.
revoke all on function public.require_admin() from public, anon, authenticated;
