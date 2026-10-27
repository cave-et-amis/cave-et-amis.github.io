-- Cave & Amis — retour arrière de 20261102000001_lot0_correctifs.sql (seulement en cas de problème).
--
-- 1) Republier d'abord le site d'avant (il lit les notes d'un événement directement dans la table, pas par event_tastings).
-- 2) Puis exécuter CE fichier dans Supabase › SQL Editor : les règles d'avant reviennent (notes partagées lisibles en
--    entier par les participants, prix supprimables par une personne associée, nombre d'analyses du scanner contrôlé par
--    cave-api seulement).
--
-- Le tarif corrigé de Claude Sonnet 5.5 (lecture en cache à 0,20 $) reste en place : c'est le tarif officiel. Les analyses
-- effacées du cache commun ne reviennent pas (elles sont refaites à la demande).

drop policy if exists tastings_read on public.tastings;
create policy tastings_read on public.tastings for select to authenticated
  using (user_id = auth.uid() or (share_with_event and public.is_event_participant(event_id)));
drop function if exists public.event_tastings(uuid);

drop policy if exists market_prices_update on public.market_prices;
create policy market_prices_update on public.market_prices for update to authenticated
  using ((owner_id = auth.uid() or public.can_manage_wine(wine_id)) and method = 'manual')
  with check ((owner_id = auth.uid() or public.can_manage_wine(wine_id)) and method = 'manual' and check_id is null);
drop policy if exists market_prices_delete on public.market_prices;
create policy market_prices_delete on public.market_prices for delete to authenticated using (owner_id = auth.uid() or public.can_manage_wine(wine_id));

-- ai_begin : version de 20261028000001_scanner_analyse.sql.
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
