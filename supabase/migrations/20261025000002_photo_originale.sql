-- Cave & Amis — studio photo : la photo d'origine est conservée quand la photo de la bouteille est une version
-- améliorée (bottle_photo_source = 'studio'). Elle reste privée : seul le propriétaire la voit (dossier personnel).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261025000001_photo_officielle.sql.

alter table public.wines
  add column bottle_photo_original text check (bottle_photo_original is null or bottle_photo_original like owner_id::text || '/%');

grant update (bottle_photo_original) on public.wines to authenticated;
