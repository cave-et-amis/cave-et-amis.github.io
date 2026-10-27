-- Cave & Amis — lot 0 de « Cave & Amis 2.0 » : correctifs trouvés par l'audit du 27/10/2026.
--
--  1. Dégustations partagées avec un événement : les autres participants ne lisaient pas seulement la note, mais toute
--     la ligne, y compris le prix payé. La table ne se lit plus que par son auteur ; les notes d'un événement passent
--     par event_tastings(), qui donne aux participants les notes partagées sans le prix payé ni sa nature.
--  2. Relevés de prix : une personne associée à une cave pouvait supprimer l'historique de prix du propriétaire. Elle
--     peut toujours ajouter ou corriger un relevé manuel ; seul le propriétaire en supprime.
--  3. Nombre d'analyses du scanner par jour : contrôlé jusqu'ici avant l'appel, sans réservation (deux demandes
--     simultanées pouvaient le dépasser d'une). ai_begin le contrôle maintenant sous son verrou, comme les autres quotas.
--  4. Tarifs de l'IA : la lecture en cache de Claude Sonnet 5.5 coûte 0,20 $ par million de jetons (grille officielle),
--     pas 0,10 $. Corrigé seulement là où l'ancienne valeur est encore en place (un réglage de l'administration reste tel quel).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261101000005_double_authentification.sql. Rejouable sans
-- danger. Seule donnée modifiée : le tarif du point 4. Retour arrière : supabase/sql/retour-20261102000001.sql.

-- ───────────── 1. Dégustations partagées sans le prix payé ─────────────

drop policy if exists tastings_read on public.tastings;
create policy tastings_read on public.tastings for select to authenticated using (user_id = auth.uid());

-- Notes d'un événement : les miennes en entier ; celles que les autres ont partagées, sans le prix payé.
create or replace function public.event_tastings(p_event uuid) returns setof tastings
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := require_user();
  r tastings;
begin
  if not public.is_event_participant(p_event) then
    return;
  end if;
  for r in
    select * from tastings
    where event_id = p_event and (user_id = v_me or share_with_event)
    order by tasted_on desc, created_at desc
    limit 500
  loop
    if r.user_id <> v_me then
      r.price_paid := null;
      r.price_kind := null;
    end if;
    return next r;
  end loop;
end $$;
revoke all on function public.event_tastings(uuid) from public, anon;
grant execute on function public.event_tastings(uuid) to authenticated;

-- ───────────── 2. Historique des prix : suppression par le propriétaire seulement ─────────────

drop policy if exists market_prices_delete on public.market_prices;
create policy market_prices_delete on public.market_prices for delete to authenticated using (owner_id = auth.uid());

-- ───────────── 3. Analyses du scanner par jour, sous le verrou d'ai_begin ─────────────

-- Version de 20261028000001_scanner_analyse.sql, plus le contrôle du nombre d'analyses de bouteilles (« scan ») du jour.
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

-- ───────────── 4. Tarif de lecture en cache de Claude Sonnet 5.5 ─────────────

update public.ai_settings
set prices = jsonb_set(prices, '{claude-sonnet-5-5,cache_read}', '0.2'::jsonb)
where id = 1 and (prices -> 'claude-sonnet-5-5' ->> 'cache_read')::numeric = 0.1;

alter table public.ai_settings alter column prices set default '{
    "claude-opus-5-5": {"input": 4, "output": 20, "cache_write": 5, "cache_read": 0.2},
    "claude-sonnet-5-5": {"input": 2, "output": 10, "cache_write": 2.5, "cache_read": 0.2},
    "claude-haiku-5-5": {"input": 0.1, "output": 0.5, "cache_write": 0.125, "cache_read": 0.01},
    "claude-fable-5-1": {"input": 10, "output": 50, "cache_write": 12.5, "cache_read": 0.25}
  }'::jsonb;
