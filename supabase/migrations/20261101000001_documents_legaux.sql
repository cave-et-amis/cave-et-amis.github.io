-- Cave & Amis — documents légaux, preuves et consentements, export complet, durées de conservation (priorité 2 de
-- l'audit de sécurité et RGPD du 26/10/2026).
--
--  1. Documents versionnés (conditions d'utilisation, politique de confidentialité, mentions légales, cookies), publiés
--     depuis l'administration et jamais modifiés ensuite ; preuves d'acceptation et consentements en ajout seul. Modèle
--     commun avec Cocon : mêmes noms de tables, de colonnes et de fonctions.
--  2. Preuves gardées 5 ans après la suppression du compte (choix du 26/10/2026), puis effacées : identifiant, version et
--     date seulement, sans clé étrangère vers le compte.
--  3. Consentements de Cave : « recherche_amis » (apparaître dans la recherche) et « liaison_nous » (agenda Nous), notés
--     à chaque changement.
--  4. Export complet de ses données (JSON), y compris ce que l'application n'affiche pas.
--  5. Purges des durées de conservation validées le 26/10/2026. Elles ne s'exécutent pas ici : la tâche planifiée est
--     posée à part (supabase/sql/conservation.sql), après accord.
-- Aucun document n'est publié ici : l'administrateur le fait depuis l'application, après avoir complété les projets
-- (docs/legal/). Tant que rien n'est publié, rien ne change pour les personnes.
-- La mise à jour elle-même ne modifie ni ne supprime aucune donnée existante. Rejouable sans danger.
-- Retour arrière : supabase/sql/retour-20261101000001.sql.

-- ───────────── 1. Tables ─────────────

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cgu', 'confidentialite', 'mentions', 'cookies')),
  version integer not null check (version >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(content) between 1 and 200000),
  -- Empreinte du texte exact présenté (calculée par la base) : preuve de ce qui a été accepté.
  content_sha256 text not null default '',
  summary text not null default '' check (char_length(summary) <= 1000),
  -- true : nouvelle acceptation demandée (conditions d'utilisation, changement important) ; false : simple information.
  requires_acceptance boolean not null default false,
  published_at timestamptz not null default now(),
  published_by uuid,
  unique (kind, version),
  check (not requires_acceptance or kind = 'cgu')
);

-- Ajout seul. Pas de clé étrangère vers le compte : la preuve survit à sa suppression (account_deleted_at), puis est
-- effacée 5 ans après.
create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  document_id uuid not null references public.legal_documents (id),
  version integer not null,
  accepted_at timestamptz not null default now(),
  context text not null check (context in ('inscription', 'connexion', 'reglages')),
  -- « prise_de_connaissance » : information (politique de confidentialité), jamais un consentement.
  action text not null default 'acceptation' check (action in ('acceptation', 'prise_de_connaissance')),
  account_deleted_at timestamptz
);
create index if not exists legal_acceptances_user on public.legal_acceptances (user_id, document_id);
create index if not exists legal_acceptances_deleted on public.legal_acceptances (account_deleted_at) where account_deleted_at is not null;

-- Ajout seul ; état courant = dernière ligne par personne et finalité ; retrait = nouvelle ligne granted = false.
create table if not exists public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  purpose text not null check (purpose ~ '^[a-z_]{3,40}$'),
  granted boolean not null,
  -- Version de la politique de confidentialité en vigueur à ce moment (aucune si rien n'est publié).
  document_version integer,
  at timestamptz not null default now(),
  context text not null default 'fonction' check (context in ('inscription', 'connexion', 'reglages', 'fonction')),
  account_deleted_at timestamptz
);
create index if not exists user_consents_user on public.user_consents (user_id, purpose, at desc, id desc);
create index if not exists user_consents_deleted on public.user_consents (account_deleted_at) where account_deleted_at is not null;

create or replace function public.legal_fill_hash() returns trigger
language plpgsql as $$
begin
  new.content_sha256 := encode(sha256(convert_to(new.content, 'UTF8')), 'hex');
  new.published_at := now();
  return new;
end $$;

create or replace function public.legal_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'legal_immutable' using errcode = 'P0001';
end $$;

-- Preuves et consentements : seule la date de suppression du compte peut être posée, une fois ; l'effacement n'est
-- possible que par la purge de conservation.
create or replace function public.legal_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.account_deleted_at is null and new.account_deleted_at is not null
       and (to_jsonb(new) - 'account_deleted_at') = (to_jsonb(old) - 'account_deleted_at') then
      return new;
    end if;
  elsif current_setting('cave.legal_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'legal_immutable' using errcode = 'P0001';
end $$;

drop trigger if exists legal_documents_hash on public.legal_documents;
create trigger legal_documents_hash before insert on public.legal_documents
  for each row execute function public.legal_fill_hash();
drop trigger if exists legal_documents_frozen on public.legal_documents;
create trigger legal_documents_frozen before update or delete on public.legal_documents
  for each row execute function public.legal_immutable();
drop trigger if exists legal_acceptances_frozen on public.legal_acceptances;
create trigger legal_acceptances_frozen before update or delete on public.legal_acceptances
  for each row execute function public.legal_append_only();
drop trigger if exists user_consents_frozen on public.user_consents;
create trigger user_consents_frozen before update or delete on public.user_consents
  for each row execute function public.legal_append_only();

-- Aucun accès direct : lecture et écriture passent par les fonctions ci-dessous.
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.user_consents enable row level security;
revoke all on public.legal_documents, public.legal_acceptances, public.user_consents from anon, authenticated;

-- Compte supprimé : le délai de 5 ans de ses preuves commence.
create or replace function public.profiles_after_delete_legal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.legal_acceptances set account_deleted_at = now() where user_id = old.id and account_deleted_at is null;
  update public.user_consents set account_deleted_at = now() where user_id = old.id and account_deleted_at is null;
  return old;
end $$;
drop trigger if exists profiles_after_delete_legal on public.profiles;
create trigger profiles_after_delete_legal after delete on public.profiles
  for each row execute function public.profiles_after_delete_legal();

-- ───────────── 2. Consentements ─────────────

create or replace function public.legal_current_version(p_kind text) returns integer
language sql stable security definer set search_path = public as $$
  select max(d.version) from public.legal_documents d where d.kind = p_kind
$$;

create or replace function public.has_consent(p_user uuid, p_purpose text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select c.granted from public.user_consents c
                   where c.user_id = p_user and c.purpose = p_purpose
                   order by c.at desc, c.id desc limit 1), false)
$$;

-- Contexte du changement en cours (posé par consent_set ou nous_link_*), sinon « reglages » ou « fonction ».
create or replace function public.consent_note(p_user uuid, p_purpose text, p_granted boolean, p_default_context text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_context text := coalesce(nullif(current_setting('cave.consent_context', true), ''), p_default_context);
begin
  insert into public.user_consents (user_id, purpose, granted, document_version, context)
  values (p_user, p_purpose, p_granted, public.legal_current_version('confidentialite'), v_context);
end $$;

-- « Apparaître dans la recherche d'amis » : chaque changement est noté.
create or replace function public.profiles_consent_discoverable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.discoverable is distinct from old.discoverable then
    perform public.consent_note(new.id, 'recherche_amis', new.discoverable, 'reglages');
  end if;
  return new;
end $$;
drop trigger if exists profiles_consent_discoverable on public.profiles;
create trigger profiles_consent_discoverable after update of discoverable on public.profiles
  for each row execute function public.profiles_consent_discoverable();

-- Agenda Nous : la liaison vaut consentement donné, la déliaison consentement retiré (pas pendant la suppression du compte :
-- le profil n'existe déjà plus, et les preuves suivent alors la règle des 5 ans).
create or replace function public.nous_links_consent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.consent_note(new.user_id, 'liaison_nous', true, 'fonction');
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.id = old.user_id) then
    perform public.consent_note(old.user_id, 'liaison_nous', false, 'fonction');
  end if;
  return old;
end $$;
drop trigger if exists nous_links_consent on public.nous_links;
create trigger nous_links_consent after insert or delete on public.nous_links
  for each row execute function public.nous_links_consent();

-- Donner ou retirer un consentement depuis l'application. « liaison_nous » se gère par la liaison elle-même.
create or replace function public.consent_set(p_purpose text, p_granted boolean, p_context text default 'reglages') returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  if p_purpose is distinct from 'recherche_amis' or p_granted is null
     or coalesce(p_context, '') not in ('inscription', 'connexion', 'reglages', 'fonction') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  perform set_config('cave.consent_context', p_context, true);
  update public.profiles set discoverable = p_granted where id = me;
  perform set_config('cave.consent_context', '', true);
  return p_granted;
end $$;

-- ───────────── 3. Documents : lecture, acceptation, historique ─────────────

-- Dernière version de chaque document (lisible sans compte, avant l'inscription).
create or replace function public.legal_current()
returns table (id uuid, kind text, version integer, title text, content text, content_sha256 text, summary text,
               requires_acceptance boolean, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (d.kind) d.id, d.kind, d.version, d.title, d.content, d.content_sha256, d.summary, d.requires_acceptance, d.published_at
  from public.legal_documents d
  order by d.kind, d.version desc
$$;

-- Ce que la personne doit accepter (conditions d'utilisation : dernière version qui exige une acceptation, pas encore
-- acceptée) ou lire (nouvelle version de la politique, ou des conditions sans nouvelle acceptation).
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

-- Mes acceptations et mes consentements (historique complet et état actuel).
create or replace function public.my_legal_history() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return jsonb_build_object(
    'acceptances', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'version', a.version, 'title', d.title, 'action', a.action,
                                          'context', a.context, 'at', a.accepted_at) order by a.accepted_at desc, a.id desc)
      from public.legal_acceptances a join public.legal_documents d on d.id = a.document_id where a.user_id = me), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'granted', c.granted, 'at', c.at, 'context', c.context,
                                          'document_version', c.document_version) order by c.at desc, c.id desc)
      from public.user_consents c where c.user_id = me), '[]'::jsonb),
    'current', coalesce((
      select jsonb_object_agg(x.purpose, x.granted)
      from (select distinct on (c.purpose) c.purpose, c.granted from public.user_consents c where c.user_id = me
            order by c.purpose, c.at desc, c.id desc) x), '{}'::jsonb)
  );
