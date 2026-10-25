-- Cave & Amis — retour arrière de 20261028000001_scanner_analyse.sql (seulement en cas de problème).
--
-- 1) Redéployer d'abord cave-api et le site depuis la version précédente (scanner sans verdict, lot 3a).
-- 2) Exécuter ce fichier dans Supabase › SQL Editor.
--
-- Les analyses gardent leur identification et leur prix du rayon ; seuls l'analyse du vin et le relevé des prix du
-- marché sont retirés. Les valeurs « scan_quality » et « scan_price » restent autorisées dans ai_usage.action :
-- les demandes déjà facturées gardent leur coût.

delete from public.scan_cache where kind in ('assess', 'price');
alter table public.scans drop column if exists assessment;
alter table public.scans drop column if exists assessed_at;
alter table public.scans drop column if exists market;
alter table public.scans drop column if exists market_checked_at;
alter table public.scans drop column if exists budget;
