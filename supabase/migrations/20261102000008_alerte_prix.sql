-- Cave & Amis 2.0 — « M'alerter si le prix baisse » (maquette, panneau 9). Décision de l'utilisateur du 28/10/2026 :
-- une vérification par semaine au plus, le vendredi soir ; UN vin suivi par personne ; 2 $ par mois au plus pour toutes
-- les alertes, pris DANS le budget mensuel de l'assistant (aucun budget en plus).
--
--  1. price_watches : le vin suivi (un par personne, clé = la personne), avec le prix de référence (le plus bas déjà vu).
--  2. ai_settings.price_alert_budget_usd (2 $ par défaut) : vérifié par ai_begin, sous son verrou, avec le budget global
--     et la limite de la personne. Budget atteint : la vérification n'est pas lancée (rien n'est dépensé), la personne
--     le voit sur la fiche.
--  3. Le vendredi soir, la tâche planifiée (supabase/sql/alerte-prix-cron.sql, à activer à part) appelle cave-api
--     (action price_alerts_run) : recherche du prix comme « Rechercher le prix actuel », puis notification « price_drop »
--     si le prix vérifié passe sous la référence, qui devient alors ce nouveau prix (pas de nouvelle alerte au même prix).
--  4. Export « mes données » : le vin suivi s'y ajoute.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000007_soiree_achats.sql. Ne modifie aucune donnée
-- existante. À déployer AVANT le nouveau site. Retour arrière : supabase/sql/retour-20261102000008.sql.

-- ───────────── 1. Vin suivi ─────────────

create table public.price_watches (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  wine_id uuid not null references public.wines (id) on delete cascade,
  volume_ml integer not null default 750 check (volume_ml between 50 and 30000),
  reference_price numeric(10, 2) check (reference_price > 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_status text check (last_status in ('lower', 'not_lower', 'unverified', 'budget', 'failed')),
  last_low numeric(10, 2)
);
create index price_watches_due on public.price_watches (last_checked_at nulls first);

alter table public.price_watches enable row level security;
create policy price_watches_read on public.price_watches for select to authenticated using (user_id = auth.uid());
create policy price_watches_mfa_ok on public.price_watches as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
grant select on public.price_watches to authenticated;

-- Suivre ce vin (remplace le précédent : un seul à la fois), ou ne plus rien suivre (p_wine null). Référence : le plus bas
-- du dernier relevé de ce vin dans cette contenance, s'il y en a un ; sinon la première vérification la fixe.
create function public.set_price_watch(p_wine uuid, p_volume integer) returns price_watches
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  v_row price_watches;
  v_ref market_prices;
begin
  if p_wine is null then
    delete from price_watches where user_id = v_me;
    return null;
  end if;
  if not exists (select 1 from wines where id = p_wine and owner_id = v_me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_ref from market_prices
  where wine_id = p_wine and owner_id = v_me and volume_ml = coalesce(p_volume, 750)
  order by checked_at desc limit 1;
  insert into price_watches (user_id, wine_id, volume_ml, reference_price, currency)
  values (v_me, p_wine, coalesce(p_volume, 750), v_ref.price_low, v_ref.currency)
  on conflict (user_id) do update
    set wine_id = excluded.wine_id, volume_ml = excluded.volume_ml, reference_price = excluded.reference_price,
        currency = excluded.currency, created_at = now(), last_checked_at = null, last_status = null, last_low = null
  returning * into v_row;
  return v_row;
end $$;

-- Serveur seulement : vins à vérifier (jamais vérifiés, ou il y a plus de 6 jours), les plus anciens d'abord.
create function public.price_watches_due(p_limit integer) returns setof price_watches
language sql stable security definer set search_path = public as $$
  select * from price_watches
  where last_checked_at is null or last_checked_at < now() - interval '6 days'
  order by last_checked_at nulls first, created_at
  limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- Serveur seulement : résultat d'une vérification. Prix vérifié plus bas que la référence : notification, et la
-- référence descend à ce prix. Première vérification sans référence : elle devient la référence, sans alerte.
create function public.record_price_watch(p_user uuid, p_status text, p_low numeric, p_currency text) returns text
language plpgsql security definer set search_path = public as $$
declare
  w price_watches;
  v_status text := p_status;
  v_name text;
begin
  select * into w from price_watches where user_id = p_user for update;
  if not found then
    return null;
  end if;
  if p_status = 'verified' then
    if w.reference_price is not null and (w.currency is null or w.currency = p_currency) and p_low < w.reference_price then
      v_status := 'lower';
      select concat_ws(' ', name, vintage::text) into v_name from wines where id = w.wine_id;
      insert into notifications (user_id, kind, actor_name, ref_id) values (p_user, 'price_drop', left(v_name, 40), w.wine_id);
    else
      v_status := 'not_lower';
    end if;
    -- Seulement dans la même devise : un prix en francs suisses ne remplace pas une référence en euros.
    update price_watches set reference_price = least(coalesce(reference_price, p_low), p_low), currency = coalesce(currency, p_currency)
    where user_id = p_user and (currency is null or currency = p_currency);
  end if;
  update price_watches
  set last_checked_at = now(), last_status = v_status, last_low = case when p_status = 'verified' then p_low else last_low end
  where user_id = p_user;
  return v_status;
end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked', 'maturity_ready', 'maturity_last', 'maturity_many',
                  'price_drop'));

