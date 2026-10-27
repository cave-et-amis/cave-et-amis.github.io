-- Cave & Amis — lot 1 de « Cave & Amis 2.0 », mission F : alertes de maturité, facultatives.
--
-- Une personne qui l'a demandé (Réglages : préférence « maturity_alerts ») reçoit une notification, et donc une
-- notification push si elle en a activé, quand un vin de sa cave avec au moins une bouteille libre :
--  * entre dans sa période de dégustation cette année (« maturity_ready », drink_from = année en cours) ;
--  * vit la dernière année de sa période (« maturity_last », drink_until = année en cours).
-- Seules les périodes NOTÉES sur la fiche comptent (la sienne, une source, ou une estimation de Lia) : le repère général
-- « ≈ » calculé par l'application n'en déclenche jamais. Une alerte par vin et par type au plus chaque année. Le nom du
-- vin est figé dans actor_name (40 caractères), le vin dans ref_id ; l'application affiche l'origine de la période.
--
-- maturity_alerts() est appelée chaque jour par pg_cron (supabase/sql/maturite-cron.sql, à activer à part) ; elle est
-- réservée au serveur et rejouable sans doublon.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000003_gouts.sql. Rejouable sans danger. Ne modifie
-- aucune donnée existante. Retour arrière : supabase/sql/retour-20261102000004.sql.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked', 'maturity_ready', 'maturity_last'));

create or replace function public.maturity_alerts() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_year integer := extract(year from public.today_paris())::integer;
  v_since timestamptz := make_timestamptz(v_year, 1, 1, 0, 0, 0, 'Europe/Paris');
  v_count integer := 0;
  r record;
begin
  for r in
    select w.owner_id as user_id, w.id as wine_id,
           left(btrim(w.name || coalesce(' ' || w.vintage::text, '')), 40) as label,
           case when w.drink_from = v_year then 'maturity_ready' else 'maturity_last' end as kind
    from wines w
    join profiles p on p.id = w.owner_id
    where p.preferences -> 'maturity_alerts' = 'true'::jsonb
      and (w.drink_from = v_year or w.drink_until = v_year)
      and (select coalesce(sum(l.quantity - l.reserved), 0) from lots l where l.wine_id = w.id and l.owner_id = w.owner_id) > 0
  loop
    if not exists (
      select 1 from notifications n
      where n.user_id = r.user_id and n.kind = r.kind and n.ref_id = r.wine_id and n.created_at >= v_since
    ) then
      insert into notifications (user_id, kind, actor_id, actor_name, ref_id) values (r.user_id, r.kind, null, r.label, r.wine_id);
      -- 200 notifications au plus par personne, comme notify().
      delete from notifications
      where user_id = r.user_id and id in (select id from notifications where user_id = r.user_id order by created_at desc offset 200);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.maturity_alerts() from public, anon, authenticated;
grant execute on function public.maturity_alerts() to service_role;
