-- Cave & Amis — lot 1 de « Cave & Amis 2.0 », mission F : alertes de maturité, facultatives.
--
-- Une personne qui l'a demandé (Réglages : préférence « maturity_alerts ») reçoit une notification, et donc une
-- notification push si elle en a activé, quand un vin de sa cave avec au moins une bouteille libre :
--  * entre dans sa période de dégustation cette année (« maturity_ready », drink_from = année en cours) ;
--  * vit la dernière année de sa période (« maturity_last », drink_until = année en cours).
-- Seules les périodes NOTÉES sur la fiche comptent (la sienne, une source, ou une estimation de Lia) : le repère général
-- « ≈ » n'en déclenche jamais. Une alerte par vin et par type au plus chaque année (table maturity_alerts_sent, même si
-- la notification a été effacée) ; au-delà de 3 le même jour, une seule notification les résume (« maturity_many »).
-- Le nom du vin est figé dans actor_name (40 caractères), le vin dans ref_id ; l'application affiche l'origine de la période.
--
-- maturity_alerts() est appelée chaque jour par pg_cron (supabase/sql/maturite-cron.sql, à activer à part) ; elle est
-- réservée au serveur et rejouable sans doublon.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000003_gouts.sql. Rejouable sans danger. Ne modifie
-- aucune donnée existante. Retour arrière : supabase/sql/retour-20261102000004.sql.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked', 'maturity_ready', 'maturity_last', 'maturity_many'));

-- Alertes déjà envoyées, par vin, type et année : indépendant des notifications, que la personne peut effacer et qui
-- sont limitées à 200. Lisible par le serveur seul ; supprimé avec le compte.
create table if not exists public.maturity_alerts_sent (
  user_id uuid not null references public.profiles (id) on delete cascade,
  wine_id uuid not null references public.wines (id) on delete cascade,
  kind text not null check (kind in ('maturity_ready', 'maturity_last')),
  year integer not null check (year between 2000 and 2200),
  sent_at timestamptz not null default now(),
  primary key (user_id, wine_id, kind, year)
);
alter table public.maturity_alerts_sent enable row level security;
revoke all on public.maturity_alerts_sent from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'mfa_ok' and pronamespace = 'public'::regnamespace) then
    execute 'drop policy if exists maturity_alerts_sent_mfa_ok on public.maturity_alerts_sent';
    execute 'create policy maturity_alerts_sent_mfa_ok on public.maturity_alerts_sent as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))';
  end if;
end $$;

-- Une alerte par vin, par type et par an. Au-delà de 3 nouvelles alertes pour une personne le même jour (première
-- activation, grande cave), une seule notification les résume (« maturity_many », actor_name = leur nombre).
create or replace function public.maturity_alerts() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_year integer := extract(year from public.today_paris())::integer;
  v_count integer := 0;
  u record;
  r record;
  v_new integer;
begin
  for u in
    select p.id from profiles p where p.preferences -> 'maturity_alerts' = 'true'::jsonb
  loop
    create temporary table if not exists _maturity_new (wine_id uuid, kind text, label text) on commit drop;
    truncate _maturity_new;
    with candidates as (
      select w.id as wine_id,
             case when w.drink_from = v_year then 'maturity_ready' else 'maturity_last' end as kind,
             left(btrim(w.name || coalesce(' ' || w.vintage::text, '')), 40) as label
      from wines w
      where w.owner_id = u.id
        -- Seules les périodes notées sur la fiche : jamais le repère général.
        and coalesce(w.window_source, 'personal') <> 'general'
        and (w.drink_from = v_year or w.drink_until = v_year)
        and (select coalesce(sum(l.quantity - l.reserved), 0) from lots l where l.wine_id = w.id and l.owner_id = w.owner_id) > 0
    ), sent as (
      insert into maturity_alerts_sent (user_id, wine_id, kind, year)
      select u.id, c.wine_id, c.kind, v_year from candidates c
      on conflict do nothing
      returning wine_id, kind
    )
    insert into _maturity_new select s.wine_id, s.kind, c.label from sent s join candidates c using (wine_id, kind);
    select count(*) into v_new from _maturity_new;
    continue when v_new = 0;
    if v_new <= 3 then
      for r in select * from _maturity_new loop
        insert into notifications (user_id, kind, actor_id, actor_name, ref_id) values (u.id, r.kind, null, r.label, r.wine_id);
      end loop;
    else
      insert into notifications (user_id, kind, actor_id, actor_name, ref_id) values (u.id, 'maturity_many', null, v_new::text, null);
    end if;
    -- 200 notifications au plus par personne, comme notify().
    delete from notifications
    where user_id = u.id and id in (select id from notifications where user_id = u.id order by created_at desc offset 200);
    v_count := v_count + v_new;
  end loop;
  return v_count;
end $$;

revoke all on function public.maturity_alerts() from public, anon, authenticated;
grant execute on function public.maturity_alerts() to service_role;
