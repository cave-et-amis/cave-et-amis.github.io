-- Cave & Amis — les quatre documents à lire avant d'utiliser l'application (décision de l'éditeur du 05/11/2026).
--
-- legal_pending renvoie désormais, pour la personne connectée, chaque document dont la DERNIÈRE version n'a pas été
-- validée :
-- - conditions d'utilisation : « acceptation » (case à cocher, comme avant), puis « lecture » si une version plus
--   récente, publiée sans nouvelle acceptation, n'a pas été lue ;
-- - politique de confidentialité, mentions légales, cookies et stockage : « lecture » (bouton « J'ai lu »).
-- L'application bloque tant qu'il reste un document (écran « À lire avant de continuer »), en laissant toujours
-- télécharger ses données, supprimer son compte ou se déconnecter. Une lecture n'est PAS un consentement.
--
-- Seule compte une validation faite dans l'application après l'inscription : le lien vers la politique sur le formulaire
-- d'inscription (prise de connaissance notée par handle_new_user, contexte « inscription ») reste dans l'historique mais
-- ne suffit plus ; la case des conditions cochée à l'inscription, elle, vaut toujours acceptation.
-- Les comptes existants voient l'écran à leur prochaine ouverture, pour les documents qu'ils n'ont pas encore validés.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000015. Ne modifie aucune donnée. À déployer AVANT
-- le nouveau site (l'ancien ignore le mode « lecture »). Retour arrière : supabase/sql/retour-20261102000016.sql.

create or replace function public.legal_pending()
returns table (document_id uuid, kind text, version integer, title text, summary text, mode text)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  latest public.legal_documents;
  required integer;
begin
  for latest in select distinct on (d.kind) d.* from public.legal_documents d
                where d.kind in ('cgu', 'confidentialite', 'mentions', 'cookies')
                order by d.kind, d.version desc loop
    -- Conditions : la dernière version qui exige une acceptation doit être acceptée (inscription comprise).
    select max(d.version) into required from public.legal_documents d where d.kind = latest.kind and d.requires_acceptance;
    if latest.kind = 'cgu' and required is not null and not exists (
         select 1 from public.legal_acceptances a join public.legal_documents d on d.id = a.document_id
         where a.user_id = me and a.action = 'acceptation' and d.kind = 'cgu' and d.version >= required) then
      document_id := latest.id; kind := latest.kind; version := latest.version; title := latest.title; summary := latest.summary;
      mode := 'acceptation';
      return next;
    -- Tout document : la dernière version doit avoir été validée dans l'application (une acceptation des conditions
    -- vaut lecture ; une simple prise de connaissance à l'inscription ne compte pas).
    elsif not exists (
         select 1 from public.legal_acceptances a join public.legal_documents d on d.id = a.document_id
         where a.user_id = me and d.kind = latest.kind and d.version >= latest.version
           and (a.action = 'acceptation' or a.context <> 'inscription')) then
      document_id := latest.id; kind := latest.kind; version := latest.version; title := latest.title; summary := latest.summary;
      mode := 'lecture';
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.legal_pending() from public, anon;
grant execute on function public.legal_pending() to authenticated, service_role;

-- La lecture dans l'application est notée même si le document a déjà été présenté à l'inscription (sinon cette trace
-- empêchait la nouvelle, et l'écran revenait sans fin). Une même preuve n'est toujours notée qu'une fois.
create or replace function public.legal_accept(p_document uuid, p_action text default 'acceptation', p_context text default 'connexion')
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  doc public.legal_documents;
begin
  select * into doc from public.legal_documents d where d.id = p_document;
  if not found or coalesce(p_action, '') not in ('acceptation', 'prise_de_connaissance')
     or coalesce(p_context, '') not in ('inscription', 'connexion', 'reglages')
     or (p_action = 'acceptation' and doc.kind <> 'cgu') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.legal_acceptances a where a.user_id = me and a.document_id = doc.id and a.action = p_action
                 and (a.context <> 'inscription' or p_context = 'inscription')) then
    insert into public.legal_acceptances (user_id, document_id, version, context, action)
    values (me, doc.id, doc.version, p_context, p_action);
  end if;
end $$;

revoke all on function public.legal_accept(uuid, text, text) from public, anon;
grant execute on function public.legal_accept(uuid, text, text) to authenticated, service_role;
