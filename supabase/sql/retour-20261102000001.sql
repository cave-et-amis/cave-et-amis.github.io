-- Cave & Amis — retour arrière de 20261102000001_alignement_cocon.sql (seulement en cas de problème).
--
-- Exécuter CE fichier dans Supabase › SQL Editor : on revient aux règles d'avant.
--   - Une personne qui a activé un code relit de nouveau ses données avec le seul mot de passe (l'application demande
--     toujours le code à la connexion).
--   - L'administration redevient accessible sans code activé (avec un code activé, la session vérifiée reste exigée).
--   - Les actions de l'administrateur ne sont plus notées.
--   - Les participants et les vins sont de nouveau envoyés à Nous après 30 jours ; les liens annulés comptent de nouveau
--     depuis leur création.
--
-- Rien n'est effacé : le journal déjà écrit et la date d'annulation des liens restent en place.

do $$
declare t record;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = tablename || '_mfa_ok' loop
    execute format('drop policy if exists %I on public.%I', t.tablename || '_mfa_ok', t.tablename);
  end loop;
end $$;

create or replace function public.require_user() returns uuid
language plpgsql stable as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  return v;
end $$;

drop trigger if exists legal_documents_audit on public.legal_documents;
drop trigger if exists ai_settings_audit on public.ai_settings;
drop trigger if exists ai_user_limits_audit on public.ai_user_limits;

create or replace function public.revoke_friend_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update friend_invites set status = 'revoked'
  where id = p_id and inviter_id = require_user() and status = 'pending';
end $$;

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

