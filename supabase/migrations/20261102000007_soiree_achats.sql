-- Cave & Amis 2.0 — mode soirée et achats groupés (maquette, panneaux 4 et 11).
--
-- 1. Mode soirée : pendant un événement, l'organisateur lance la soirée (à l'aveugle ou non), choisit la bouteille servie
--    et la révèle ; les participants échangent de courts messages et notent chaque bouteille (1 à 5). Le masquage « à
--    l'aveugle » est un jeu affiché par l'application, pas une protection : les participants voient déjà les bouteilles
--    confirmées de l'événement. Messages et notes sont lus par les seuls participants, jamais ceux d'une personne bloquée
--    (dans un sens ou dans l'autre).
-- 2. Achats groupés : dans un groupe, un membre propose un achat (titre, budget facultatif), les membres y ajoutent des
--    vins (prix unitaire, nombre de bouteilles) et prennent leur part ; chacun valide ses parts. AUCUN paiement ne passe
--    par l'application : c'est une liste partagée. La prise de parts est protégée contre les accès simultanés (verrou sur
--    la ligne du vin) : on ne dépasse jamais le nombre de bouteilles prévu. Quitter le groupe retire ses parts des achats
--    encore ouverts.
-- 3. Export « mes données » : messages, notes de soirée, achats proposés et parts prises s'y ajoutent.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000006_profil_gustatif.sql. Ne modifie aucune donnée
-- existante. À déployer AVANT le nouveau site. Retour arrière : supabase/sql/retour-20261102000007.sql.

-- ───────────── 1. Mode soirée ─────────────

create table public.event_live (
  event_id uuid primary key references public.events (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  blind boolean not null default false,
  current_wine uuid references public.event_wines (id) on delete set null,
  current_since timestamptz not null default now(),
  revealed uuid[] not null default '{}' check (cardinality(revealed) <= 100),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default clock_timestamp()
);
create index event_messages_event on public.event_messages (event_id, created_at);
create index event_messages_user on public.event_messages (user_id);

create table public.event_votes (
  event_wine_id uuid not null references public.event_wines (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (event_wine_id, user_id)
);
create index event_votes_user on public.event_votes (user_id);

alter table public.event_live enable row level security;
alter table public.event_messages enable row level security;
alter table public.event_votes enable row level security;
-- Lecture directe : l'état de la soirée pour les participants ; messages et notes passent par event_live_state().
create policy event_live_read on public.event_live for select to authenticated using (public.is_event_participant(event_id));
create policy event_messages_read on public.event_messages for select to authenticated using (user_id = auth.uid());
create policy event_votes_read on public.event_votes for select to authenticated using (user_id = auth.uid());
grant select on public.event_live, public.event_messages, public.event_votes to authenticated;

-- Une bouteille de cet événement, servie ou servable pendant la soirée.
create function public.event_live_wine_ok(p_event uuid, p_wine uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_wines where id = p_wine and event_id = p_event and status in ('confirmed', 'consumed', 'not_consumed'))
$$;

create function public.start_event_live(p_event uuid, p_blind boolean) returns event_live
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_live;
  v_first uuid;
begin
  if not public.is_event_organizer(p_event) or not exists (select 1 from events where id = p_event and status = 'planned') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select id into v_first from event_wines
  where event_id = p_event and status in ('confirmed', 'consumed', 'not_consumed')
  order by service_position nulls last, created_at limit 1;
  insert into event_live (event_id, started_by, blind, current_wine)
  values (p_event, v_me, coalesce(p_blind, false), v_first)
  on conflict (event_id) do update
    set blind = excluded.blind, ended_at = null, started_by = excluded.started_by,
        current_wine = coalesce(event_live.current_wine, excluded.current_wine)
  returning * into v_row;
  return v_row;
end $$;

-- L'organisateur sert une bouteille (« Passer » : la suivante), la révèle, ou termine la soirée.
create function public.event_live_serve(p_event uuid, p_wine uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if not public.is_event_organizer(p_event) or not exists (select 1 from event_live where event_id = p_event and ended_at is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not public.event_live_wine_ok(p_event, p_wine) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update event_live set current_wine = p_wine, current_since = now() where event_id = p_event;
end $$;

create function public.event_live_reveal(p_event uuid, p_wine uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if not public.is_event_organizer(p_event) or not exists (select 1 from event_live where event_id = p_event and ended_at is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not public.event_live_wine_ok(p_event, p_wine) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update event_live set revealed = array(select distinct unnest(revealed || p_wine)) where event_id = p_event;
end $$;

create function public.end_event_live(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if not public.is_event_organizer(p_event) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update event_live set ended_at = coalesce(ended_at, now()) where event_id = p_event;
end $$;

-- Un message pendant la soirée en cours (500 au plus par soirée).
create function public.post_event_message(p_event uuid, p_body text) returns event_messages
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row event_messages;
begin
  if not public.is_event_participant(p_event) or not exists (select 1 from event_live where event_id = p_event and ended_at is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from event_messages where event_id = p_event) >= 500 then
    raise exception 'event_messages_full' using errcode = 'P0001';
  end if;
  insert into event_messages (event_id, user_id, body) values (p_event, v_me, btrim(p_body)) returning * into v_row;
  return v_row;
end $$;

-- Ma note d'une bouteille de la soirée (null : la retirer).
create function public.vote_event_wine(p_wine uuid, p_rating smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_event uuid;
begin
  select event_id into v_event from event_wines where id = p_wine and status in ('confirmed', 'consumed', 'not_consumed');
  if v_event is null or not public.is_event_participant(v_event) or not exists (select 1 from event_live where event_id = v_event) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_rating is null then
    delete from event_votes where event_wine_id = p_wine and user_id = v_me;
  else
    insert into event_votes (event_wine_id, user_id, rating) values (p_wine, v_me, p_rating)
    on conflict (event_wine_id, user_id) do update set rating = excluded.rating, updated_at = now();
  end if;
end $$;

-- État de la soirée pour un participant : la soirée, les 100 derniers messages (sans ceux des personnes bloquées), et
-- pour chaque bouteille la moyenne des notes, leur nombre et la mienne.
create function public.event_live_state(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  -- Double authentification activée mais session non vérifiée : rien (comme require_user()).
  select case when not public.is_event_participant(p_event) or not public.mfa_ok() then null else jsonb_build_object(
    'live', (select to_jsonb(l) from event_live l where l.event_id = p_event),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'author', p.display_name, 'body', m.body,
                                          'created_at', m.created_at, 'mine', m.user_id = auth.uid()) order by m.created_at)
      from (select * from event_messages where event_id = p_event order by created_at desc limit 100) m
      join profiles p on p.id = m.user_id
      where not public.is_blocked_between(auth.uid(), m.user_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('event_wine_id', w.id,
        'average', (select round(avg(v.rating), 1) from event_votes v where v.event_wine_id = w.id),
        'count', (select count(*) from event_votes v where v.event_wine_id = w.id),
        'mine', (select v.rating from event_votes v where v.event_wine_id = w.id and v.user_id = auth.uid())))
      from event_wines w where w.event_id = p_event and w.status in ('confirmed', 'consumed', 'not_consumed')), '[]'::jsonb)
  ) end
$$;

-- ───────────── 2. Achats groupés ─────────────

create table public.group_purchases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  budget numeric(10, 2) check (budget > 0 and budget < 1000000),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz
);
create index group_purchases_group on public.group_purchases (group_id, created_at);
create index group_purchases_creator on public.group_purchases (created_by);

create table public.group_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.group_purchases (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  wine_name text not null check (char_length(btrim(wine_name)) between 1 and 120),
  producer text check (char_length(producer) <= 120),
  vintage integer check (vintage between 1800 and 2100),
  color text check (color in ('rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre')),
  unit_price numeric(10, 2) not null check (unit_price >= 0 and unit_price < 100000),
  bottles integer not null check (bottles between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);
create index group_purchase_items_purchase on public.group_purchase_items (purchase_id, created_at);

create table public.group_purchase_parts (
  item_id uuid not null references public.group_purchase_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bottles integer not null check (bottles between 1 and 120),
  validated boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index group_purchase_parts_user on public.group_purchase_parts (user_id);

alter table public.group_purchases enable row level security;
alter table public.group_purchase_items enable row level security;
alter table public.group_purchase_parts enable row level security;
create policy group_purchases_read on public.group_purchases for select to authenticated using (public.is_group_member(group_id));
create policy group_purchase_items_read on public.group_purchase_items for select to authenticated
  using (exists (select 1 from group_purchases p where p.id = purchase_id and public.is_group_member(p.group_id)));
create policy group_purchase_parts_read on public.group_purchase_parts for select to authenticated
  using (exists (select 1 from group_purchase_items i join group_purchases p on p.id = i.purchase_id where i.id = item_id and public.is_group_member(p.group_id)));
grant select on public.group_purchases, public.group_purchase_items, public.group_purchase_parts to authenticated;

-- Groupe d'un achat encore ouvert dont je suis membre (sinon erreur « not_found »).
create function public.open_purchase_group(p_purchase uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
begin
  select group_id into v_group from group_purchases where id = p_purchase and status = 'open';
  if v_group is null or not public.is_group_member(v_group) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_group;
end $$;

create function public.create_group_purchase(p_group uuid, p jsonb) returns group_purchases
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_purchases;
begin
  if not public.is_group_member(p_group) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select count(*) from group_purchases where group_id = p_group and status = 'open') >= 20 then
    raise exception 'group_purchases_full' using errcode = 'P0001';
  end if;
  insert into group_purchases (group_id, created_by, title, budget, note)
  values (p_group, v_me, btrim(p ->> 'title'), nullif(p ->> 'budget', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning * into v_row;
  return v_row;
end $$;

create function public.add_group_purchase_item(p_purchase uuid, p jsonb) returns group_purchase_items
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_purchase_items;
begin
  perform public.open_purchase_group(p_purchase);
  if (select count(*) from group_purchase_items where purchase_id = p_purchase) >= 30 then
    raise exception 'group_purchase_items_full' using errcode = 'P0001';
  end if;
  insert into group_purchase_items (purchase_id, created_by, wine_name, producer, vintage, color, unit_price, bottles)
  values (
    p_purchase, v_me, btrim(p ->> 'wine_name'), nullif(btrim(p ->> 'producer'), ''), nullif(p ->> 'vintage', '')::integer,
    nullif(p ->> 'color', ''), (p ->> 'unit_price')::numeric, (p ->> 'bottles')::integer
  ) returning * into v_row;
  return v_row;
end $$;

-- Retirer un vin de l'achat : la personne qui l'a ajouté, celle qui a proposé l'achat, ou un administrateur / gestionnaire.
create function public.remove_group_purchase_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_item group_purchase_items;
  v_purchase group_purchases;
begin
  select * into v_item from group_purchase_items where id = p_item;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_purchase from group_purchases where id = v_item.purchase_id;
  perform public.open_purchase_group(v_purchase.id);
  if v_me is distinct from v_item.created_by and v_me is distinct from v_purchase.created_by
     and public.group_role(v_purchase.group_id) not in ('admin', 'manager') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  delete from group_purchase_items where id = p_item;
end $$;

-- Ma part d'un vin (0 : la retirer). Verrou sur la ligne du vin : deux personnes qui prennent les dernières bouteilles en
-- même temps passent l'une après l'autre, et la seconde est refusée si le total dépasserait le nombre prévu.
-- Changer sa part annule sa validation.
create function public.set_purchase_part(p_item uuid, p_bottles integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_item group_purchase_items;
  v_others integer;
begin
  select * into v_item from group_purchase_items where id = p_item for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.open_purchase_group(v_item.purchase_id);
  if p_bottles is null or p_bottles < 0 or p_bottles > 120 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  if p_bottles = 0 then
    delete from group_purchase_parts where item_id = p_item and user_id = v_me;
    return;
  end if;
  select coalesce(sum(bottles), 0) into v_others from group_purchase_parts where item_id = p_item and user_id <> v_me;
  if v_others + p_bottles > v_item.bottles then
    raise exception 'purchase_full' using errcode = 'P0001';
  end if;
  insert into group_purchase_parts (item_id, user_id, bottles) values (p_item, v_me, p_bottles)
  on conflict (item_id, user_id) do update set bottles = excluded.bottles, validated = false, updated_at = now();
end $$;

-- Je valide (ou non) toutes mes parts de cet achat.
create function public.validate_purchase_parts(p_purchase uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
begin
  perform public.open_purchase_group(p_purchase);
  update group_purchase_parts pp set validated = coalesce(p_on, false), updated_at = now()
  from group_purchase_items i
  where i.id = pp.item_id and i.purchase_id = p_purchase and pp.user_id = v_me;
end $$;

-- Clore, annuler ou rouvrir un achat : la personne qui l'a proposé, ou un administrateur / gestionnaire du groupe.
create function public.set_group_purchase_status(p_purchase uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row group_purchases;
begin
  select * into v_row from group_purchases where id = p_purchase;
  if not found or not public.is_group_member(v_row.group_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_me is distinct from v_row.created_by and public.group_role(v_row.group_id) not in ('admin', 'manager') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_status not in ('open', 'closed', 'cancelled') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  update group_purchases set status = p_status, closed_at = case when p_status = 'open' then null else now() end where id = p_purchase;
end $$;

-- Achats d'un groupe, avec leurs vins et les parts de chacun (prénom), pour ses membres.
create function public.group_purchases_list(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_group_member(p_group) or not public.mfa_ok() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'budget', g.budget, 'note', g.note, 'status', g.status, 'created_at', g.created_at,
      'created_by', g.created_by, 'author', (select display_name from profiles where id = g.created_by), 'mine', g.created_by = auth.uid(),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'wine_name', i.wine_name, 'producer', i.producer, 'vintage', i.vintage, 'color', i.color,
          'unit_price', i.unit_price, 'bottles', i.bottles, 'created_by', i.created_by,
          'parts', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', pp.user_id, 'name', pr.display_name, 'bottles', pp.bottles,
                                                'validated', pp.validated, 'mine', pp.user_id = auth.uid()) order by pp.updated_at)
            from group_purchase_parts pp join profiles pr on pr.id = pp.user_id where pp.item_id = i.id), '[]'::jsonb)
        ) order by i.created_at)
        from group_purchase_items i where i.purchase_id = g.id), '[]'::jsonb)
    ) order by (g.status = 'open') desc, g.created_at desc)
    from group_purchases g where g.group_id = p_group), '[]'::jsonb) end
$$;

-- Quitter le groupe (ou en être retiré) : mes parts des achats encore ouverts sont retirées.
create function public.group_members_after_delete_purchases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from group_purchase_parts pp using group_purchase_items i, group_purchases g
  where pp.item_id = i.id and i.purchase_id = g.id and g.group_id = old.group_id and g.status = 'open' and pp.user_id = old.user_id;
  return old;
end $$;
create trigger group_members_after_delete_purchases after delete on public.group_members
for each row execute function public.group_members_after_delete_purchases();

-- ───────────── 3. Export « mes données » ─────────────

-- La version précédente (20261101000001) est gardée sous un autre nom ; la nouvelle y ajoute les données de ce fichier.
alter function public.export_my_data() rename to export_my_data_v1;
revoke all on function public.export_my_data_v1() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return public.export_my_data_v1() || jsonb_build_object(
    'messages_de_soiree', coalesce((select jsonb_agg(jsonb_build_object(
                         'evenement', (select e.title from events e where e.id = m.event_id), 'message', m.body, 'le', m.created_at) order by m.created_at)
                       from event_messages m where m.user_id = me), '[]'::jsonb),
    'notes_de_soiree', coalesce((select jsonb_agg(jsonb_build_object(
                         'vin', w.wine_name, 'millesime', w.wine_vintage, 'note', v.rating, 'le', v.updated_at))
                       from event_votes v join event_wines w on w.id = v.event_wine_id where v.user_id = me), '[]'::jsonb),
    'achats_groupes_proposes', coalesce((select jsonb_agg((to_jsonb(g) - 'created_by') || jsonb_build_object(
                         'groupe', (select x.name from groups x where x.id = g.group_id)))
                       from group_purchases g where g.created_by = me), '[]'::jsonb),
    'parts_d_achats_groupes', coalesce((select jsonb_agg(jsonb_build_object(
                         'achat', g.title, 'vin', i.wine_name, 'millesime', i.vintage, 'prix_unitaire', i.unit_price,
                         'bouteilles', pp.bottles, 'validee', pp.validated, 'le', pp.updated_at))
                       from group_purchase_parts pp join group_purchase_items i on i.id = pp.item_id join group_purchases g on g.id = i.purchase_id
                       where pp.user_id = me), '[]'::jsonb)
  );
end $$;

-- ───────────── 4. Double authentification et droits ─────────────

-- Même règle que les autres tables (alignement sur Cocon, 20261102000001).
do $$
declare
  t text;
begin
  foreach t in array array['event_live', 'event_messages', 'event_votes', 'group_purchases', 'group_purchase_items', 'group_purchase_parts'] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))',
                   t || '_mfa_ok', t);
  end loop;