end $$;

-- Nouveau compte : profil (le tout premier compte devient administrateur), première cave, et, si l'application les a
-- présentées (métadonnées de signUp), la version des conditions acceptée (case non précochée) et celle de la politique.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_first boolean;
  doc public.legal_documents;
begin
  perform pg_advisory_xact_lock(4242);
  v_name := left(btrim(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1), '')), 40);
  if v_name = '' then
    v_name := 'Amateur';
  end if;
  select not exists (select 1 from profiles) into v_first;
  insert into profiles (id, display_name, is_admin) values (new.id, v_name, v_first);
  insert into cellars (owner_id, name) values (new.id, 'Ma cave');
  if (new.raw_user_meta_data ->> 'cgu_version') ~ '^[0-9]{1,6}$' then
    select * into doc from legal_documents d where d.kind = 'cgu' and d.version = (new.raw_user_meta_data ->> 'cgu_version')::integer;
    if found then
      insert into legal_acceptances (user_id, document_id, version, context, action) values (new.id, doc.id, doc.version, 'inscription', 'acceptation');
    end if;
  end if;
  if (new.raw_user_meta_data ->> 'confidentialite_version') ~ '^[0-9]{1,6}$' then
    select * into doc from legal_documents d where d.kind = 'confidentialite' and d.version = (new.raw_user_meta_data ->> 'confidentialite_version')::integer;
    if found then
      insert into legal_acceptances (user_id, document_id, version, context, action) values (new.id, doc.id, doc.version, 'inscription', 'prise_de_connaissance');
    end if;
  end if;
  return new;
