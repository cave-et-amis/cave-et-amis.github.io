-- Cave & Amis — phase A « Amis & Groupes » : visibilité dans la recherche, demandes d'ami, blocage, notifications.
--
-- Principes :
-- * personne n'apparaît dans la recherche sans l'avoir choisi (profiles.discoverable, désactivé par défaut) ;
--   la recherche se fait par nom (3 lettres minimum, 10 résultats au plus), jamais par e-mail ;
-- * une demande d'ami ne vise qu'une personne visible, ou rencontrée lors d'un événement commun ;
--   20 demandes par jour au plus, et pas de nouvelle demande pendant 30 jours après un refus ;
-- * bloquer quelqu'un supprime l'amitié et les demandes en cours ; il ne vous trouve plus et ne peut plus vous inviter ;
-- * les notifications sont écrites par la base elle-même (jamais par le navigateur) ;
-- * tout passe par des fonctions contrôlées ; les tables sont protégées par RLS.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000002_photo_originale.sql.

-- ───────────── Visibilité ─────────────

alter table public.profiles add column discoverable boolean not null default false;
grant update (discoverable) on public.profiles to authenticated;

-- Texte simplifié pour la recherche : minuscules, sans accents (sans extension).
create function public.fold_text(p text) returns text
language sql immutable as $$
  select translate(lower(coalesce(p, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')
$$;

-- ───────────── Blocage ─────────────

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

create function public.is_blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

-- ───────────── Demandes d'ami ─────────────

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
-- Une seule demande en attente par paire de personnes, dans un sens comme dans l'autre.
create unique index friend_requests_pending on public.friend_requests (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index friend_requests_to on public.friend_requests (to_id, status);
create index friend_requests_from on public.friend_requests (from_id, created_at);

-- ───────────── Notifications ─────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'event_invite')),
  actor_id uuid references public.profiles (id) on delete set null,
  -- Nom affiché, figé au moment de la notification (la personne n'est pas forcément encore un ami).
  actor_name text check (char_length(actor_name) <= 40),
  ref_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);

-- Écrite seulement par les fonctions de la base ; rien entre deux personnes qui se sont bloquées.
create function public.notify(p_user uuid, p_kind text, p_actor uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor or public.is_blocked_between(p_user, p_actor) then
    return;
  end if;
  insert into notifications (user_id, kind, actor_id, actor_name, ref_id)
  values (p_user, p_kind, p_actor, (select display_name from profiles where id = p_actor), p_ref);
  -- 200 notifications au plus par personne : les plus anciennes sont effacées.
  delete from notifications
  where user_id = p_user and id in (select id from notifications where user_id = p_user order by created_at desc offset 200);
end $$;

create function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = public.require_user() and read_at is null
$$;

-- Invitation à un événement : l'invité est prévenu.
create function public.event_participants_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'guest' then
    perform public.notify(new.user_id, 'event_invite', (select organizer_id from events where id = new.event_id), new.event_id);
  end if;
  return new;
end $$;
create trigger event_participants_notify after insert on public.event_participants
for each row execute function public.event_participants_notify();

-- ───────────── Fonctions ─────────────

-- Recherche : personnes visibles, pas moi, pas bloquées ; avec la relation actuelle.
create function public.search_users(p_query text)
returns table (id uuid, display_name text, relation text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_q text := public.fold_text(regexp_replace(btrim(coalesce(p_query, '')), '[%_\\]', '', 'g'));
begin
  if char_length(v_q) < 3 or char_length(v_q) > 40 then
    return;
  end if;
  return query
  select p.id, p.display_name,
    case
      when public.is_friend(p.id) then 'friend'
      when exists (select 1 from friend_requests r where r.from_id = v_me and r.to_id = p.id and r.status = 'pending') then 'requested'
      when exists (select 1 from friend_requests r where r.from_id = p.id and r.to_id = v_me and r.status = 'pending') then 'incoming'
      else 'none'
    end
  from profiles p
  where p.discoverable and p.id <> v_me and not public.is_blocked_between(v_me, p.id)
    and public.fold_text(p.display_name) like '%' || v_q || '%'
  order by (public.fold_text(p.display_name) like v_q || '%') desc, p.display_name
  limit 10;
end $$;

-- Ajoute l'amitié (déjà amis : rien à faire).
create function public.make_friends(p_a uuid, p_b uuid, p_invited_by uuid) returns void
language sql security definer set search_path = public as $$
  insert into friendships (user_a, user_b, invited_by)
  values (least(p_a, p_b), greatest(p_a, p_b), p_invited_by)
  on conflict do nothing
$$;

create function public.send_friend_request(p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req friend_requests;
begin
  if p_to is null or p_to = v_me then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  -- Une personne qui m'a bloqué (ou que j'ai bloquée) est « introuvable » : le blocage n'est jamais révélé.
  if not exists (select 1 from profiles where id = p_to) or public.is_blocked_between(v_me, p_to) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if public.is_friend(p_to) then
    return jsonb_build_object('status', 'already_friends');
  end if;
  -- Elle m'a déjà fait une demande : on devient amis.
  select * into v_req from friend_requests where from_id = p_to and to_id = v_me and status = 'pending' for update;
  if found then
    perform public.make_friends(v_me, p_to, p_to);
    update friend_requests set status = 'accepted', responded_at = now() where id = v_req.id;
    perform public.notify(p_to, 'friend_accepted', v_me, v_req.id);
    return jsonb_build_object('status', 'accepted', 'id', v_req.id);
  end if;
  select * into v_req from friend_requests where from_id = v_me and to_id = p_to and status = 'pending';
  if found then
    return jsonb_build_object('status', 'requested', 'id', v_req.id);
  end if;
  if not exists (select 1 from profiles where id = p_to and discoverable) and not public.shares_event(p_to) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from friend_requests
    where from_id = v_me and to_id = p_to and status = 'declined' and responded_at > now() - interval '30 days'
  ) then
    raise exception 'request_cooldown' using errcode = 'P0001';
  end if;
  if (select count(*) from friend_requests where from_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into friend_requests (from_id, to_id) values (v_me, p_to) returning * into v_req;
  perform public.notify(p_to, 'friend_request', v_me, v_req.id);
  return jsonb_build_object('status', 'requested', 'id', v_req.id);
end $$;

create function public.respond_friend_request(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_req friend_requests;
begin
  select * into v_req from friend_requests where id = p_id and to_id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic : la réponse déjà donnée est renvoyée telle quelle.
  if v_req.status in ('accepted', 'declined') then
    return jsonb_build_object('status', v_req.status);
  end if;
  if v_req.status <> 'pending' or public.is_blocked_between(v_me, v_req.from_id) then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.make_friends(v_me, v_req.from_id, v_req.from_id);
    perform public.notify(v_req.from_id, 'friend_accepted', v_me, v_req.id);
  end if;
  update friend_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'friend_request' and ref_id = p_id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

create function public.cancel_friend_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  update friend_requests set status = 'cancelled', responded_at = now() where id = p_id and from_id = v_me and status = 'pending';
  if found then
    delete from notifications where kind = 'friend_request' and ref_id = p_id;
  end if;
end $$;

-- Mes demandes en attente, reçues et envoyées, avec le nom de l'autre personne.
create function public.my_friend_requests()
returns table (id uuid, direction text, other_id uuid, other_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, case when r.to_id = auth.uid() then 'in' else 'out' end,
    case when r.to_id = auth.uid() then r.from_id else r.to_id end, p.display_name, r.created_at
  from friend_requests r
  join profiles p on p.id = case when r.to_id = auth.uid() then r.from_id else r.to_id end
  where r.status = 'pending' and auth.uid() in (r.from_id, r.to_id)
  order by r.created_at desc
$$;

create function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  if p_user is null or p_user = v_me or not exists (select 1 from profiles where id = p_user) then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  insert into blocks (blocker_id, blocked_id) values (v_me, p_user) on conflict do nothing;
  delete from friendships where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user);
  update friend_requests set status = 'cancelled', responded_at = now()
  where status = 'pending' and ((from_id = v_me and to_id = p_user) or (from_id = p_user and to_id = v_me));
  delete from notifications where user_id = v_me and actor_id = p_user;
end $$;

create function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = public.require_user() and blocked_id = p_user
$$;

create function public.my_blocks()
returns table (blocked_id uuid, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, p.display_name, b.created_at
  from blocks b join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by p.display_name
$$;

-- Invitation par lien : refusée entre personnes qui se sont bloquées, et l'auteur du lien est prévenu.
create or replace function public.respond_friend_invite(p_code text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_invite friend_invites;
  v_name text;
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
  -- Double clic ou nouvel essai : la réponse déjà donnée par cette personne est renvoyée telle quelle.
  if v_invite.status in ('accepted', 'declined') and v_invite.responded_by = v_me then
    return jsonb_build_object('status', v_invite.status, 'friend_id', v_invite.inviter_id, 'friend_name', v_name);
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.make_friends(v_me, v_invite.inviter_id, v_invite.inviter_id);
    perform public.notify(v_invite.inviter_id, 'friend_accepted', v_me, v_invite.id);
  end if;
  update friend_invites
  set status = case when p_accept then 'accepted' else 'declined' end, responded_by = v_me, responded_at = now()
  where id = v_invite.id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'friend_id', v_invite.inviter_id, 'friend_name', v_name);
end $$;

-- ───────────── Droits ─────────────

alter table public.blocks enable row level security;
alter table public.friend_requests enable row level security;
alter table public.notifications enable row level security;

create policy blocks_read on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy friend_requests_read on public.friend_requests for select to authenticated using (auth.uid() in (from_id, to_id));
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

grant select on public.blocks, public.friend_requests, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

grant execute on function
  public.fold_text(text), public.is_blocked_between(uuid, uuid), public.search_users(text),
  public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean), public.cancel_friend_request(uuid),
  public.my_friend_requests(), public.block_user(uuid), public.unblock_user(uuid), public.my_blocks(),
  public.mark_notifications_read()
to authenticated;
