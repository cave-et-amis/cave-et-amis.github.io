-- Cave & Amis — retour arrière de 20261028000001_scanner_analyse.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api et le site depuis la version précédente (scanner sans verdict, lot 3a).
-- 2) Exécuter ce fichier dans Supabase › SQL Editor.
--
-- Les analyses gardent leur identification et leur prix du rayon ; seuls l'analyse du vin et le relevé des prix du
-- marché sont retirés. Les valeurs « scan_quality » et « scan_price » restent autorisées dans ai_usage.action :
-- les demandes déjà facturées gardent leur coût.

delete from public.scan_cache where kind in ('assess', 'price');
alter table public.scans drop column if exists assessment;
alter table public.scans drop column if exists assessed_at;
alter table public.scans drop column if exists market;
alter table public.scans drop column if exists market_checked_at;
alter table public.scans drop column if exists budget;

-- Fréquence par minute : version précédente (toutes les demandes comptent).
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
    select count(*) into v_count from ai_usage where user_id = p_user and created_at > now() - interval '1 minute';
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
