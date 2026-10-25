-- Cave & Amis — photo officielle de la bouteille (Open Food Facts) et code-barres.
--
-- * barcode : code-barres (EAN / GTIN, 8 à 14 chiffres) lu sur la contre-étiquette ou saisi ;
-- * bottle_photo_source : origine de la photo de la bouteille. « own » = photo de la personne, « off » = Open Food Facts
--   (licence CC BY-SA, réutilisable en citant la source), « studio » = photo de la personne améliorée, « web » = trouvée
--   en ligne (usage privé uniquement). Seules own, off et studio pourront servir hors de la cave (marketplace) ;
-- * bottle_photo_credit : mention à afficher avec la photo (auteur, licence, lien).
--
-- À exécuter une seule fois dans Supabase › SQL Editor, après 20261019000001_init.sql.

alter table public.wines
  add column barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  add column bottle_photo_source text check (bottle_photo_source in ('own', 'off', 'studio', 'web')),
  add column bottle_photo_credit text check (char_length(bottle_photo_credit) <= 300);

grant update (barcode, bottle_photo_source, bottle_photo_credit) on public.wines to authenticated;
