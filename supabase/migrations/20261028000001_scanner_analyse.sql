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