-- ───────────── 2. Plafond mensuel des alertes ─────────────

alter table public.ai_settings add column price_alert_budget_usd numeric(10, 2) not null default 2
  check (price_alert_budget_usd >= 0 and price_alert_budget_usd <= 1000);

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.ai_usage'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%action%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_action_check
  check (action in ('chat', 'label', 'price', 'scan', 'scan_quality', 'scan_price', 'price_alert', 'admin_test'));

-- Réservation : version précédente (20261102000002), avec le plafond des alertes en plus.
create or replace function public.ai_begin(p_user uuid, p_action text, p_model text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ai_settings;
  v_lim record;
  v_count integer;
  v_user_month numeric;
  v_month numeric;
  v_id uuid;
begin
  select * into s from ai_settings where id = 1 for update;
  perform ai_close_stale();
  if not s.enabled and p_action <> 'admin_test' then
    return jsonb_build_object('ok', false, 'code', 'ai_disabled');
  end if;
  select * into v_lim from ai_effective_limits(p_user);
  if p_action <> 'admin_test' then
    if v_lim.blocked then
      return jsonb_build_object('ok', false, 'code', 'user_blocked');
    end if;
    -- L'analyse et le prix d'une bouteille scannée partent automatiquement après sa confirmation, et le nombre de
    -- bouteilles par jour les borne déjà : ils ne comptent pas dans la fréquence par minute.
    select count(*) into v_count from ai_usage where user_id = p_user and created_at > now() - interval '1 minute'
      and action not in ('scan_quality', 'scan_price');
    if v_count >= s.rate_per_minute then
      return jsonb_build_object('ok', false, 'code', 'rate_limited');
    end if;
    select count(*) into v_count from ai_usage where user_id = p_user and status = 'reserved';
    if v_count >= s.max_concurrent_per_user then
      return jsonb_build_object('ok', false, 'code', 'too_many_concurrent');
    end if;
    select count(*) into v_count from ai_usage
    where user_id = p_user and action <> 'admin_test' and (created_at at time zone 'Europe/Paris')::date = today_paris();
    if v_count >= v_lim.daily then
      return jsonb_build_object('ok', false, 'code', 'quota_daily');
    end if;
    -- Nombre de bouteilles analysées aujourd'hui (même compte que scan_quota) : vérifié ici, sous le verrou, pour que
    -- deux demandes simultanées ne le dépassent pas.
    if p_action = 'scan' then
      select count(*) into v_count from ai_usage
      where user_id = p_user and action = 'scan' and (created_at at time zone 'Europe/Paris')::date = today_paris();
      if v_count >= s.scan_daily_limit then
        return jsonb_build_object('ok', false, 'code', 'scan_quota');
      end if;
    end if;
    select coalesce(sum(cost_usd + reserved_usd), 0) into v_user_month from ai_usage
    where user_id = p_user and created_at >= month_start_paris();
    if v_user_month + p_amount > v_lim.monthly then
      return jsonb_build_object('ok', false, 'code', 'quota_monthly');
    end if;
  end if;
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage where created_at >= month_start_paris();
  if v_month + p_amount > s.monthly_budget_usd then
    return jsonb_build_object('ok', false, 'code', 'budget_exhausted');
  end if;
  -- Alertes de baisse de prix : plafond mensuel à part, DANS le budget global (vérifié juste au-dessus).
  if p_action = 'price_alert' then
    select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage
    where action = 'price_alert' and created_at >= month_start_paris();
    if v_month + p_amount > s.price_alert_budget_usd then
      return jsonb_build_object('ok', false, 'code', 'price_alert_budget');
    end if;
  end if;
  insert into ai_usage (user_id, action, model, reserved_usd) values (p_user, p_action, p_model, p_amount) returning id into v_id;
  return jsonb_build_object('ok', true, 'usage_id', v_id);
end $$;


-- ───────────── 3. Export « mes données » ─────────────

alter function public.export_my_data() rename to export_my_data_v2;
revoke all on function public.export_my_data_v2() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
begin
  return public.export_my_data_v2() || jsonb_build_object(
    'alerte_de_prix', (select (to_jsonb(w) - 'user_id') || jsonb_build_object('vin', (select concat_ws(' ', x.name, x.vintage::text) from wines x where x.id = w.wine_id))
                       from price_watches w where w.user_id = me));
end $$;

-- ───────────── 4. Droits ─────────────

revoke all on function public.set_price_watch(uuid, integer), public.export_my_data() from public, anon;
grant execute on function public.set_price_watch(uuid, integer), public.export_my_data() to authenticated;
revoke all on function public.price_watches_due(integer), public.record_price_watch(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
