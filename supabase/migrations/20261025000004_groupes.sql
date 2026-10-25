-- Cave & Amis — phase B « Amis & Groupes » : groupes, rôles, invitations, partage « visible » par groupe, activité.
--
-- Principes :
-- * un groupe a ses membres (administrateur, gestionnaire, membre) ; son créateur en est administrateur ;
-- * on n'invite que ses amis (jamais une personne bloquée) ; l'invité accepte ou refuse ; 50 personnes au plus par groupe ;
-- * partager un lot avec un groupe le rend VISIBLE à ses membres (mêmes masques que pour les amis) : rien n'est bloqué
--   ni transféré, la bouteille reste à son propriétaire (la mise à disposition de quantités viendra en phase C) ;
-- * quitter un groupe retire ses partages ; le dernier administrateur nomme un successeur avant de partir ;
--   un groupe sans membre est supprimé ; si l'administrateur supprime son compte, un autre membre est promu ;
-- * chaque action (adhésion, départ, rôle, partage…) est inscrite dans l'activité du groupe ;
-- * tout passe par des fonctions contrôlées ; les tables sont protégées par RLS.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000003_amis.sql.

-- ───────────── Tables ─────────────

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  emoji text not null default '🍷' check (char_length(emoji) between 1 and 16),
  description text check (char_length(description) <= 500),
  -- Photo : chemin dans le stockage privé « photos », dans le dossier de la personne qui l'a choisie.
  photo text check (char_length(photo) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_touch before update on public.groups for each row execute function public.touch_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'manager', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

-- Lots rendus visibles à un groupe par leur propriétaire (membre actif du groupe).
create table public.group_shares (
  lot_id uuid not null references public.lots (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lot_id, group_id)
);
create index group_shares_group on public.group_shares (group_id);
create index group_shares_owner on public.group_shares (owner_id);

-- Activité du groupe : noms figés au moment de l'action (lisibles même après un départ).
create table public.group_activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text check (char_length(actor_name) <= 40),
  kind text not null check (kind in ('created', 'updated', 'invited', 'joined', 'left', 'removed', 'role', 'shared', 'unshared')),
  target_name text check (char_length(target_name) <= 160),
  detail text check (char_length(detail) <= 200),
  -- Heure exacte de l'écriture (et non du début de la transaction) : l'ordre reste juste dans une même action.
  created_at timestamptz not null default clock_timestamp()
);
create index group_activity_group on public.group_activity (group_id, created_at desc);

-- Notifications : invitation à un groupe, invitation acceptée.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined'));

-- ───────────── Outils ─────────────

