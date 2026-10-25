-- Cave & Amis — accès à une SÉLECTION de bouteilles, accès à DURÉE LIMITÉE, liens d'invitation retrouvables.
--
-- * Ouvrir sa cave à quelqu'un peut maintenant porter sur toute la cave partagée (comme avant) ou sur une sélection de
--   bouteilles seulement (celles « montrées » à cette personne), et s'arrêter tout seul à une date choisie. La règle
--   unique (cellar_open_to / lot_visible_to) en tient compte partout : caves partagées, suggestions d'événement,
--   photos, compteurs, Lia et l'aperçu « Ce que X voit de moi ».
-- * Un lien « voir ma cave » peut emporter ces réglages : sélection de bouteilles, niveau de détail, date de fin.
-- * Mes invitations : le code d'un nouveau lien est gardé, lisible par son auteur seulement, pour le recopier ou le
--   partager à nouveau (QR code, WhatsApp, SMS, e-mail) ; un destinataire facultatif (« Pour Paul ») ; la liste des
--   personnes qui ont utilisé mes liens.
-- * Préférences fusionnées côté base (étape de la visite guidée, astuces déjà vues).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261026000001_contacts_acces_cave.sql. Rejouable sans
-- danger. Aucune donnée existante n'est modifiée : les accès actuels portent sur toute la cave partagée, sans date de fin.
-- Retour arrière : supabase/sql/retour-20261026000002.sql.

-- ───────────── Colonnes ─────────────

alter table public.cellar_access add column if not exists scope text not null default 'shared'
  check (scope in ('shared', 'selection'));
alter table public.cellar_access add column if not exists expires_at timestamptz;

alter table public.friend_invites add column if not exists code text check (code ~ '^[A-Z2-9]{10}$');
alter table public.friend_invites add column if not exists note text check (char_length(note) <= 60);
alter table public.friend_invites add column if not exists options jsonb not null default '{}'::jsonb;

-- ───────────── Règle unique d'accès ─────────────

-- p_owner a ouvert sa cave à p_viewer : accès accordé et pas encore arrivé à échéance, relation en cours, aucun blocage.
create or replace function public.cellar_open_to(p_owner uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from cellar_access
      where owner_id = p_owner and viewer_id = p_viewer and (expires_at is null or expires_at > now())
    )
    and public.connected_between(p_owner, p_viewer)
    and not public.is_blocked_between(p_owner, p_viewer)
$$;

