-- Cave & Amis — « Scanner avant d'acheter », lot 3d : comparer plusieurs bouteilles d'un même magasin.
--
-- * scan_visits : une visite en magasin (nom du magasin, budget, occasion), privée comme les analyses.
-- * scans.visit_id : l'analyse appartient à une visite de la même personne (contrôlé par la base).
-- La comparaison et le classement sont calculés par l'application ; Lia lit la visite avec les droits de la personne.
-- Rejouable sans danger.

create table if not exists public.scan_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  store_name text check (char_length(store_name) <= 80),
  budget numeric(10, 2) check (budget is null or (budget > 0 and budget < 100000)),
  occasion text check (char_length(occasion) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scan_visits_user on public.scan_visits (user_id, created_at desc);
drop trigger if exists scan_visits_touch on public.scan_visits;
create trigger scan_visits_touch before update on public.scan_visits for each row execute function public.touch_updated_at();

alter table public.scan_visits enable row level security;
drop policy if exists scan_visits_own on public.scan_visits;
create policy scan_visits_own on public.scan_visits for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, delete on public.scan_visits to authenticated;
grant insert (store_name, budget, occasion), update (store_name, budget, occasion) on public.scan_visits to authenticated;
grant all on public.scan_visits to service_role;

alter table public.scans add column if not exists visit_id uuid references public.scan_visits (id) on delete set null;
create index if not exists scans_visit on public.scans (visit_id);
grant insert (visit_id), update (visit_id) on public.scans to authenticated;

-- Mêmes règles qu'avant, plus : la visite appartient à la même personne.
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
  if new.visit_id is not null and not exists (select 1 from scan_visits v where v.id = new.visit_id and v.user_id = new.user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.expires_at := new.created_at + make_interval(days => (select scan_retention_days from ai_settings where id = 1));
  end if;
  return new;
end $$;