end $$;

-- ───────────── 4. Administration : publier une version, compter les acceptations (sans nom) ─────────────

-- Double authentification : dès que l'administrateur a activé un code, la publication demande une session vérifiée par
-- ce code (niveau aal2).
create or replace function public.admin_strong_session() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

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

-- ───────────── 5. Export complet de ses données (droit d'accès et portabilité) ─────────────

-- « mes_donnees » : ce que la personne a créé ou qui la concerne directement ; pour les autres personnes, seulement ce
-- que l'application lui montre déjà (prénom, rôle). Jamais de secret : ni empreinte ou code d'invitation, ni clé de
-- notification. « photos » : la liste des fichiers de son dossier ; l'application les ajoute à l'archive.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, auth, storage as $$
declare
  me uuid := public.require_user();
begin
  return jsonb_build_object(
    'format', 'cave-export-v1',
    'exported_at', now(),
    'compte', (
      select jsonb_build_object(
        'email', u.email, 'cree_le', u.created_at, 'derniere_connexion', u.last_sign_in_at,
        'profil', (select to_jsonb(p) - 'id' from public.profiles p where p.id = me),
        'double_authentification', exists (select 1 from auth.mfa_factors f where f.user_id = me and f.status = 'verified'),
        'limites_de_l_assistant', (select to_jsonb(l) - 'user_id' from public.ai_user_limits l where l.user_id = me))
      from auth.users u where u.id = me),
    'caves', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
                         'emplacements', coalesce((select jsonb_agg(to_jsonb(l)) from public.locations l where l.cellar_id = c.id), '[]'::jsonb))
                       order by c.position, c.created_at) from public.cellars c where c.owner_id = me), '[]'::jsonb),
    'caves_gerees_a_plusieurs', coalesce((select jsonb_agg(jsonb_build_object(
                         'cave', c.name, 'proprietaire', (select p.display_name from public.profiles p where p.id = c.owner_id),
                         'personne', (select p.display_name from public.profiles p where p.id = m.user_id),
                         'statut', m.status, 'invitee_le', m.invited_at, 'entree_le', m.joined_at))
                       from public.cellar_members m join public.cellars c on c.id = m.cellar_id
                       where m.user_id = me or c.owner_id = me), '[]'::jsonb),
    'vins', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.wines w where w.owner_id = me), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.lots l where l.owner_id = me), '[]'::jsonb),
    'mouvements', coalesce((select jsonb_agg(to_jsonb(m) order by m.occurred_on, m.created_at) from public.movements m where m.owner_id = me), '[]'::jsonb),
    'mouvements_faits_dans_d_autres_caves', coalesce((select jsonb_agg(jsonb_build_object('type', m.kind, 'quantite', m.delta, 'le', m.occurred_on,
                         'note', m.note, 'cree_le', m.created_at) order by m.created_at)
                       from public.movements m where m.done_by = me and m.owner_id <> me), '[]'::jsonb),
    'prix_de_marche', coalesce((select jsonb_agg(to_jsonb(x)) from public.market_prices x where x.owner_id = me), '[]'::jsonb),
    'recherches_de_prix', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.price_checks x where x.user_id = me), '[]'::jsonb),
    'degustations', coalesce((select jsonb_agg(to_jsonb(t) order by t.tasted_on, t.created_at) from public.tastings t where t.user_id = me), '[]'::jsonb),
    'envies', coalesce((select jsonb_agg(to_jsonb(w)) from public.wishlist w where w.user_id = me), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('prenom', p.display_name, 'depuis', f.created_at))
                       from public.friendships f join public.profiles p on p.id = case when f.user_a = me then f.user_b else f.user_a end
                       where me in (f.user_a, f.user_b)), '[]'::jsonb),
    'demandes_de_contact', coalesce((select jsonb_agg(jsonb_build_object(
                         'sens', case when r.from_id = me then 'envoyee' else 'recue' end,
                         'personne', (select p.display_name from public.profiles p where p.id = case when r.from_id = me then r.to_id else r.from_id end),
                         'statut', r.status, 'ouvrir_ma_cave', r.open_cellar, 'le', r.created_at, 'reponse_le', r.responded_at) order by r.created_at)
                       from public.friend_requests r where me in (r.from_id, r.to_id)), '[]'::jsonb),
    'personnes_bloquees', coalesce((select jsonb_agg(jsonb_build_object('prenom', p.display_name, 'le', b.created_at))
                       from public.blocks b join public.profiles p on p.id = b.blocked_id where b.blocker_id = me), '[]'::jsonb),
    'acces_a_ma_cave', coalesce((select jsonb_agg((to_jsonb(a) - 'owner_id' - 'viewer_id') || jsonb_build_object(
                         'personne', (select p.display_name from public.profiles p where p.id = a.viewer_id)))
                       from public.cellar_access a where a.owner_id = me), '[]'::jsonb),
    'caves_qui_me_sont_ouvertes', coalesce((select jsonb_agg((to_jsonb(a) - 'owner_id' - 'viewer_id') || jsonb_build_object(
                         'personne', (select p.display_name from public.profiles p where p.id = a.owner_id)))
                       from public.cellar_access a where a.viewer_id = me), '[]'::jsonb),
    'exceptions_d_acces', coalesce((select jsonb_agg((to_jsonb(x) - 'owner_id' - 'viewer_id') || jsonb_build_object(
                         'personne', (select p.display_name from public.profiles p where p.id = x.viewer_id)))
                       from public.cellar_access_exceptions x where x.owner_id = me), '[]'::jsonb),
    'demandes_d_acces', coalesce((select jsonb_agg(jsonb_build_object(
                         'sens', case when r.from_id = me then 'envoyee' else 'recue' end,
                         'personne', (select p.display_name from public.profiles p where p.id = case when r.from_id = me then r.to_id else r.from_id end),
                         'statut', r.status, 'le', r.created_at, 'reponse_le', r.responded_at) order by r.created_at)
                       from public.cellar_access_requests r where me in (r.from_id, r.to_id)), '[]'::jsonb),
    'liens_d_invitation', coalesce((select jsonb_agg((to_jsonb(i) - 'code' - 'code_hash' - 'inviter_id' - 'responded_by') || jsonb_build_object(
                         'utilise_par', coalesce((select jsonb_agg(jsonb_build_object('prenom', p.display_name, 'le', r.redeemed_at))
                                                  from public.invite_redemptions r join public.profiles p on p.id = r.user_id
                                                  where r.invite_id = i.id), '[]'::jsonb)) order by i.created_at)
                       from public.friend_invites i where i.inviter_id = me), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) - 'user_id' - 'actor_id' order by n.created_at)
                       from public.notifications n where n.user_id = me), '[]'::jsonb),
    'groupes', coalesce((select jsonb_agg(jsonb_build_object(
                         'groupe', g.name, 'emoji', g.emoji, 'description', g.description, 'photo', g.photo,
                         'cree_par_moi', g.created_by = me, 'role', m.role, 'statut', m.status))
                       from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = me), '[]'::jsonb),
    'bouteilles_partagees_dans_les_groupes', coalesce((select jsonb_agg(jsonb_build_object(
                         'groupe', (select g.name from public.groups g where g.id = s.group_id), 'lot', s.lot_id, 'quantite', s.allocated))
                       from public.group_shares s where s.owner_id = me), '[]'::jsonb),
    'envies_de_groupe', coalesce((select jsonb_agg((to_jsonb(w) - 'created_by') || jsonb_build_object(
                         'groupe', (select g.name from public.groups g where g.id = w.group_id)))
                       from public.group_wishes w where w.created_by = me), '[]'::jsonb),
    'votes_sur_les_envies', coalesce((select jsonb_agg(v.wish_id) from public.group_wish_votes v where v.user_id = me), '[]'::jsonb),
    'mon_activite_dans_les_groupes', coalesce((select jsonb_agg(jsonb_build_object(
                         'groupe', (select g.name from public.groups g where g.id = a.group_id), 'action', a.kind,
                         'cible', a.target_name, 'detail', a.detail, 'le', a.created_at) order by a.created_at)
                       from public.group_activity a where a.actor_id = me), '[]'::jsonb),
    'evenements_organises', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
                         'participants', coalesce((select jsonb_agg(jsonb_build_object('prenom', p.display_name, 'role', x.role, 'reponse', x.rsvp))
                                                   from public.event_participants x join public.profiles p on p.id = x.user_id
                                                   where x.event_id = e.id), '[]'::jsonb),
                         'plats', coalesce((select jsonb_agg(jsonb_build_object('plat', d.name, 'service', d.course)) from public.event_dishes d
                                            where d.event_id = e.id), '[]'::jsonb)) order by e.starts_at)
                       from public.events e where e.organizer_id = me), '[]'::jsonb),
    'evenements_ou_je_suis_invite', coalesce((select jsonb_agg(jsonb_build_object(
                         'titre', e.title, 'debut', e.starts_at, 'lieu', e.place, 'statut', e.status,
                         'organisateur', (select p.display_name from public.profiles p where p.id = e.organizer_id),
                         'ma_reponse', x.rsvp, 'invite_le', x.invited_at, 'reponse_le', x.responded_at) order by e.starts_at)
                       from public.event_participants x join public.events e on e.id = x.event_id
                       where x.user_id = me and e.organizer_id <> me), '[]'::jsonb),
    'plats_ajoutes', coalesce((select jsonb_agg(jsonb_build_object('evenement', d.event_id, 'plat', d.name, 'service', d.course, 'le', d.created_at))
                       from public.event_dishes d where d.created_by = me), '[]'::jsonb),
    'vins_proposes_aux_evenements', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at)
                       from public.event_wines w where w.owner_id = me or w.proposed_by = me), '[]'::jsonb),
    'assistant', jsonb_build_object(
      'conversations', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
                         'messages', coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'texte', m.content, 'details', m.meta, 'le', m.created_at)
                                                                order by m.created_at) from public.ai_messages m where m.conversation_id = c.id), '[]'::jsonb))
                       order by c.created_at) from public.ai_conversations c where c.user_id = me), '[]'::jsonb),
      'utilisation', coalesce((select jsonb_agg(to_jsonb(u) - 'user_id' order by u.created_at) from public.ai_usage u where u.user_id = me), '[]'::jsonb),
      'erreurs', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' order by x.created_at) from public.ai_errors x where x.user_id = me), '[]'::jsonb)),
    'scanner', jsonb_build_object(
      'analyses', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.created_at) from public.scans s where s.user_id = me), '[]'::jsonb),
      'visites', coalesce((select jsonb_agg(to_jsonb(v) - 'user_id' order by v.created_at) from public.scan_visits v where v.user_id = me), '[]'::jsonb)),
    'appareils_avec_notifications', coalesce((select jsonb_agg(jsonb_build_object('appareil', s.label,
                         'service', split_part(split_part(s.endpoint, '://', 2), '/', 1), 'active_le', s.created_at,
                         'dernier_envoi_reussi', s.last_success_at, 'echecs', s.failures))
                       from public.push_subscriptions s where s.user_id = me), '[]'::jsonb),
    'agenda_nous', (select jsonb_build_object('prenom_dans_nous', l.nous_display_name, 'envois_actifs', l.sync_enabled, 'reliee_le', l.linked_at)
                    from public.nous_links l where l.user_id = me),
    'documents_et_consentements', public.my_legal_history(),
    'photos', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                        where o.bucket_id = 'photos' and o.name like me::text || '/%'), '[]'::jsonb)
  );
