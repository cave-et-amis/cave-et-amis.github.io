-- Cave & Amis — « Scanner avant d'acheter », lot 3a : capture, identification, prix confirmé, historique.
--
-- * scans : une analyse en magasin (photos, lecture de Lia, champs vérifiés, prix du rayon confirmé). Privée : seule la
--   personne la voit. Le serveur y écrit la lecture de Lia (colonne result) ; la personne corrige et confirme le reste.
--   Une analyse ne touche JAMAIS au stock : ajouter à sa cave passe par le formulaire habituel, avec confirmation.
-- * scan_cache : réservé au serveur (aucun accès depuis l'application). Une même série de photos n'est pas renvoyée
--   à l'IA : la lecture est réutilisée. Les prix (lot 3b) y auront une durée de validité plus courte.
-- * ai_settings : modèle du scan (Sonnet 5.5 par défaut, moins coûteux), nombre d'analyses par jour, durée de
--   conservation des photos de scan (30 jours, puis suppression).
-- * ai_usage / ai_conversations : nouvelle action « scan », nouveau contexte « scan ».
--
-- Aucune table existante n'est modifiée dans ses données. Rejouable sans danger.

-- ───────────── Réglages ─────────────

alter table public.ai_settings add column if not exists scan_model text
  default 'claude-sonnet-5-5' check (scan_model is null or scan_model ~ '^[a-z0-9][a-z0-9.\-]{2,80}$');
alter table public.ai_settings add column if not exists scan_daily_limit integer not null default 10 check (scan_daily_limit between 0 and 1000);
alter table public.ai_settings add column if not exists scan_retention_days integer not null default 30 check (scan_retention_days between 1 and 365);

-- ───────────── Action « scan » et contexte « scan » ─────────────

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
  for r in
    select conname from pg_constraint
    where conrelid = 'public.ai_conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%context_kind%'
  loop
    execute format('alter table public.ai_conversations drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_action_check check (action in ('chat', 'label', 'price', 'scan', 'admin_test'));
alter table public.ai_conversations add constraint ai_conversations_context_kind_check check (context_kind in ('wine', 'event', 'group', 'scan'));

-- ───────────── Analyses ─────────────

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- identified : lu par Lia (ou saisi), à vérifier ; confirmed : vérifié par la personne.
  status text not null default 'identified' check (status in ('identified', 'confirmed')),
  -- [{ "path": "<user_id>/…", "role": "front" | "back" | "price" }] — dans le dossier privé de la personne.
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 3),
  barcode text check (barcode ~ '^\d{8,14}$'),
  -- Lecture de Lia, écrite par le serveur seulement (champs, incertitudes, candidats, étiquette de prix, défauts des photos).
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  -- Fiche vérifiée par la personne (mêmes champs que les fiches de vin, plus le degré).
  wine jsonb not null default '{}'::jsonb check (jsonb_typeof(wine) = 'object' and pg_column_size(wine) < 8000),
  store_price numeric(10, 2) check (store_price > 0 and store_price < 100000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  store_name text check (char_length(store_name) <= 80),
  -- Le prix du rayon n'est utilisé qu'une fois confirmé par la personne.
  price_confirmed boolean not null default false,
  from_cache boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (not price_confirmed or store_price is not null)
);
create index if not exists scans_user on public.scans (user_id, created_at desc);
create index if not exists scans_expires on public.scans (expires_at);

drop trigger if exists scans_touch on public.scans;
create trigger scans_touch before update on public.scans for each row execute function public.touch_updated_at();

-- Photos toujours dans le dossier de la personne ; durée de conservation fixée par les réglages, jamais par l'application.
create or replace function public.scans_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p jsonb;
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.created_at <> old.created_at) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for p in select * from jsonb_array_elements(new.photos) loop
    if jsonb_typeof(p) <> 'object' or coalesce(p ->> 'path', '') not like new.user_id::text || '/%' or (p ->> 'path') like '%..%'
       or coalesce(p ->> 'role', '') not in ('front', 'back', 'price') then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
  end loop;
  if tg_op = 'INSERT' then
    new.expires_at := new.created_at + make_interval(days => (select scan_retention_days from ai_settings where id = 1));
  end if;
  return new;
end $$;
drop trigger if exists scans_before on public.scans;
create trigger scans_before before insert or update on public.scans for each row execute function public.scans_before();

