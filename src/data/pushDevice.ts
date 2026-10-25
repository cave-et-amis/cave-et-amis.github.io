/**
 * Notifications push de cet appareil : prise en charge par le navigateur, autorisation, abonnement auprès de son service
 * de notifications (Apple, Google, Mozilla, Microsoft). L'abonnement est ensuite confié au serveur, seul à pouvoir
 * envoyer (clé VAPID) ; le contenu est chiffré pour cet appareil.
 */

export type PushSupport = { ok: true } | { ok: false; reason: 'ios-install' | 'unsupported' | 'insecure' };

/** iPhone, iPod, iPad (y compris un iPad qui se présente comme un Mac). */
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Sur iPhone et iPad, les notifications push ne sont permises qu'à une application ajoutée à l'écran d'accueil (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (isIos() && !standalone()) return { ok: false, reason: 'ios-install' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: isIos() ? 'ios-install' : 'unsupported' };
  }
  return { ok: true };
}

export function pushPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied';
}

/** Autorisation refusée par la personne (ou bloquée dans les réglages de l'appareil). */
export class PushDenied extends Error {
  constructor() {
    super('Notifications refusées sur cet appareil.');
  }
}

export type DeviceSubscription = { endpoint: string; p256dh: string; auth: string };

function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

function toDevice(s: PushSubscription): DeviceSubscription {
  const keys = s.toJSON().keys ?? {};
  return { endpoint: s.endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // En ligne, l'application enregistre son service worker au démarrage ; sinon, on le fait ici.
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('./sw.js');
  return navigator.serviceWorker.ready;
}

/** Abonnement actuel de cet appareil, sans rien demander (null s'il n'y en a pas). */
export async function currentSubscription(): Promise<DeviceSubscription | null> {
  if (!pushSupport().ok || pushPermission() !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? toDevice(sub) : null;
}

/**
 * Demande l'autorisation puis abonne cet appareil. À appeler directement depuis un geste de la personne (bouton) :
 * l'autorisation est demandée avant toute autre attente, comme l'exige l'iPhone. `publicKey` : clé du serveur.
 */
export async function subscribeDevice(publicKey: Promise<string>): Promise<DeviceSubscription> {
  const asked = Notification.requestPermission();
  // La clé arrive pendant la question ; son éventuel échec est traité plus bas.
  publicKey.catch(() => undefined);
  if ((await asked) !== 'granted') throw new PushDenied();
  const key = fromB64u(await publicKey);
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, key)) return toDevice(existing);
  // Abonnement fait avec une autre clé de serveur : remplacé.
  if (existing) await existing.unsubscribe().catch(() => undefined);
  return toDevice(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
}

/** Désabonne cet appareil auprès du navigateur ; renvoie l'adresse qu'il avait (à retirer aussi du serveur). */
export async function unsubscribeDevice(): Promise<string | null> {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return null;
  await sub.unsubscribe().catch(() => undefined);
  return sub.endpoint;
}

/** Adresse de l'abonnement de cet appareil (déconnexion : il ne recevra plus les notifications de la personne). */
export async function thisDeviceEndpoint(): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
  return Promise.race([currentSubscription().then((s) => s?.endpoint ?? null, () => null), timeout]);
}

/** Nom lisible de l'appareil, pour s'y retrouver dans la liste des Réglages. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : isIos()
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Téléphone Android'
          : 'Tablette Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'PC Windows'
            : /Linux|CrOS/.test(ua)
              ? 'Ordinateur'
              : 'Appareil';
  // Une application installée sur iPhone n'a qu'un moteur : inutile d'indiquer le navigateur.
  return isIos() || !browser ? device : `${device} · ${browser}`;
}