end $$;

-- ───────────── 6. Durées de conservation (validées le 26/10/2026) ─────────────

-- Purge des données qui ne sont que dans la base. Appelée chaque jour par cave-api (tâche planifiée), qui supprime aussi
-- les analyses du scanner arrivées à échéance avec leurs photos, et chaque mois les photos qui ne servent plus.
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

-- Photos qui ne servent plus : fichiers de plus de 30 jours (jamais une photo en cours d'enregistrement) qu'aucune fiche,
-- dégustation, groupe, vin d'événement ou analyse ne cite. cave-api les supprime ensuite par le stockage.
create or replace function public.retention_orphan_photos(p_limit integer default 1000) returns table (name text)
language sql stable security definer set search_path = public, storage as $$
  select o.name::text from storage.objects o
  where o.bucket_id = 'photos' and o.created_at < now() - interval '30 days'
    and not exists (select 1 from wines w where o.name in (w.label_photo, w.bottle_photo, w.bottle_photo_original))
    and not exists (select 1 from tastings t where t.photo = o.name)
    and not exists (select 1 from groups g where g.photo = o.name)
    and not exists (select 1 from event_wines e where e.label_photo = o.name)
    and not exists (select 1 from scans s, jsonb_array_elements(s.photos) p where p ->> 'path' = o.name)
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 1000), 5000))
$$;

