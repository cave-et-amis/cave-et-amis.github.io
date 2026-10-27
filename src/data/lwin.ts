/**
 * Dictionnaire des vins français (LWIN) : téléchargé seulement à la première recherche (environ 850 Ko compressés), puis
 * gardé par le service worker comme les autres fichiers du site. Aucune donnée personnelle, aucun serveur interrogé.
 */
import { decodeLwin, type LwinFile, type LwinIndex } from '../domain/lwin';
import lwinUrl from './lwin-fr.json?url';

let loading: Promise<LwinIndex> | null = null;

export function loadLwin(): Promise<LwinIndex> {
  loading ??= fetch(lwinUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<LwinFile>;
    })
    .then(decodeLwin)
    .catch((e) => {
      // Réseau coupé : nouvel essai à la prochaine recherche.
      loading = null;
      throw e;
    });
  return loading;
}