alter table public.scans enable row level security;
drop policy if exists scans_own on public.scans;
create policy scans_own on public.scans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- La personne peut créer une analyse saisie à la main (sans lecture de Lia), la vérifier, la supprimer.
-- « result » et « from_cache » ne sont écrits que par le serveur.
grant select, delete on public.scans to authenticated;
grant insert (photos, barcode, wine, store_price, currency, store_name, price_confirmed, status) on public.scans to authenticated;
grant update (status, barcode, wine, store_price, currency, store_name, price_confirmed) on public.scans to authenticated;

-- ───────────── Cache du serveur ─────────────

create table if not exists public.scan_cache (
  key text primary key check (char_length(key) <= 300),
  kind text not null check (kind in ('identify', 'assess', 'price')),
  value jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists scan_cache_expires on public.scan_cache (expires_at);
alter table public.scan_cache enable row level security;
revoke all on public.scan_cache from anon, authenticated;

-- ───────────── Quota et état ─────────────

-- Analyses facturées aujourd'hui (les lectures reprises du cache ne comptent pas).
create or replace function public.scan_quota(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', (select count(*) from ai_usage where user_id = p_user and action = 'scan'
             and (created_at at time zone 'Europe/Paris')::date = today_paris()),
    'limit', (select scan_daily_limit from ai_settings where id = 1)
  )
$$;
revoke all on function public.scan_quota(uuid) from public, anon, authenticated;

create or replace function public.my_scan_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.scan_quota(require_user()) || jsonb_build_object('retention_days', (select scan_retention_days from ai_settings where id = 1))
$$;
grant execute on function public.my_scan_status() to authenticated;

-- Réglages de l'administration : mêmes champs qu'avant, plus ceux du scan.
create or replace function public.admin_update_ai_settings(p jsonb) returns ai_settings
language plpgsql security definer set search_path = public as $$
declare
  v ai_settings;
begin
  perform require_admin();
  update ai_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    model = coalesce(nullif(btrim(p ->> 'model'), ''), model),
    effort = coalesce(p ->> 'effort', effort),
    max_output_tokens = coalesce((p ->> 'max_output_tokens')::integer, max_output_tokens),
    max_input_chars = coalesce((p ->> 'max_input_chars')::integer, max_input_chars),
    max_image_bytes = coalesce((p ->> 'max_image_bytes')::integer, max_image_bytes),
    max_api_calls = coalesce((p ->> 'max_api_calls')::integer, max_api_calls),
    history_messages = coalesce((p ->> 'history_messages')::integer, history_messages),
    web_search_enabled = coalesce((p ->> 'web_search_enabled')::boolean, web_search_enabled),
    max_web_searches = coalesce((p ->> 'max_web_searches')::integer, max_web_searches),
    web_search_token_allowance = coalesce((p ->> 'web_search_token_allowance')::integer, web_search_token_allowance),
    web_search_price_per_1000 = coalesce((p ->> 'web_search_price_per_1000')::numeric, web_search_price_per_1000),
    monthly_budget_usd = coalesce((p ->> 'monthly_budget_usd')::numeric, monthly_budget_usd),
    alert_pct = coalesce((p ->> 'alert_pct')::integer, alert_pct),
    default_daily_requests = coalesce((p ->> 'default_daily_requests')::integer, default_daily_requests),
    default_monthly_user_usd = coalesce((p ->> 'default_monthly_user_usd')::numeric, default_monthly_user_usd),
    rate_per_minute = coalesce((p ->> 'rate_per_minute')::integer, rate_per_minute),
    max_concurrent_per_user = coalesce((p ->> 'max_concurrent_per_user')::integer, max_concurrent_per_user),
    prices = case when jsonb_typeof(p -> 'prices') = 'object' then p -> 'prices' else prices end,
    -- Modèle du scan : chaîne vide = même modèle que l'assistant.
    scan_model = case when p ? 'scan_model' then nullif(btrim(p ->> 'scan_model'), '') else scan_model end,
    scan_daily_limit = coalesce((p ->> 'scan_daily_limit')::integer, scan_daily_limit),
    scan_retention_days = coalesce((p ->> 'scan_retention_days')::integer, scan_retention_days),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into v;
  return v;
end $$;

grant all on public.scans, public.scan_cache to service_role;
grant execute on function public.scan_quota(uuid), public.my_scan_status(), public.scans_before() to service_role;
