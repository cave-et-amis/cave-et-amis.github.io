-- Cave & Amis — retour arrière de 20261029000001_scanner_visites.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api et le site depuis la version précédente (scanner sans comparateur).
-- 2) Exécuter ce fichier dans Supabase › SQL Editor. Les analyses sont gardées ; seules les visites disparaissent,
--    et le contrôle des analyses revient à sa version précédente.

alter table public.scans drop column if exists visit_id;
drop table if exists public.scan_visits;

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
