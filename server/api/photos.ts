/**
 * Photo officielle d'une bouteille, depuis Open Food Facts (base ouverte, photos sous licence CC BY-SA 3.0).
 *  - Recherche : par code-barres (produit exact), sinon par nom (propositions à confirmer par la personne).
 *  - Import : le serveur relit le produit d'après son code (jamais une adresse fournie par le navigateur), télécharge
 *    la photo et la range dans le dossier privé de la personne, avec la mention de source à afficher.
 * Aucun appel à Claude : rien n'est facturé.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBarcode } from '../../src/domain/barcode.ts';
import { fold } from '../../src/domain/wine.ts';
import { mediaType } from './label.ts';
import { AiFailure, readCapped, sanitize } from './util.ts';

const OFF = 'https://world.openfoodfacts.org';
const SEARCH = 'https://search.openfoodfacts.org/search';
const IMAGES = 'images.openfoodfacts.org';
const USER_AGENT = 'CaveEtAmis/1.0 (+https://cave-et-amis.github.io)';
const MAX_BYTES = 4_500_000;

export type PhotoCandidate = {
  code: string;
  name: string;
  brand: string | null;
  thumb: string;
  /** Même code-barres que la bouteille : produit exact. */
  exact: boolean;
  url: string;
};

type OffProduct = { code?: string; product_name?: string; brands?: string | string[]; image_front_url?: string; image_front_small_url?: string; categories_tags?: string[] };

const brandOf = (b: OffProduct['brands']) => (Array.isArray(b) ? b.join(', ') : b) || null;
const offImage = (u: unknown): string | null => {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname === IMAGES ? url.href : null;
  } catch {
    return null;
  }
};

async function getJson(fetchImpl: typeof fetch, url: string) {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new AiFailure('photo_service_unavailable');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new AiFailure('photo_service_unavailable', `Open Food Facts ${res.status}`);
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

function candidate(p: OffProduct, exact: boolean): PhotoCandidate | null {
  const code = normalizeBarcode(p.code) ?? (typeof p.code === 'string' && /^\d{8,14}$/.test(p.code) ? p.code : null);
  const thumb = offImage(p.image_front_small_url) ?? offImage(p.image_front_url);
  if (!code || !thumb) return null;
  const brand = brandOf(p.brands);
  return { code, name: sanitize(p.product_name || brand || 'Vin sans nom', 120), brand: brand ? sanitize(brand, 80) : null, thumb, exact, url: `${OFF}/product/${code}` };
}

/** Produit par code-barres (boissons alcoolisées seulement), ou null. */
export async function offProduct(fetchImpl: typeof fetch, code: string): Promise<OffProduct | null> {
  const data = await getJson(fetchImpl, `${OFF}/api/v2/product/${code}?fields=code,product_name,brands,image_front_url,image_front_small_url,categories_tags`);
  const p = data?.status === 1 ? (data.product as OffProduct) : null;
  if (!p || !(p.categories_tags ?? []).some((c) => c === 'en:wines' || c === 'en:alcoholic-beverages')) return null;
  return { ...p, code };
}

/** Propositions : le produit exact si le code-barres est connu, puis une recherche par nom classée par ressemblance. */
export async function searchPhotos(
  fetchImpl: typeof fetch,
  q: { barcode?: unknown; name?: unknown; vintage?: unknown; appellation?: unknown; producer?: unknown },
): Promise<PhotoCandidate[]> {
  const out: PhotoCandidate[] = [];
  const barcode = normalizeBarcode(q.barcode);
  if (barcode) {
    const p = await offProduct(fetchImpl, barcode);
    const c = p && candidate(p, true);
    if (c) out.push(c);
  }
  const name = typeof q.name === 'string' ? q.name.trim().slice(0, 120) : '';
  if (!name) return out;
  const extra = [q.producer, q.appellation].filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map((v) => v.trim().slice(0, 80));
  const terms = [name, ...extra].join(' ').replace(/["\\:]/g, ' ');
  const params = new URLSearchParams({
    q: `${terms} categories_tags:"en:wines"`,
    page_size: '15',
    fields: 'code,product_name,brands,image_front_url,image_front_small_url',
  });
  const data = await getJson(fetchImpl, `${SEARCH}?${params}`);
  const words = fold(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !['chateau', 'domaine', 'clos', 'les', 'des', 'cuvee', 'vin'].includes(w));
  const vintage = Number.isInteger(q.vintage) ? String(q.vintage) : null;
  const scored = ((data?.hits as OffProduct[] | undefined) ?? [])
    .map((p) => {
      const text = fold(`${p.product_name ?? ''} ${brandOf(p.brands) ?? ''}`);
      const hits = words.filter((w) => text.includes(w)).length;
      const score = (words.length ? hits / words.length : 0) * 10 + (vintage && text.includes(vintage) ? 2 : 0);
      return { p, score, hits };
    })
    // Au moins la moitié des mots du nom (hors « château », « domaine »…) doivent se retrouver dans la proposition.
    .filter((s) => s.hits > 0 && s.hits * 2 >= words.length)
    .sort((a, b) => b.score - a.score);
  for (const { p } of scored) {
    const c = candidate(p, false);
    if (c && !out.some((o) => o.code === c.code)) out.push(c);
    if (out.length >= 5) break;
  }
  return out;
}

/** Copie la photo du produit dans le dossier privé de la personne ; renvoie son chemin et la mention de source. */
export async function importPhoto(fetchImpl: typeof fetch, user: SupabaseClient, userId: string, rawCode: unknown) {
  const code = typeof rawCode === 'string' && /^\d{8,14}$/.test(rawCode) ? rawCode : null;
  if (!code) throw new AiFailure('invalid');
  const data = await getJson(fetchImpl, `${OFF}/api/v2/product/${code}?fields=code,product_name,image_front_url`);
  const p = data?.status === 1 ? (data.product as OffProduct) : null;
  const small = offImage(p?.image_front_url);
  if (!small) throw new AiFailure('not_found');
  // Pleine résolution si elle existe (…/front_fr.5.400.jpg → …/front_fr.5.full.jpg), sinon la version 400 px.
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  for (const url of [small.replace(/\.\d+\.jpg$/, '.full.jpg'), small]) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      // Taille contrôlée avant de tout lire : annoncée, puis pendant la lecture.
      const b = await readCapped(res.body, MAX_BYTES, res.headers.get('content-length'));
      if (b && b.byteLength > 0 && mediaType(b)) {
        bytes = b;
        break;
      }
    } catch {
      // essai suivant
    }
  }
  if (!bytes) throw new AiFailure('photo_service_unavailable');
  const type = mediaType(bytes)!;
  const path = `${userId}/off-${code}-${crypto.randomUUID().slice(0, 8)}.${type.split('/')[1]}`;
  const { error } = await user.storage.from('photos').upload(path, new Blob([bytes], { type }), { contentType: type });
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return { path, credit: `Photo Open Food Facts (licence CC BY-SA 3.0) — ${OFF}/product/${code}`, code };
}
