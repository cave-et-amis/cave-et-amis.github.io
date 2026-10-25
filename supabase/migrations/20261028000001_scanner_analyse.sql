-- Cave & Amis — « Scanner avant d'acheter », lot 3b : analyse qualitative sourcée, prix du marché, verdict d'achat.
--
-- * scans : deux résultats écrits par le serveur seulement (jamais par l'application) :
--   - assessment : analyse du vin par Lia (réputation, appellation, millésime, avis et notes avec leurs liens, profil,
--     garde, accords, niveau de qualité estimé). Chaque élément indique son origine (source citée ou estimation).
--   - market : offres comparables vérifiées (même vin, millésime et contenance, liens issus de la recherche), avec la
--     date du relevé. C'est un instantané : l'application propose de l'actualiser quand il date.
-- * ai_usage : actions « scan_quality » et « scan_price ». Le nombre d'analyses par jour (scan_daily_limit) reste compté
--   sur l'identification (« scan ») : il compte des bouteilles, pas des étapes.
--
-- Le verdict et la note sur 10 ne sont pas stockés : ils sont recalculés par l'application à partir de ces données,
-- selon la méthode documentée (src/domain/verdict.ts). Rejouable sans danger.

alter table public.scans add column if not exists assessment jsonb check (assessment is null or jsonb_typeof(assessment) = 'object');
alter table public.scans add column if not exists assessed_at timestamptz;
alter table public.scans add column if not exists market jsonb check (market is null or jsonb_typeof(market) = 'object');
alter table public.scans add column if not exists market_checked_at timestamptz;

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
  check (action in ('chat', 'label', 'price', 'scan', 'scan_quality', 'scan_price', 'admin_test'));

-- Lot 3c : budget de la personne pour cette bouteille (privé, comme l'analyse ; jamais dans le profil, que les contacts
-- peuvent lire). La comparaison avec les goûts est calculée par l'application à partir de ses propres données.
alter table public.scans add column if not exists budget numeric(10, 2) check (budget is null or (budget > 0 and budget < 100000));
grant update (budget) on public.scans to authenticated;

-- Fréquence par minute : mêmes règles qu'avant, sauf pour l'analyse et le prix d'une bouteille scannée (lancés
-- automatiquement, trois demandes par bouteille). Le nombre de demandes par jour et les budgets s'appliquent toujours.
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
