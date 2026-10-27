-- Cave & Amis — mêmes règles RGPD que Cocon (demande de l'éditeur du 27/10/2026, note cocon-cave-alignement-rgpd).
--
-- 1. Double authentification pour tous : une personne qui a activé un code ne lit ni n'écrit rien tant que sa session
--    n'est pas vérifiée par ce code (niveau aal2), ni par les tables (politiques « _mfa_ok »), ni par les fonctions du
--    serveur (require_user). Sans code activé, rien ne change. Comme mfa_ok() et les politiques de Cocon.
-- 2. Administration : la double authentification est obligatoire. Sans code activé, les fonctions d'administration et
--    la publication des documents légaux sont refusées (« admin_mfa_required ») ; avec un code, la session doit être
--    vérifiée (« mfa_required »).
-- 3. Journal des actions de l'administrateur (publication d'un document légal, réglages de l'assistant, limites d'un
--    compte) : impossible à modifier ou à effacer, sauf par la purge des 12 mois. Comme admin_audit_log de Cocon.
-- 4. Agenda Nous : 30 jours après la fin d'un événement, les participants et les vins ne sont plus envoyés (Nous les
--    efface déjà de sa copie à ce moment-là).
-- 5. Liens d'invitation annulés : la date d'annulation est notée, et les 90 jours comptent à partir d'elle (ils
--    comptaient depuis la création du lien).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261101000005_double_authentification.sql. Rejouable sans
-- danger. La mise à jour ne supprime aucune donnée. Retour arrière : supabase/sql/retour-20261102000001.sql.
--
-- AVANT de l'appliquer : activer la double authentification du compte administrateur (Réglages). Sinon, l'administration
-- reste fermée jusqu'à son activation (le reste de l'application n'est pas touché).

-- ───────────── 1. Double authentification pour tous ─────────────

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

-- Les fonctions du serveur (security definer) passent outre les politiques : elles appellent toutes require_user().
create or replace function public.require_user() returns uuid
language plpgsql stable as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.mfa_ok() then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- Les politiques « _mfa_ok » sont posées à la fin, sur toutes les tables (y compris le journal ci-dessous).

-- ───────────── 2. Administration : double authentification obligatoire ─────────────

create or replace function public.admin_has_factor() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  -- Pas de code activé : l'administrateur l'active d'abord dans Réglages.
  if not public.admin_has_factor() then
    raise exception 'admin_mfa_required' using errcode = 'P0001';
  end if;
  if not public.admin_strong_session() then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
end $$;

-- ───────────── 3. Journal des actions de l'administrateur ─────────────

-- Sans clé étrangère : il survit à la suppression des comptes. Jamais de texte d'un document, de clé ni de secret.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('publication_document', 'reglages_assistant', 'limites_compte')),
  target_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_at on public.admin_audit_log (at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant all on public.admin_audit_log to service_role;

-- Inaltérable : seule la purge des 12 mois peut effacer une ligne.
create or replace function public.admin_audit_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('cave.audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists admin_audit_no_change on public.admin_audit_log;
create trigger admin_audit_no_change before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_immutable();

-- Les écritures sont notées par des déclencheurs : toute modification faite par l'administrateur l'est, quel que soit le
-- chemin. Celles du serveur (état de la clé, sans compte connecté) ne le sont pas.
create or replace function public.admin_audit_legal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit_log (actor_id, action, details)
  values (auth.uid(), 'publication_document', jsonb_build_object('document', new.kind, 'version', new.version, 'titre', new.title,
    'acceptation_demandee', new.requires_acceptance, 'empreinte', new.content_sha256));
  return new;
end $$;
drop trigger if exists legal_documents_audit on public.legal_documents;
create trigger legal_documents_audit after insert on public.legal_documents
  for each row execute function public.admin_audit_legal();

create or replace function public.admin_audit_ai_settings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := to_jsonb(old) - array['updated_at', 'updated_by', 'key_status', 'key_checked_at'];
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'key_status', 'key_checked_at'];
  v_changes jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return new;
  end if;
  select coalesce(jsonb_object_agg(k, jsonb_build_object('avant', v_old -> k, 'apres', v_new -> k)), '{}'::jsonb) into v_changes
  from jsonb_object_keys(v_new) k where (v_old -> k) is distinct from (v_new -> k);
  if v_changes <> '{}'::jsonb then
    insert into admin_audit_log (actor_id, action, details) values (auth.uid(), 'reglages_assistant', v_changes);
  end if;
  return new;
end $$;
drop trigger if exists ai_settings_audit on public.ai_settings;
create trigger ai_settings_audit after update on public.ai_settings
  for each row execute function public.admin_audit_ai_settings();

create or replace function public.admin_audit_user_limits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then
    return coalesce(new, old);
  end if;
  insert into admin_audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'limites_compte', coalesce(new.user_id, old.user_id),
    case when tg_op = 'DELETE' then jsonb_build_object('reinitialisees', true)
         else jsonb_build_object('par_jour', new.daily_requests, 'par_mois_usd', new.monthly_usd, 'bloque', new.blocked) end);
  return coalesce(new, old);
end $$;
drop trigger if exists ai_user_limits_audit on public.ai_user_limits;
create trigger ai_user_limits_audit after insert or update or delete on public.ai_user_limits
  for each row execute function public.admin_audit_user_limits();

