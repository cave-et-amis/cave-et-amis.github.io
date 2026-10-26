/**
 * Ce que l'application garde sur l'appareil en plus de la session (page « Cookies et stockage sur votre appareil ») :
 * effacé à la déconnexion, pour qu'un appareil partagé ne garde rien de la personne précédente.
 */
import { LINK_PENDING_KEY } from '../domain/nous';
import { clearDraft } from '../features/scanner/draft';

const LOCAL_KEYS = ['cave-amis-invite', 'cave-amis-actions', 'cave.scan.budget', LINK_PENDING_KEY];
const SESSION_KEYS = ['cave-amis-visite-plus-tard'];

export async function clearDeviceData() {
  for (const k of LOCAL_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // stockage indisponible : rien à effacer
    }
  }
  for (const k of SESSION_KEYS) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      // idem
    }
  }
  await clearDraft();
}
