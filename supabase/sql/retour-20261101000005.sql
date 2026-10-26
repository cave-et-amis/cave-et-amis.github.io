-- Cave & Amis — retour arrière de 20261101000005_double_authentification.sql (seulement en cas de problème).
--
-- Exécuter CE fichier dans Supabase › SQL Editor : les fonctions d'administration de l'assistant redeviennent
-- accessibles avec le seul mot de passe de l'administrateur, comme avant. La publication des documents légaux garde
-- l'exigence du code (posée par 20261101000001), et l'application continue de demander le code à la connexion.
--
-- Rien n'est effacé : un code déjà activé reste en place. Pour le retirer (téléphone perdu, par exemple), voir
-- docs/SECURITE.md, « Double authentification de l'administrateur ».

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.require_admin() from public, anon, authenticated;