-- Lecture du journal par l'administrateur (avec le code).
create or replace function public.admin_audit_journal(p_limit integer default 100)
returns table (at timestamptz, action text, target_name text, details jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_user();
  perform public.require_admin();
  return query
  select l.at, l.action, coalesce((select p.display_name from profiles p where p.id = l.target_id), ''), l.details
  from admin_audit_log l
  order by l.at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- ───────────── Documents légaux : double authentification obligatoire pour publier et pour les statistiques ─────────────

create or replace function public.admin_legal_publish(p_kind text, p_title text, p_content text, p_summary text, p_requires_acceptance boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version integer;
  v_required boolean := coalesce(p_requires_acceptance, false);
  v_id uuid;
begin
  perform public.require_user();
  perform public.require_admin();
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
  perform public.require_admin();
  return query
  select d.id, d.kind, d.version, d.title, d.requires_acceptance, d.published_at,
         (select count(distinct a.user_id)::integer from public.legal_acceptances a where a.document_id = d.id and a.action = 'acceptation' and a.account_deleted_at is null),
         (select count(distinct a.user_id)::integer from public.legal_acceptances a where a.document_id = d.id and a.action = 'prise_de_connaissance' and a.account_deleted_at is null)
  from public.legal_documents d
  order by d.kind, d.version desc;
end $$;

-- ───────────── 4. Agenda Nous : plus de participants ni de vins 30 jours après l'événement ─────────────

create or replace function public.nous_event_payload(p_event uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e events;
  v_me event_participants;
  v_minutes integer;
  v_ends timestamptz;
  v_details boolean;
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
  v_ends := e.starts_at + make_interval(mins => v_minutes);
  -- Participants et vins : seulement jusqu'à 30 jours après la fin (Nous les efface de sa copie à ce moment-là).
  v_details := v_ends >= now() - interval '30 days';
  return jsonb_build_object(
    'kind', e.kind,
    'title', e.title,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', v_ends,
    'timezone', 'Europe/Paris',
    'place', coalesce(e.place, ''),
    'description', coalesce(e.description, ''),
    'theme', coalesce(e.theme, ''),
    'organizer_name', (select display_name from profiles where id = e.organizer_id),
    'is_organizer', e.organizer_id = p_user,
    'my_rsvp', v_me.rsvp,
    'participants', case when not v_details then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('name', pr.display_name, 'role', p.role, 'rsvp', p.rsvp)
                       order by p.role desc, pr.display_name)
      from event_participants p join profiles pr on pr.id = p.user_id where p.event_id = p_event), '[]'::jsonb) end,
    'wines', case when not v_details then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('name', w.wine_name, 'producer', w.wine_producer, 'vintage', w.wine_vintage,
                                          'color', w.wine_color, 'quantity', w.quantity, 'status', w.status,
                                          'owner_name', pr.display_name)
                       order by w.service_position nulls last, w.created_at)
      from event_wines w left join profiles pr on pr.id = w.owner_id
      where w.event_id = p_event and w.status in ('proposed', 'confirmed', 'consumed')), '[]'::jsonb) end
  );
end $$;

-- ───────────── 5. Liens d'invitation annulés : 90 jours depuis l'annulation ─────────────

alter table public.friend_invites add column if not exists revoked_at timestamptz;

create or replace function public.revoke_friend_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update friend_invites set status = 'revoked', revoked_at = now()
  where id = p_id and inviter_id = require_user() and status = 'pending';
end $$;

-- ───────────── Purge de chaque nuit : liens annulés, journal de l'administrateur ─────────────

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
  v_audit integer;
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
  -- Liens d'invitation : 90 jours après leur expiration ou leur annulation (code et note « Pour qui ? » partent avec la
  -- ligne). Un lien annulé avant cette mise à jour n'a pas de date d'annulation : sa date d'expiration compte.
  delete from friend_invites i where least(i.expires_at, i.revoked_at) < now() - interval '90 days';
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
  -- Journal des actions de l'administrateur : 12 mois.
  perform set_config('cave.audit_purge', 'on', true);
  delete from admin_audit_log where at < now() - interval '12 months';
  get diagnostics v_audit = row_count;
  perform set_config('cave.audit_purge', 'off', true);
  return jsonb_build_object('conversations', v_conversations, 'ai_usage', v_usage, 'ai_errors', v_errors, 'price_checks', v_prices,
    'invites', v_invites, 'friend_requests', v_requests, 'access_requests', v_access, 'scan_visits', v_visits,
    'push_devices', v_devices, 'legal_acceptances', v_proofs, 'user_consents', v_consents, 'admin_audit', v_audit);
end $$;

-- ───────────── Politiques « _mfa_ok » : chaque table protégée par les règles d'accès ─────────────

do $$
declare t record;
begin
  for t in
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', t.name || '_mfa_ok', t.name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))',
      t.name || '_mfa_ok', t.name);
  end loop;
end $$;

-- ───────────── Droits ─────────────

revoke all on function public.admin_has_factor() from public, anon, authenticated;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.admin_audit_immutable() from public, anon, authenticated;
revoke all on function public.admin_audit_legal() from public, anon, authenticated;
revoke all on function public.admin_audit_ai_settings() from public, anon, authenticated;
revoke all on function public.admin_audit_user_limits() from public, anon, authenticated;
revoke all on function public.retention_purge() from public, anon, authenticated;
revoke all on function public.admin_audit_journal(integer) from public, anon;
grant execute on function public.admin_audit_journal(integer) to authenticated;
revoke all on function public.admin_legal_publish(text, text, text, text, boolean) from public, anon;
revoke all on function public.admin_legal_stats() from public, anon;
grant execute on function public.admin_legal_publish(text, text, text, text, boolean), public.admin_legal_stats() to authenticated;
revoke all on function public.revoke_friend_invite(uuid) from public, anon;
grant execute on function public.revoke_friend_invite(uuid) to authenticated;
revoke all on function public.nous_event_payload(uuid, uuid) from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