create or replace function public.admin_legal_publish(p_kind text, p_title text, p_content text, p_summary text, p_requires_acceptance boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version integer;
  v_required boolean := coalesce(p_requires_acceptance, false);
  v_id uuid;
begin
  perform public.require_user();
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not public.admin_strong_session() then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('cgu', 'confidentialite', 'mentions', 'cookies') or coalesce(btrim(p_title), '') = ''
     or coalesce(btrim(p_content), '') = '' then
    raise exception 'legal_invalid' using errcode = 'P0001';
  end if;
  -- Un projet n'est jamais publié avec des emplacements à compléter ou des points à faire valider.
  if position('[À COMPLÉTER' in p_content) > 0 or position('[À VALIDER' in p_content) > 0 then
    raise exception 'legal_placeholders' using errcode = 'P0001';
  end if;
  if v_required and p_kind <> 'cgu' then
    raise exception 'legal_invalid' using errcode = 'P0001';
  end if;
  -- Deux publications simultanées ne prennent pas le même numéro.
  perform pg_advisory_xact_lock(hashtext('cave.legal.' || p_kind));
  select coalesce(max(d.version), 0) + 1 into v_version from public.legal_documents d where d.kind = p_kind;
  -- Les premières conditions d'utilisation sont toujours à accepter par tous.
  if p_kind = 'cgu' and v_version = 1 then
    v_required := true;
  end if;
  insert into public.legal_documents (kind, version, title, content, summary, requires_acceptance, published_by)
  values (p_kind, v_version, btrim(p_title), p_content, left(btrim(coalesce(p_summary, '')), 1000), v_required, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_legal_stats()
returns table (document_id uuid, kind text, version integer, title text, requires_acceptance boolean, published_at timestamptz,
               acceptances integer, acknowledgments integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_user();
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
  select d.id, d.kind, d.version, d.title, d.requires_acceptance, d.published_at,
         (select count(distinct a.user_id)::integer from public.legal_acceptances a where a.document_id = d.id and a.action = 'acceptation' and a.account_deleted_at is null),
         (select count(distinct a.user_id)::integer from public.legal_acceptances a where a.document_id = d.id and a.action = 'prise_de_connaissance' and a.account_deleted_at is null)
  from public.legal_documents d
  order by d.kind, d.version desc;
end $$;

create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_conversations integer;
  v_usage integer;
  v_errors integer;
  v_prices integer;
  v_invites integer;
  v_requests integer;
  v_access integer;
  v_visits integer;
  v_devices integer;
  v_proofs integer;
  v_consents integer;
begin
  -- Conversations avec Lia : 12 mois après le dernier message.
  delete from ai_conversations c where c.updated_at < now() - interval '12 months'
    and not exists (select 1 from ai_messages m where m.conversation_id = c.id and m.created_at >= now() - interval '12 months');
  get diagnostics v_conversations = row_count;
  -- Journaux d'usage de l'IA : 13 mois ; erreurs techniques : 3 mois.
  delete from ai_usage where created_at < now() - interval '13 months';
  get diagnostics v_usage = row_count;
  delete from ai_errors where created_at < now() - interval '3 months';
  get diagnostics v_errors = row_count;
  -- Relevés de prix : 24 mois.
  delete from price_checks where created_at < now() - interval '24 months';
  get diagnostics v_prices = row_count;
  -- Liens d'invitation expirés ou révoqués : 90 jours (code et note « Pour qui ? » partent avec la ligne).
  delete from friend_invites i
  where i.expires_at < now() - interval '90 days'
     or (i.status = 'revoked' and coalesce(i.responded_at, i.created_at) < now() - interval '90 days');
  get diagnostics v_invites = row_count;
  -- Demandes de contact ou d'accès refusées : 6 mois.
  delete from friend_requests r where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months';
  get diagnostics v_requests = row_count;
  delete from cellar_access_requests r where r.status = 'declined' and coalesce(r.responded_at, r.created_at) < now() - interval '6 months';
  get diagnostics v_access = row_count;
  -- Visites de magasin : 30 jours, une fois leurs analyses supprimées.
  delete from scan_visits v where v.created_at < now() - interval '30 days'
    and not exists (select 1 from scans s where s.visit_id = v.id);
  get diagnostics v_visits = row_count;
  delete from scan_cache where expires_at < now();
  -- Appareils de notification qui ne répondent plus depuis 90 jours.
  delete from push_subscriptions s where s.failures > 0 and coalesce(s.last_success_at, s.created_at) < now() - interval '90 days';
  get diagnostics v_devices = row_count;
  -- Preuves et consentements : 5 ans après la suppression du compte. Un compte disparu sans passer par la suppression
  -- habituelle (tableau de bord) est rattrapé ici.
  update legal_acceptances a set account_deleted_at = now()
    where a.account_deleted_at is null and not exists (select 1 from auth.users u where u.id = a.user_id);
  update user_consents c set account_deleted_at = now()
    where c.account_deleted_at is null and not exists (select 1 from auth.users u where u.id = c.user_id);
  perform set_config('cave.legal_purge', 'on', true);
  delete from legal_acceptances where account_deleted_at < now() - interval '5 years';
  get diagnostics v_proofs = row_count;
  delete from user_consents where account_deleted_at < now() - interval '5 years';
  get diagnostics v_consents = row_count;
  perform set_config('cave.legal_purge', 'off', true);
  return jsonb_build_object('conversations', v_conversations, 'ai_usage', v_usage, 'ai_errors', v_errors, 'price_checks', v_prices,
    'invites', v_invites, 'friend_requests', v_requests, 'access_requests', v_access, 'scan_visits', v_visits,
    'push_devices', v_devices, 'legal_acceptances', v_proofs, 'user_consents', v_consents);
end $$;

create or replace function public.nous_event_payload(p_event uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e events;
  v_me event_participants;
  v_minutes integer;
begin
  select * into e from events where id = p_event;
  if not found then
    return null;
  end if;
  select * into v_me from event_participants where event_id = p_event and user_id = p_user;
  if not found then
    return null;
  end if;
  -- Cave & Amis ne garde pas d'heure de fin : durée par défaut selon le type.
  v_minutes := case e.kind when 'diner' then 180 when 'degustation' then 150 else 240 end;
  return jsonb_build_object(
    'kind', e.kind,
    'title', e.title,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.starts_at + make_interval(mins => v_minutes),
    'timezone', 'Europe/Paris',
    'place', coalesce(e.place, ''),
    'description', coalesce(e.description, ''),
    'theme', coalesce(e.theme, ''),
    'organizer_name', (select display_name from profiles where id = e.organizer_id),
    'is_organizer', e.organizer_id = p_user,
    'my_rsvp', v_me.rsvp,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('name', pr.display_name, 'role', p.role, 'rsvp', p.rsvp)
                       order by p.role desc, pr.display_name)
      from event_participants p join profiles pr on pr.id = p.user_id where p.event_id = p_event), '[]'::jsonb),
    'wines', coalesce((
      select jsonb_agg(jsonb_build_object('name', w.wine_name, 'producer', w.wine_producer, 'vintage', w.wine_vintage,
                                          'color', w.wine_color, 'quantity', w.quantity, 'status', w.status,
                                          'owner_name', pr.display_name)
                       order by w.service_position nulls last, w.created_at)
      from event_wines w left join profiles pr on pr.id = w.owner_id
      where w.event_id = p_event and w.status in ('proposed', 'confirmed', 'consumed')), '[]'::jsonb)
  );
end $$;

revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.retention_purge() from public, anon, authenticated;
revoke all on function public.revoke_friend_invite(uuid) from public, anon;
grant execute on function public.revoke_friend_invite(uuid) to authenticated;
revoke all on function public.nous_event_payload(uuid, uuid) from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