-- Mon rôle dans un groupe dont je suis membre actif (sinon null).
create function public.group_role(p_group uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from group_members where group_id = p_group and user_id = auth.uid() and status = 'active'
$$;

create function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.group_role(p_group) is not null
$$;

create function public.group_log(p_group uuid, p_kind text, p_target text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into group_activity (group_id, actor_id, actor_name, kind, target_name, detail)
  values (p_group, auth.uid(), (select display_name from profiles where id = auth.uid()), p_kind, left(p_target, 160), left(p_detail, 200));
  -- 500 lignes au plus par groupe : les plus anciennes sont effacées.
  delete from group_activity
  where group_id = p_group and id in (select id from group_activity where group_id = p_group order by created_at desc offset 500);
end $$;

-- Départ (volontaire, exclusion ou suppression de compte) : partages retirés, un administrateur toujours présent,
-- groupe supprimé s'il ne reste personne.
create function public.group_members_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_next group_members;
begin
  if not exists (select 1 from groups where id = old.group_id) then
    return old;
  end if;
  delete from group_shares where group_id = old.group_id and owner_id = old.user_id;
  if not exists (select 1 from group_members where group_id = old.group_id and status = 'active') then
    delete from groups where id = old.group_id;
    return old;
  end if;
  if not exists (select 1 from group_members where group_id = old.group_id and status = 'active' and role = 'admin') then
    select * into v_next from group_members
    where group_id = old.group_id and status = 'active'
    order by (role = 'manager') desc, joined_at nulls last
    limit 1;
    update group_members set role = 'admin' where group_id = v_next.group_id and user_id = v_next.user_id;
    insert into group_activity (group_id, actor_id, actor_name, kind, target_name, detail)
    values (old.group_id, null, null, 'role', (select display_name from profiles where id = v_next.user_id), 'admin');
  end if;
  return old;
end $$;
create trigger group_members_after_delete after delete on public.group_members
for each row execute function public.group_members_after_delete();

-- Chemin de photo choisi par la personne : seulement dans son propre dossier.
create function public.check_own_photo(p_path text) returns text
language plpgsql stable as $$
begin
  if p_path is null or p_path = '' then
    return null;
  end if;
  if p_path not like auth.uid()::text || '/%' or p_path like '%..%' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return p_path;
end $$;

-- ───────────── Groupes ─────────────

create function public.invite_to_group(p_group uuid, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_user uuid;
  v_count integer := 0;
begin
  if public.group_role(p_group) not in ('admin', 'manager') or public.group_role(p_group) is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from group_members where group_id = p_group) + coalesce(cardinality(p_users), 0) > 50 then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  foreach v_user in array coalesce(p_users, '{}') loop
    continue when v_user = v_me;
    -- Seulement mes amis ; une personne bloquée (dans un sens ou l'autre) n'est jamais invitable.
    if not public.is_friend(v_user) or public.is_blocked_between(v_me, v_user) then
      raise exception 'not_friend' using errcode = 'P0001';
    end if;
    continue when exists (select 1 from group_members where group_id = p_group and user_id = v_user);
    insert into group_members (group_id, user_id, invited_by) values (p_group, v_user, v_me);
    perform public.notify(v_user, 'group_invite', v_me, p_group);
    perform public.group_log(p_group, 'invited', (select display_name from profiles where id = v_user), null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.create_group(p_name text, p_emoji text, p_description text, p_photo text, p_invite uuid[]) returns groups
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_group groups;
begin
  if (select count(*) from groups where created_by = v_me) >= 50 then
    raise exception 'too_many_groups' using errcode = 'P0001';
  end if;
  insert into groups (name, emoji, description, photo, created_by)
  values (btrim(p_name), coalesce(nullif(btrim(p_emoji), ''), '🍷'), nullif(btrim(p_description), ''), public.check_own_photo(p_photo), v_me)
  returning * into v_group;
  insert into group_members (group_id, user_id, role, status, invited_by, joined_at) values (v_group.id, v_me, 'admin', 'active', v_me, now());
  perform public.group_log(v_group.id, 'created', v_group.name, null);
  if coalesce(cardinality(p_invite), 0) > 0 then
    perform public.invite_to_group(v_group.id, p_invite);
  end if;
  return v_group;
end $$;

-- Modification (administrateur) : seules les clés présentes dans p sont changées.
create function public.update_group(p_group uuid, p jsonb) returns groups
language plpgsql security definer set search_path = public as $$
declare
  v_group groups;
begin
  perform require_user();
  if public.group_role(p_group) is distinct from 'admin' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update groups set
    name = case when p ? 'name' then btrim(p ->> 'name') else name end,
    emoji = case when p ? 'emoji' then coalesce(nullif(btrim(p ->> 'emoji'), ''), '🍷') else emoji end,
    description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else description end,
    photo = case when p ? 'photo' then public.check_own_photo(p ->> 'photo') else photo end
  where id = p_group
  returning * into v_group;
  perform public.group_log(p_group, 'updated', v_group.name, null);
  return v_group;
end $$;

create function public.delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if public.group_role(p_group) is distinct from 'admin' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  delete from groups where id = p_group;
end $$;

create function public.respond_group_invite(p_group uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_members;
begin
  select * into v_row from group_members where group_id = p_group and user_id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Double clic : déjà membre.
  if v_row.status = 'active' then
    return 'active';
  end if;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_me and kind = 'group_invite' and ref_id = p_group;
  if not p_accept then
    delete from group_members where group_id = p_group and user_id = v_me;
    return 'declined';
  end if;
  update group_members set status = 'active', joined_at = now() where group_id = p_group and user_id = v_me;
  perform public.group_log(p_group, 'joined', (select display_name from profiles where id = v_me), null);
  perform public.notify(v_row.invited_by, 'group_joined', v_me, p_group);
  return 'active';
end $$;

create function public.cancel_group_invite(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if public.group_role(p_group) not in ('admin', 'manager') or public.group_role(p_group) is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  delete from group_members where group_id = p_group and user_id = p_user and status = 'invited';
  delete from notifications where user_id = p_user and kind = 'group_invite' and ref_id = p_group;
end $$;

create function public.set_member_role(p_group uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row group_members;
begin
  perform require_user();
  if public.group_role(p_group) is distinct from 'admin' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_role not in ('admin', 'manager', 'member') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_row from group_members where group_id = p_group and user_id = p_user and status = 'active' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.role = 'admin' and p_role <> 'admin'
     and (select count(*) from group_members where group_id = p_group and status = 'active' and role = 'admin') = 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  update group_members set role = p_role where group_id = p_group and user_id = p_user;
  perform public.group_log(p_group, 'role', (select display_name from profiles where id = p_user), p_role);
end $$;

-- Retirer un membre : l'administrateur retire n'importe qui ; le gestionnaire, seulement un simple membre.
create function public.remove_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_mine text := public.group_role(p_group);
  v_row group_members;
begin
  if p_user = v_me then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into v_row from group_members where group_id = p_group and user_id = p_user and status = 'active' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not (v_mine = 'admin' or (v_mine = 'manager' and v_row.role = 'member')) or v_mine is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform public.group_log(p_group, 'removed', (select display_name from profiles where id = p_user), null);
  delete from group_members where group_id = p_group and user_id = p_user;
end $$;

create function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_role text := public.group_role(p_group);
begin
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_role = 'admin'
     and (select count(*) from group_members where group_id = p_group and status = 'active' and role = 'admin') = 1
     and (select count(*) from group_members where group_id = p_group and status = 'active') > 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  perform public.group_log(p_group, 'left', (select display_name from profiles where id = v_me), null);
  delete from group_members where group_id = p_group and user_id = v_me;
end $$;

-- Rendre un de mes lots visible (ou non) dans un groupe dont je suis membre.
create function public.share_lot_with_group(p_lot uuid, p_group uuid, p_share boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_wine text;
begin
  select concat_ws(' ', w.name, w.vintage::text) into v_wine
  from lots l join wines w on w.id = l.wine_id
  where l.id = p_lot and l.owner_id = v_me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_share then
    if not public.is_group_member(p_group) then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    insert into group_shares (lot_id, group_id, owner_id) values (p_lot, p_group, v_me) on conflict do nothing;
    if found then
      perform public.group_log(p_group, 'shared', v_wine, null);
    end if;
  else
    delete from group_shares where lot_id = p_lot and group_id = p_group and owner_id = v_me;
    if found then
      perform public.group_log(p_group, 'unshared', v_wine, null);
    end if;
  end if;
end $$;

-- ───────────── Lectures ─────────────

-- Mes groupes (membre ou invité), avec mon rôle, le nombre de membres et de bouteilles visibles.
create function public.my_groups()
returns table (
  id uuid, name text, emoji text, description text, photo text, my_role text, my_status text,
  members integer, bottles integer, invited_by_name text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.emoji, g.description, g.photo, m.role, m.status,
    (select count(*)::int from group_members x where x.group_id = g.id and x.status = 'active'),
    (select count(*)::int from group_shares s join lots l on l.id = s.lot_id where s.group_id = g.id and l.quantity > 0),
    (select display_name from profiles where id = m.invited_by),
    g.created_at
  from group_members m join groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by m.status desc, g.name
$$;

-- Membres d'un groupe ; les invitations en attente ne sont montrées qu'aux administrateurs et gestionnaires.
create function public.group_members_list(p_group uuid)
returns table (user_id uuid, display_name text, role text, status text, joined_at timestamptz, invited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.display_name, m.role, m.status, m.joined_at, m.invited_at
  from group_members m join profiles p on p.id = m.user_id
  where m.group_id = p_group and public.is_group_member(p_group)
    and (m.status = 'active' or public.group_role(p_group) in ('admin', 'manager'))
  order by m.status, case m.role when 'admin' then 0 when 'manager' then 1 else 2 end, p.display_name
$$;

-- Cave du groupe : lots visibles, avec les masques de leur propriétaire (sauf pour les miens).
create function public.group_lots(p_group uuid)
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
  hide_price boolean, hide_quantity boolean, hide_notes boolean, updated_at timestamptz, mine boolean
)
language sql stable security definer set search_path = public as $$
  select l.id, l.owner_id, p.display_name, w.id,
    w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation,
    w.color, w.wine_type, w.grapes, w.vintage, w.non_vintage,
    w.label_photo, w.bottle_photo,
    w.drink_from, w.drink_until, w.window_source,
    w.serve_temp_min, w.serve_temp_max, w.aeration, w.pairings,
    l.volume_ml, l.visibility,
    case when l.hide_quantity and l.owner_id <> auth.uid() then null else l.quantity end,
    case when l.hide_quantity and l.owner_id <> auth.uid() then null else l.quantity - l.reserved end,
    l.quantity - l.reserved > 0,
    case when l.hide_price and l.owner_id <> auth.uid() then null else l.purchase_price end,
    case when l.hide_price and l.owner_id <> auth.uid() then null else l.currency end,
    case when l.hide_notes and l.owner_id <> auth.uid() then null else nullif(concat_ws(' — ', nullif(btrim(w.notes), ''), nullif(btrim(l.notes), '')), '') end,
    l.hide_price, l.hide_quantity, l.hide_notes, l.updated_at, l.owner_id = auth.uid()
  from group_shares s
  join lots l on l.id = s.lot_id
  join wines w on w.id = l.wine_id
  join profiles p on p.id = l.owner_id
  where s.group_id = p_group and public.is_group_member(p_group) and l.quantity > 0
  order by w.name, w.vintage, p.display_name
$$;

-- Photos : aussi lisibles par les membres d'un groupe (photo du groupe, vins visibles dans le groupe).
create or replace function public.can_read_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id
      where (w.label_photo = p_name or w.bottle_photo = p_name)
        and l.visibility in ('friends', 'event') and l.quantity > 0 and public.is_friend(w.owner_id)
    )
    or exists (
      select 1 from event_wines ew
      where ew.label_photo = p_name and ew.status in ('proposed', 'confirmed', 'consumed', 'not_consumed')
        and public.is_event_participant(ew.event_id)
    )
    or exists (
      select 1 from tastings t
      where t.photo = p_name and t.share_with_event and public.is_event_participant(t.event_id)
    )
    or exists (select 1 from groups g where g.photo = p_name and public.is_group_member(g.id))
    or exists (
      select 1 from wines w join lots l on l.wine_id = w.id join group_shares s on s.lot_id = l.id
      where (w.label_photo = p_name or w.bottle_photo = p_name) and l.quantity > 0 and public.is_group_member(s.group_id)
    )
  )
$$;

-- ───────────── Droits ─────────────

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_shares enable row level security;
alter table public.group_activity enable row level security;

create policy groups_read on public.groups for select to authenticated
  using (exists (select 1 from group_members m where m.group_id = groups.id and m.user_id = auth.uid()));
create policy group_members_read on public.group_members for select to authenticated
  using (user_id = auth.uid() or (public.is_group_member(group_id) and (status = 'active' or public.group_role(group_id) in ('admin', 'manager'))));
create policy group_shares_read on public.group_shares for select to authenticated using (owner_id = auth.uid());
create policy group_activity_read on public.group_activity for select to authenticated using (public.is_group_member(group_id));

grant select on public.groups, public.group_members, public.group_shares, public.group_activity to authenticated;

grant execute on function
  public.group_role(uuid), public.is_group_member(uuid),
  public.create_group(text, text, text, text, uuid[]), public.update_group(uuid, jsonb), public.delete_group(uuid),
  public.invite_to_group(uuid, uuid[]), public.respond_group_invite(uuid, boolean), public.cancel_group_invite(uuid, uuid),
  public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid), public.leave_group(uuid),
  public.share_lot_with_group(uuid, uuid, boolean),
  public.my_groups(), public.group_members_list(uuid), public.group_lots(uuid)
to authenticated;
