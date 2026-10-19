/**
 * Photos : réduites sur l'appareil avant l'envoi (1 600 px au plus, JPEG), ce qui retire aussi les
 * métadonnées (position GPS…). Affichage par liens signés temporaires (le stockage est privé).
 */
import { useEffect, useState } from 'react';
import type { Api } from './api';

export const MAX_EDGE = 1600;

export async function resizeImage(file: Blob, maxEdge = MAX_EDGE, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('image_invalid');
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('image_invalid');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('image_invalid');
  return blob;
}

type Entry = { url: string; expires: number };
const cache = new Map<string, Entry>();
const waiting = new Map<string, Promise<void>>();

/** Liens signés (valables une heure) pour une liste de photos, mis en cache. */
export async function signedUrls(api: Api, paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const missing = [...new Set(paths.filter((p) => p && (cache.get(p)?.expires ?? 0) <= now + 60_000))].filter((p) => !waiting.has(p));
  if (missing.length) {
    const job = api
      .signedUrls(missing)
      .then((map) => {
        for (const [p, url] of map) cache.set(p, { url, expires: Date.now() + 3500_000 });
      })
      .catch(() => undefined)
      .finally(() => missing.forEach((p) => waiting.delete(p)));
    missing.forEach((p) => waiting.set(p, job));
  }
  await Promise.all(paths.map((p) => waiting.get(p)).filter(Boolean));
  const out = new Map<string, string>();
  for (const p of paths) {
    const e = cache.get(p);
    if (e) out.set(p, e.url);
  }
  return out;
}

export function usePhotoUrl(api: Api, path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? (cache.get(path)?.url ?? null) : null));
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void signedUrls(api, [path]).then((m) => alive && setUrl(m.get(path) ?? null));
    return () => {
      alive = false;
    };
  }, [api, path]);
  return url;
}
