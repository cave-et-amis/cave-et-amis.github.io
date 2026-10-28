-- Cave & Amis — retour arrière de 20261102000008_alerte_prix.sql (seulement en cas de problème).
--
-- 1) Désactiver d'abord la tâche du vendredi : select cron.unschedule('cave-alerte-prix');
-- 2) Republier le site d'avant, puis exécuter CE fichier dans Supabase › SQL Editor. ATTENTION : le vin suivi de chacun
--    est oublié, et les notifications « price_drop » déjà reçues sont supprimées (l'ancienne règle ne les connaît pas).
--    La consommation des alertes reste comptée dans le journal de l'assistant (rangée sous « price »).

drop function if exists public.export_my_data();
alter function public.export_my_data_v2() rename to export_my_data;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.export_my_data() to service_role;

-- Réservation : la version d'avant (20261102000002).
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
  insert into ai_usage (user_id, action, model, reserved_usd) values (p_user, p_action, p_model, p_amount) returning id into v_id;
  return jsonb_build_object('ok', true, 'usage_id', v_id);
end $$;


-- Réservations suivantes : la version d'origine (20261019000001).
create or replace function public.ai_reserve_more(p_usage uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ai_settings;
  u ai_usage;
  v_lim record;
  v_user_month numeric;
  v_month numeric;
begin
  select * into s from ai_settings where id = 1 for update;
  select * into u from ai_usage where id = p_usage for update;
  if not found or u.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'invalid_usage');
  end if;
  if u.action <> 'admin_test' then
    select * into v_lim from ai_effective_limits(u.user_id);
    select coalesce(sum(cost_usd + reserved_usd), 0) into v_user_month from ai_usage
    where user_id = u.user_id and created_at >= month_start_paris();
    if v_user_month + p_amount > v_lim.monthly then
      return jsonb_build_object('ok', false, 'code', 'quota_monthly');
    end if;
  end if;
  select coalesce(sum(cost_usd + reserved_usd), 0) into v_month from ai_usage where created_at >= month_start_paris();
  if v_month + p_amount > s.monthly_budget_usd then
    return jsonb_build_object('ok', false, 'code', 'budget_exhausted');
  end if;
  update ai_usage set reserved_usd = reserved_usd + p_amount where id = p_usage;
  return jsonb_build_object('ok', true);
end $$;

update public.ai_usage set action = 'price' where action = 'price_alert';
alter table public.ai_usage drop constraint if exists ai_usage_action_check;
alter table public.ai_usage add constraint ai_usage_action_check
  check (action in ('chat', 'label', 'price', 'scan', 'scan_quality', 'scan_price', 'admin_test'));
alter table public.ai_settings drop column if exists price_alert_budget_usd;

delete from public.notifications where kind = 'price_drop';
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'event_invite', 'group_invite', 'group_joined', 'cellar_invite', 'cellar_joined',
                  'invite_joined', 'cellar_opened', 'cellar_access_request', 'nous_linked', 'maturity_ready', 'maturity_last', 'maturity_many'));

drop function if exists public.record_price_watch(uuid, uuid, text, numeric, text);
drop function if exists public.price_watches_due(integer);
drop function if exists public.set_price_watch(uuid, integer);
drop table if exists public.price_watches;
