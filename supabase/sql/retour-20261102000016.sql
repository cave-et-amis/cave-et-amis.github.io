-- Cave & Amis — retour arrière de 20261102000016_lecture_obligatoire.sql : legal_pending d'avant (conditions à accepter,
-- nouvelle version des conditions ou de la politique à lire en simple bandeau ; mentions et cookies non demandés).
-- Republier d'abord le site d'avant, puis exécuter ce fichier. Les lectures déjà validées restent dans l'historique.

create or replace function public.legal_pending()
returns table (document_id uuid, kind text, version integer, title text, summary text, mode text)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  latest public.legal_documents;
  required integer;
begin
  for latest in select distinct on (d.kind) d.* from public.legal_documents d where d.kind in ('cgu', 'confidentialite')
                order by d.kind, d.version desc loop
    select max(d.version) into required from public.legal_documents d where d.kind = latest.kind and d.requires_acceptance;
    if required is not null and not exists (
         select 1 from public.legal_acceptances a join public.legal_documents d on d.id = a.document_id
         where a.user_id = me and a.action = 'acceptation' and d.kind = latest.kind and d.version >= required) then
      document_id := latest.id; kind := latest.kind; version := latest.version; title := latest.title; summary := latest.summary;
      mode := 'acceptation';
      return next;
    elsif not exists (
         select 1 from public.legal_acceptances a join public.legal_documents d on d.id = a.document_id
         where a.user_id = me and d.kind = latest.kind and d.version >= latest.version) then
      document_id := latest.id; kind := latest.kind; version := latest.version; title := latest.title; summary := latest.summary;
      mode := 'information';
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.legal_pending() from public, anon;
grant execute on function public.legal_pending() to authenticated, service_role;

-- legal_accept d'avant : une seule preuve par document et par action, quel que soit le contexte.
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
  if not exists (select 1 from public.legal_acceptances a where a.user_id = me and a.document_id = doc.id and a.action = p_action) then
    insert into public.legal_acceptances (user_id, document_id, version, context, action)
    values (me, doc.id, doc.version, p_context, p_action);
  end if;
end $$;

revoke all on function public.legal_accept(uuid, text, text) from public, anon;
grant execute on function public.legal_accept(uuid, text, text) to authenticated, service_role;
