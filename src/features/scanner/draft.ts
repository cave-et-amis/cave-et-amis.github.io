/**
 * Brouillon du scanner, gardé sur l'appareil (IndexedDB) : les photos prises sans réseau ne sont pas perdues si
 * l'application se ferme. Une seule série, pour la personne connectée ; effacée après l'envoi, ou au bout de 3 jours.
 * Si le stockage est indisponible (navigation privée…), le scanner fonctionne normalement, sans brouillon.
 */
import type { ScanPhotoRole } from '../../domain/types';

export type Draft = {
  userId: string;
  photos: Partial<Record<ScanPhotoRole, { blob: Blob; hash: string }>>;
  barcode: string;
  visitId: string | null;
  savedAt: number;
};

const DB = 'cave-scanner';
const STORE = 'draft';
const KEY = 'current';
const MAX_AGE = 3 * 86_400_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indisponible'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDraft(userId: string): Promise<Draft | null> {
  try {
    const d = (await run<Draft | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<Draft | undefined>)) ?? null;
    if (!d) return null;
    // Brouillon d'une autre personne sur le même appareil, ou trop ancien : effacé.
    if (d.userId !== userId || Date.now() - d.savedAt > MAX_AGE) {
      await clearDraft();
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export async function saveDraft(d: Omit<Draft, 'savedAt'>) {
  try {
    if (!Object.keys(d.photos).length && !d.barcode.trim()) return clearDraft();
    await run('readwrite', (s) => s.put({ ...d, savedAt: Date.now() }, KEY));
  } catch {
    // sans brouillon : sans gravité
  }
}

export async function clearDraft() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // rien à effacer
  }
}
