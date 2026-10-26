/**
 * « Télécharger toutes mes données » (droit d'accès et portabilité) : le JSON complet préparé par la base
 * (export_my_data) et les photos de mon dossier, réunis dans une archive ZIP calculée sur l'appareil.
 */
import type { Api } from '../../data/api';
import { makeZip, type ZipEntry } from '../../domain/zip';

function readme(missing: string[]) {
  return [
    'Cave & Amis : vos données',
    '',
    'donnees.json : tout ce que la base garde sur vous, au format JSON (lisible par un tableur, un éditeur de texte ou un autre logiciel).',
    'Principales rubriques : compte et profil, caves, vins, lots, mouvements, prix, dégustations, envies, contacts et accès,',
    'invitations, notifications, groupes, événements, conversations avec Lia, scanner, appareils de notification,',
    'agenda Nous, documents acceptés et consentements.',
    'Pour les autres personnes, seul ce que l’application vous montre déjà figure (prénom, rôle, réponse).',
    '',
    'photos/ : vos photos. Dans donnees.json, une photo est notée « identifiant/fichier » ; le fichier porte le même nom ici.',
    ...(missing.length ? ['', 'Photos qui n’ont pas pu être téléchargées (réessayez plus tard) :', ...missing.map((m) => `- ${m}`)] : []),
    '',
  ].join('\r\n');
}

export async function buildExport(api: Api, onProgress?: (done: number, total: number) => void) {
  const data = await api.exportMyData();
  const photos = Array.isArray(data.photos) ? data.photos.filter((p): p is string => typeof p === 'string') : [];
  const enc = new TextEncoder();
  const files: ZipEntry[] = [];
  const missing: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    try {
      const blob = await api.photoBlob(photos[i]);
      files.push({ name: `photos/${photos[i].split('/').pop()}`, data: new Uint8Array(await blob.arrayBuffer()) });
    } catch {
      missing.push(photos[i]);
    }
    onProgress?.(i + 1, photos.length);
  }
  const zip = makeZip([
    { name: 'LISEZMOI.txt', data: enc.encode(readme(missing)) },
    { name: 'donnees.json', data: enc.encode(JSON.stringify(data, null, 2)) },
    ...files,
  ]);
  return { blob: new Blob([zip], { type: 'application/zip' }), photos: files.length, missing: missing.length };
}

export function exportFileName(now = new Date()) {
  return `cave-et-amis-mes-donnees-${now.toISOString().slice(0, 10)}.zip`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
