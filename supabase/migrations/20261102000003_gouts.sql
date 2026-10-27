-- Cave & Amis — lot 1 de « Cave & Amis 2.0 », mission C : mémoire des goûts.
--
-- Le profil de goûts a deux parties :
--  * ce que la personne DÉCLARE (cette table) : ce qu'elle aime, ce qu'elle aime moins, un budget habituel, une note ;
--    et les traits déduits de son carnet qu'elle demande d'ignorer ;
--  * ce qui est DÉDUIT de son carnet : calculé par l'application (src/domain/tasteProfile.ts), jamais stocké.
-- Lisible et modifiable par la personne seule (Lia le lit avec ses droits) ; « Effacer mon profil » supprime la ligne ;
-- supprimée avec le compte. Rien n'est partagé avec les amis, les groupes ou les événements.
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261102000002_lot0_correctifs.sql. Rejouable sans
-- danger. Ne modifie aucune donnée existante. Retour arrière : supabase/sql/retour-20261102000003.sql.

create table if not exists public.taste_profiles (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  likes text[] not null default '{}' check (cardinality(likes) <= 20 and coalesce(char_length(array_to_string(likes, '')), 0) <= 800),
  dislikes text[] not null default '{}' check (cardinality(dislikes) <= 20 and coalesce(char_length(array_to_string(dislikes, '')), 0) <= 800),
  ignored text[] not null default '{}' check (cardinality(ignored) <= 60 and coalesce(char_length(array_to_string(ignored, '')), 0) <= 3000),
  budget_max numeric(10, 2) check (budget_max is null or (budget_max > 0 and budget_max < 100000)),
  note text check (char_length(note) <= 500),
  updated_at timestamptz not null default now()
);

drop trigger if exists taste_profiles_touch on public.taste_profiles;
create trigger taste_profiles_touch before update on public.taste_profiles for each row execute function public.touch_updated_at();

alter table public.taste_profiles enable row level security;
revoke all on public.taste_profiles from anon, authenticated;
grant select, insert, delete on public.taste_profiles to authenticated;
grant update (likes, dislikes, ignored, budget_max, note) on public.taste_profiles to authenticated;

drop policy if exists taste_profiles_read on public.taste_profiles;
drop policy if exists taste_profiles_insert on public.taste_profiles;
drop policy if exists taste_profiles_update on public.taste_profiles;
drop policy if exists taste_profiles_delete on public.taste_profiles;
create policy taste_profiles_read on public.taste_profiles for select to authenticated using (user_id = auth.uid());
create policy taste_profiles_insert on public.taste_profiles for insert to authenticated with check (user_id = auth.uid());
create policy taste_profiles_update on public.taste_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy taste_profiles_delete on public.taste_profiles for delete to authenticated using (user_id = auth.uid());

-- Double authentification (alignement sur Cocon, 20261102000001) : même règle que les autres tables, si elle existe.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'mfa_ok' and pronamespace = 'public'::regnamespace) then
    execute 'drop policy if exists taste_profiles_mfa_ok on public.taste_profiles';
    execute 'create policy taste_profiles_mfa_ok on public.taste_profiles as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))';
  end if;
end $$;