end $$;


revoke all on function
  public.event_live_wine_ok(uuid, uuid), public.open_purchase_group(uuid), public.group_members_after_delete_purchases()
from public, anon, authenticated;
revoke all on function
  public.start_event_live(uuid, boolean), public.event_live_serve(uuid, uuid), public.event_live_reveal(uuid, uuid),
  public.end_event_live(uuid), public.post_event_message(uuid, text), public.vote_event_wine(uuid, smallint),
  public.event_live_state(uuid), public.create_group_purchase(uuid, jsonb), public.add_group_purchase_item(uuid, jsonb),
  public.remove_group_purchase_item(uuid), public.set_purchase_part(uuid, integer), public.validate_purchase_parts(uuid, boolean),
  public.set_group_purchase_status(uuid, text), public.group_purchases_list(uuid), public.export_my_data()
from public, anon;
grant execute on function
  public.start_event_live(uuid, boolean), public.event_live_serve(uuid, uuid), public.event_live_reveal(uuid, uuid),
  public.end_event_live(uuid), public.post_event_message(uuid, text), public.vote_event_wine(uuid, smallint),
  public.event_live_state(uuid), public.create_group_purchase(uuid, jsonb), public.add_group_purchase_item(uuid, jsonb),
  public.remove_group_purchase_item(uuid), public.set_purchase_part(uuid, integer), public.validate_purchase_parts(uuid, boolean),
  public.set_group_purchase_status(uuid, text), public.group_purchases_list(uuid), public.export_my_data()
to authenticated;
grant execute on all functions in schema public to service_role;