-- Un lot est visible dans la cave ouverte à p_viewer : exception « masquer » ou « montrer » pour cette personne
-- d'abord ; sinon, si l'accès porte sur toute la cave partagée, le réglage du lot (partagé avec mes amis, ou proposable
-- pour un événement). Un accès limité à une sélection ne montre que les bouteilles « montrées » à la personne.
create or replace function public.lot_visible_to(p_lot uuid, p_owner uuid, p_visibility text, p_quantity integer, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_viewer is not null and p_owner <> p_viewer and p_quantity > 0
    and public.cellar_open_to(p_owner, p_viewer)
    and coalesce(
      (select e.mode = 'show' from cellar_access_exceptions e where e.owner_id = p_owner and e.viewer_id = p_viewer and e.lot_id = p_lot),
      p_visibility in ('friends', 'event')
        and coalesce((select a.scope = 'shared' from cellar_access a where a.owner_id = p_owner and a.viewer_id = p_viewer), false)
    )
$$;

-- Même définition qu'avant, origine comprise : avec un accès limité à une sélection, chaque bouteille visible l'est par
-- la sélection (« exception »).
create or replace function public.cellar_view(p_viewer uuid, p_owner uuid)
returns table (
  lot_id uuid, owner_id uuid, owner_name text, wine_id uuid,
  name text, domaine text, producer text, cuvee text, country text, region text, appellation text,
  color text, wine_type text, grapes text[], vintage integer, non_vintage boolean,
  label_photo text, bottle_photo text,
  drink_from integer, drink_until integer, window_source text,
  serve_temp_min integer, serve_temp_max integer, aeration text, pairings text,
  volume_ml integer, visibility text,
  quantity integer, available integer, in_stock boolean,
  purchase_price numeric, currency text, notes text,
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz,
  origin text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.owner_id, p.display_name, w.id,
    w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation,
    w.color, w.wine_type, w.grapes, w.vintage, w.non_vintage,
    w.label_photo, w.bottle_photo,
    w.drink_from, w.drink_until, w.window_source,
    w.serve_temp_min, w.serve_temp_max, w.aeration, w.pairings,
    l.volume_ml, l.visibility,
    case when l.hide_quantity or r.restricted then null else l.quantity end,
    case when l.hide_quantity or r.restricted then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0,
    case when l.hide_price or r.restricted then null else l.purchase_price end,
    case when l.hide_price or r.restricted then null else l.currency end,
    case when l.hide_notes or r.restricted then null
         else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price or r.restricted, l.hide_quantity or r.restricted, l.hide_notes or r.restricted, l.updated_at,
    -- Origine : la sélection, sinon le réglage du lot, sinon (lot privé) l'exception « montrer » qui le rend visible.
    case when a.scope = 'selection' then 'exception'
         else case l.visibility when 'friends' then 'friends' when 'event' then 'proposable' else 'exception' end end
  from cellar_access a
  cross join lateral (select a.detail_level = 'restricted' as restricted) r
  join lots l on l.owner_id = a.owner_id
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where a.viewer_id = p_viewer
    and (p_owner is null or a.owner_id = p_owner)
    and public.lot_visible_to(l.id, l.owner_id, l.visibility, l.quantity, p_viewer)
$$;

-- ───────────── Ouvrir ma cave, et régler l'accès ─────────────

-- Rouvrir une cave dont l'accès était arrivé à échéance la rouvre sans date de fin (les autres réglages sont gardés).
create or replace function public.grant_cellar_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if p_user is null or p_user = v_me or not public.connected_between(v_me, p_user) or public.is_blocked_between(v_me, p_user) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  insert into cellar_access (owner_id, viewer_id) values (v_me, p_user)
  on conflict (owner_id, viewer_id) do update set expires_at = null, granted_at = now()
  where cellar_access.expires_at is not null and cellar_access.expires_at <= now();
  if found then
    perform public.notify(p_user, 'cellar_opened', v_me, null);
  end if;
  -- Sa demande d'accès éventuelle est satisfaite.
  update cellar_access_requests set status = 'accepted', responded_at = now() where from_id = p_user and to_id = v_me and status = 'pending';
end $$;

-- Réglages de l'accès que j'ai ouvert à une personne ; seules les clés présentes changent :
-- scope ('shared' : toute ma cave partagée ; 'selection' : seulement les bouteilles montrées à cette personne),
-- expires_at (date de fin, ou null), detail_level ('standard' ou 'restricted').
create or replace function public.set_cellar_access_options(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row cellar_access;
begin
  select * into v_row from cellar_access where owner_id = v_me and viewer_id = p_user for update;
  if not found or p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p ? 'scope' then
    if coalesce(p ->> 'scope', '') not in ('shared', 'selection') then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    v_row.scope := p ->> 'scope';
  end if;
  if p ? 'expires_at' then
    v_row.expires_at := nullif(p ->> 'expires_at', '')::timestamptz;
    if v_row.expires_at is not null and v_row.expires_at <= now() then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
  end if;
  if p ? 'detail_level' then
    if coalesce(p ->> 'detail_level', '') not in ('standard', 'restricted') then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    v_row.detail_level := p ->> 'detail_level';
  end if;
  update cellar_access set scope = v_row.scope, expires_at = v_row.expires_at, detail_level = v_row.detail_level
  where owner_id = v_me and viewer_id = p_user;
  return jsonb_build_object('scope', v_row.scope, 'expires_at', v_row.expires_at, 'detail_level', v_row.detail_level);
end $$;

-- ───────────── Liens d'invitation ─────────────

-- Nouveau lien. p_options : note (destinataire, facultatif) ; pour un lien « voir ma cave » (friend) : scope
-- ('shared' ou 'selection'), lots (identifiants de MES lots, pour une sélection), detail_level, access_expires_at.
-- Le code est gardé pour son auteur (Mes invitations), en plus de son empreinte qui sert à le retrouver.
drop function if exists public.create_invite(text, uuid);
create or replace function public.create_invite(p_kind text, p_target uuid default null, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
  v_code text := '';
  v_invite friend_invites;
  v_event events;
  v_max integer;
  v_expires timestamptz;
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_note text;
  v_options jsonb := '{}'::jsonb;
  v_scope text;
  v_level text;
  v_until timestamptz;
  v_lots jsonb;
begin
  if p_kind is null or p_kind not in ('discovery', 'friend', 'group', 'event') or jsonb_typeof(v_opts) <> 'object' then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from friend_invites where inviter_id = v_me and status = 'pending' and expires_at > now() and uses < max_uses) >= 20 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  v_note := left(nullif(btrim(v_opts ->> 'note'), ''), 60);
  case p_kind
    when 'discovery' then
      v_max := 10;
      v_expires := now() + interval '30 days';
    when 'friend' then
      v_max := 1;
      v_expires := now() + interval '14 days';
      v_scope := coalesce(v_opts ->> 'scope', 'shared');
      v_level := coalesce(v_opts ->> 'detail_level', 'standard');
      v_until := nullif(v_opts ->> 'access_expires_at', '')::timestamptz;
      if v_scope not in ('shared', 'selection') or v_level not in ('standard', 'restricted') or (v_until is not null and v_until <= now()) then
        raise exception 'invalid' using errcode = 'P0001';
      end if;
      -- Seulement MES lots, encore en cave ; 200 au plus.
      select coalesce(jsonb_agg(l.id), '[]'::jsonb) into v_lots
      from lots l
      where l.owner_id = v_me and l.quantity > 0
        and l.id::text in (
          select jsonb_array_elements_text(case when jsonb_typeof(v_opts -> 'lots') = 'array' then v_opts -> 'lots' else '[]'::jsonb end)
          limit 200
        );
      if v_scope = 'selection' and jsonb_array_length(v_lots) = 0 then
        raise exception 'invalid' using errcode = 'P0001';
      end if;
      v_options := jsonb_build_object('scope', v_scope, 'detail_level', v_level, 'access_expires_at', v_until, 'lots', v_lots);
    when 'group' then
      if p_target is null or coalesce(public.group_role(p_target), '') not in ('admin', 'manager') then
        raise exception 'forbidden' using errcode = 'P0001';
      end if;
      v_max := 20;
      v_expires := now() + interval '14 days';
    else
      select * into v_event from events where id = p_target;
      if not found or v_event.organizer_id <> v_me then
        raise exception 'forbidden' using errcode = 'P0001';
      end if;
      if v_event.status <> 'planned' or v_event.starts_at <= now() then
        raise exception 'event_not_planned' using errcode = 'P0001';
      end if;
      v_max := 20;
      -- Valable jusqu'à l'événement.
      v_expires := v_event.starts_at;
  end case;
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  insert into friend_invites (inviter_id, code_hash, code, note, options, kind, target_id, max_uses, expires_at)
  values (v_me, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_code, v_note, v_options, p_kind,
          case when p_kind in ('group', 'event') then p_target end, v_max, v_expires)
  returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'code', v_code, 'expires_at', v_invite.expires_at, 'kind', p_kind, 'max_uses', v_max);
end $$;

-- Page d'un lien (lisible sans compte) : comme avant ; pour un lien « voir ma cave » encore valable, on précise s'il
-- porte sur une sélection de bouteilles (sans dire lesquelles).
create or replace function public.friend_invite_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invite friend_invites;
  v_name text;
  v_status text;
  v_label text;
  v_date timestamptz;
  v_result jsonb;
begin
  select * into v_invite from friend_invites where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select split_part(btrim(display_name), ' ', 1) into v_name from profiles where id = v_invite.inviter_id;
  v_status := case
    when v_invite.status = 'revoked' then 'revoked'
    when auth.uid() is not null and exists (select 1 from invite_redemptions r where r.invite_id = v_invite.id and r.user_id = auth.uid()) then 'accepted'
    when v_invite.status = 'declined' and v_invite.responded_by = auth.uid() then 'declined'
    when v_invite.uses >= v_invite.max_uses or v_invite.status in ('accepted', 'declined') then 'used'
    when v_invite.expires_at <= now() then 'expired'
    else 'pending'
  end;
  -- Le nom du groupe, le titre et la date de l'événement : seulement pour un lien encore valable.
  if v_status in ('pending', 'accepted') then
    if v_invite.kind = 'group' then
      select name into v_label from groups where id = v_invite.target_id;
    elsif v_invite.kind = 'event' then
      select title, starts_at into v_label, v_date from events where id = v_invite.target_id;
    end if;
  end if;
  v_result := jsonb_build_object('status', v_status, 'kind', v_invite.kind, 'inviter_name', v_name,
                                 'target_label', v_label, 'target_date', v_date);
  if v_invite.kind = 'friend' and v_status in ('pending', 'accepted') then
    v_result := v_result || jsonb_build_object('selection', coalesce(v_invite.options ->> 'scope', 'shared') = 'selection');
  end if;
  if auth.uid() is not null then
    v_result := v_result || jsonb_build_object(
      'is_self', v_invite.inviter_id = auth.uid(),
      'already_friends', public.connected_between(auth.uid(), v_invite.inviter_id)
    );
  end if;
  return v_result;
end $$;

-- Utiliser un lien : comme avant ; un lien « voir ma cave » ouvre la cave avec les réglages choisis par son auteur
-- (sélection de bouteilles, niveau de détail, date de fin). Un accès déjà ouvert n'est jamais restreint par un nouveau
-- lien ; un accès arrivé à échéance prend les réglages du nouveau lien.
create or replace function public.respond_friend_invite(p_code text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_invite friend_invites;
  v_name text;
  v_event events;
  v_member text;
  v_result jsonb;
  v_until timestamptz;
begin
  select * into v_invite from friend_invites
  where code_hash = encode(sha256(convert_to(normalize_code(p_code), 'UTF8')), 'hex')
  for update;
  if not found or public.is_blocked_between(v_me, v_invite.inviter_id) then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if v_invite.inviter_id = v_me then
    raise exception 'invite_self' using errcode = 'P0001';
  end if;
  select display_name into v_name from profiles where id = v_invite.inviter_id;
  v_result := jsonb_build_object('friend_id', v_invite.inviter_id, 'friend_name', v_name, 'kind', v_invite.kind,
                                 'target_id', case when v_invite.kind in ('group', 'event') then v_invite.target_id end);
  if exists (select 1 from invite_redemptions where invite_id = v_invite.id and user_id = v_me) then
    return v_result || jsonb_build_object('status', 'accepted');
  end if;
  if v_invite.status = 'declined' and v_invite.responded_by = v_me then
    return v_result || jsonb_build_object('status', 'declined');
  end if;
  if v_invite.status = 'revoked' then
    raise exception 'invite_revoked' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' or v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;
  v_until := nullif(v_invite.options ->> 'access_expires_at', '')::timestamptz;
  if v_invite.expires_at <= now() or (v_until is not null and v_until <= now()) then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if not p_accept then
    -- Lien à usage unique : il est consommé. Lien réutilisable : rien ne change pour les autres.
    if v_invite.max_uses = 1 then
      update friend_invites set status = 'declined', responded_by = v_me, responded_at = now() where id = v_invite.id;
    end if;
    return v_result || jsonb_build_object('status', 'declined');
  end if;
  -- La cible est vérifiée avant de créer quoi que ce soit.
  if v_invite.kind = 'group' then
    if not exists (select 1 from groups where id = v_invite.target_id) then
      raise exception 'invite_invalid' using errcode = 'P0001';
    end if;
    if not exists (select 1 from group_members where group_id = v_invite.target_id and user_id = v_me)
       and (select count(*) from group_members where group_id = v_invite.target_id) >= 50 then
      raise exception 'group_full' using errcode = 'P0001';
    end if;
  elsif v_invite.kind = 'event' then
    select * into v_event from events where id = v_invite.target_id for update;
    if not found or v_event.status <> 'planned' then
      raise exception 'event_not_planned' using errcode = 'P0001';
    end if;
  end if;
  perform public.make_friends(v_me, v_invite.inviter_id, v_invite.inviter_id);
  if v_invite.kind = 'friend' then
    insert into cellar_access (owner_id, viewer_id, scope, detail_level, expires_at)
    values (v_invite.inviter_id, v_me, coalesce(v_invite.options ->> 'scope', 'shared'),
            coalesce(v_invite.options ->> 'detail_level', 'standard'), v_until)
    on conflict (owner_id, viewer_id) do update
      set scope = excluded.scope, detail_level = excluded.detail_level, expires_at = excluded.expires_at, granted_at = now()
      where cellar_access.expires_at is not null and cellar_access.expires_at <= now();
    -- Les bouteilles choisies par l'auteur du lien (seulement les siennes, encore présentes).
    insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode)
    select v_invite.inviter_id, v_me, l.id, 'show'
    from lots l
    where l.owner_id = v_invite.inviter_id
      and l.id::text in (
        select jsonb_array_elements_text(case when jsonb_typeof(v_invite.options -> 'lots') = 'array' then v_invite.options -> 'lots' else '[]'::jsonb end)
      )
    on conflict (owner_id, viewer_id, lot_id) do update set mode = 'show', created_at = now();
  elsif v_invite.kind = 'group' then
    -- Accepter le lien vaut acceptation de l'invitation : membre actif d'emblée.
    select status into v_member from group_members where group_id = v_invite.target_id and user_id = v_me for update;
    if v_member is null then
      insert into group_members (group_id, user_id, status, invited_by, joined_at)
      values (v_invite.target_id, v_me, 'active', v_invite.inviter_id, now());
    elsif v_member = 'invited' then
      update group_members set status = 'active', joined_at = now() where group_id = v_invite.target_id and user_id = v_me;
      update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'group_invite' and ref_id = v_invite.target_id;
    end if;
    if v_member is distinct from 'active' then
      perform public.group_log(v_invite.target_id, 'joined', (select display_name from profiles where id = v_me), null);
    end if;
  elsif v_invite.kind = 'event' then
    insert into event_participants (event_id, user_id) values (v_invite.target_id, v_me) on conflict do nothing;
    -- L'invitation à l'événement vient d'être acceptée par le lien : sa notification est déjà lue.
    update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'event_invite' and ref_id = v_invite.target_id;
  end if;
  insert into invite_redemptions (invite_id, user_id) values (v_invite.id, v_me);
  update friend_invites
  set uses = uses + 1,
      status = case when uses + 1 >= max_uses then 'accepted' else status end,
      responded_by = v_me, responded_at = now()
  where id = v_invite.id;
  if v_invite.kind = 'group' and v_member is distinct from 'active' then
    perform public.notify(v_invite.inviter_id, 'group_joined', v_me, v_invite.target_id);
  else
    perform public.notify(v_invite.inviter_id, 'invite_joined', v_me, v_invite.id);
  end if;
  return v_result || jsonb_build_object('status', 'accepted');
end $$;

-- Qui a utilisé mes liens, et quand (Mes invitations). Le nom d'une personne bloquée n'est pas montré.
create or replace function public.my_invite_redemptions()
returns table (invite_id uuid, user_id uuid, display_name text, redeemed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.invite_id, r.user_id,
    case when public.is_blocked_between(auth.uid(), r.user_id) then null else p.display_name end,
    r.redeemed_at
  from invite_redemptions r
  join friend_invites i on i.id = r.invite_id
  join profiles p on p.id = r.user_id
  where i.inviter_id = auth.uid()
  order by r.redeemed_at desc
  limit 500
$$;

-- ───────────── Mes relations : en plus, la portée et la date de fin de l'accès que j'ai ouvert ─────────────

drop function if exists public.my_relations();
create function public.my_relations()
returns table (
  user_id uuid, display_name text, since timestamptz,
  they_see_mine boolean, i_see_theirs boolean, detail_level text, exceptions integer,
  visible_lots integer, visible_bottles integer, shared_with_me integer,
  request_in uuid, request_out uuid,
  scope text, access_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select o.id, p.display_name, f.created_at,
    public.cellar_open_to(auth.uid(), o.id),
    public.cellar_open_to(o.id, auth.uid()),
    a.detail_level,
    (select count(*)::int from cellar_access_exceptions e where e.owner_id = auth.uid() and e.viewer_id = o.id),
    mine.lots, mine.bottles,
    (select count(*)::int from public.cellar_view(auth.uid(), o.id)),
    (select r.id from cellar_access_requests r where r.from_id = o.id and r.to_id = auth.uid() and r.status = 'pending'),
    (select r.id from cellar_access_requests r where r.from_id = auth.uid() and r.to_id = o.id and r.status = 'pending'),
    a.scope, a.expires_at
  from friendships f
  cross join lateral (select case when f.user_a = auth.uid() then f.user_b else f.user_a end as id) o
  join profiles p on p.id = o.id
  left join cellar_access a on a.owner_id = auth.uid() and a.viewer_id = o.id
  -- Ce que cette personne voit de ma cave (même règle que la vue qui lui est servie) : vins et bouteilles.
  cross join lateral (
    select count(*)::int as lots, coalesce(sum(l.quantity), 0)::int as bottles
    from public.cellar_view(o.id, auth.uid()) v join lots l on l.id = v.lot_id
  ) mine
  where auth.uid() in (f.user_a, f.user_b)
  order by p.display_name
$$;

-- ───────────── Préférences : visite guidée, astuces vues ─────────────

-- Fusion côté base : enregistrer l'étape de la visite guidée n'écrase pas une autre préférence modifiée entre-temps.
create or replace function public.merge_preferences(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prefs jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 2000 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  update profiles set preferences = coalesce(preferences, '{}'::jsonb) || p where id = require_user()
  returning preferences into v_prefs;
  return v_prefs;
end $$;

-- ───────────── Droits ─────────────

-- Règles internes : jamais appelables directement, elles prennent la personne en paramètre.
revoke execute on function
  public.cellar_open_to(uuid, uuid), public.lot_visible_to(uuid, uuid, text, integer, uuid), public.cellar_view(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_invite(text, uuid, jsonb), public.set_cellar_access_options(uuid, jsonb),
  public.my_invite_redemptions(), public.my_relations(), public.merge_preferences(jsonb)
to authenticated;
