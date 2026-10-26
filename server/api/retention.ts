/**
 * Durées de conservation (validées le 26/10/2026), appliquées par les tâches planifiées (supabase/sql/conservation.sql) :
 * chaque nuit, la purge de la base (retention_purge) puis les analyses du scanner arrivées à échéance, avec leurs photos ;
 * chaque mois, les photos de plus de 30 jours que plus rien ne cite. Les photos passent par le stockage (jamais par SQL,
 * qui laisserait les fichiers en place).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScanPhoto } from './scan.ts';
import { AiFailure, sanitize } from './util.ts';

const SCAN_BATCH = 200;
const REMOVE_BATCH = 100;

async function removePhotos(svc: SupabaseClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await svc.storage.from('photos').remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw new AiFailure('internal', sanitize(error.message));
  }
}

/** Analyses du scanner arrivées à échéance, de toutes les personnes (la purge au retour de la personne ne suffit pas). */
async function purgeExpiredScans(svc: SupabaseClient, now: Date) {
  let total = 0;
  for (let round = 0; round < 25; round++) {
    const { data, error } = await svc.from('scans').select('id, user_id, photos').lt('expires_at', now.toISOString()).limit(SCAN_BATCH);
    if (error) throw new AiFailure('internal', sanitize(error.message));
    const rows = (data ?? []) as { id: string; user_id: string; photos: ScanPhoto[] | null }[];
    if (!rows.length) break;
    // Seulement des fichiers du dossier de la personne (comme la purge à son retour).
    const paths = rows.flatMap((r) => (r.photos ?? []).map((p) => p.path).filter((p) => typeof p === 'string' && p.startsWith(`${r.user_id}/`)));
    // Les fichiers d'abord : en cas d'échec, l'analyse reste et la purge suivante réessaie.
    await removePhotos(svc, paths);
    const { error: delError } = await svc.from('scans').delete().in('id', rows.map((r) => r.id));
    if (delError) throw new AiFailure('internal', sanitize(delError.message));
    total += rows.length;
    if (rows.length < SCAN_BATCH) break;
  }
  return total;
}

/** Purge de chaque nuit. Renvoie le nombre de lignes effacées par catégorie (jamais leur contenu). */
export async function purgeRetention(svc: SupabaseClient, now: Date) {
  const scans = await purgeExpiredScans(svc, now);
  // Après les analyses : les visites devenues vides peuvent partir avec la purge de la base.
  const { data, error } = await svc.rpc('retention_purge');
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return { scans, ...((data ?? {}) as Record<string, number>) };
}

/** Purge mensuelle : photos de plus de 30 jours qu'aucune fiche, dégustation, groupe, vin d'événement ou analyse ne cite. */
export async function purgeOrphanPhotos(svc: SupabaseClient) {
  const { data, error } = await svc.rpc('retention_orphan_photos', { p_limit: 2000 });
  if (error) throw new AiFailure('internal', sanitize(error.message));
  // Une ligne par fichier : objet { name } ou simple texte selon le serveur.
  const names = ((data ?? []) as (string | { name?: string })[])
    .map((r) => (typeof r === 'string' ? r : r?.name))
    .filter((n): n is string => typeof n === 'string' && n.includes('/'));
  await removePhotos(svc, names);
  return { photos: names.length };
}