-- ───────────── 7. Droits ─────────────

revoke all on function public.legal_fill_hash() from public, anon, authenticated;
revoke all on function public.legal_immutable() from public, anon, authenticated;
revoke all on function public.legal_append_only() from public, anon, authenticated;
revoke all on function public.profiles_after_delete_legal() from public, anon, authenticated;
revoke all on function public.legal_current_version(text) from public, anon, authenticated;
revoke all on function public.has_consent(uuid, text) from public, anon, authenticated;
revoke all on function public.consent_note(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.profiles_consent_discoverable() from public, anon, authenticated;
revoke all on function public.nous_links_consent() from public, anon, authenticated;
revoke all on function public.admin_strong_session() from public, anon, authenticated;
revoke all on function public.retention_purge() from public, anon, authenticated;
revoke all on function public.retention_orphan_photos(integer) from public, anon, authenticated;
revoke all on function public.consent_set(text, boolean, text) from public, anon;
revoke all on function public.legal_current() from public;
revoke all on function public.legal_pending() from public, anon;
revoke all on function public.legal_accept(uuid, text, text) from public, anon;
revoke all on function public.my_legal_history() from public, anon;
revoke all on function public.admin_legal_publish(text, text, text, text, boolean) from public, anon;
revoke all on function public.admin_legal_stats() from public, anon;
revoke all on function public.export_my_data() from public, anon;
-- Documents publiés : lisibles par tous, y compris sans compte (écran d'inscription).
grant execute on function public.legal_current() to anon, authenticated;
grant execute on function public.consent_set(text, boolean, text), public.legal_pending(), public.legal_accept(uuid, text, text),
  public.my_legal_history(), public.admin_legal_publish(text, text, text, text, boolean), public.admin_legal_stats(),
  public.export_my_data() to authenticated;
grant all on public.legal_documents, public.legal_acceptances, public.user_consents to service_role;
grant execute on all functions in schema public to service_role;
