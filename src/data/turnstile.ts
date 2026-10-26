/**
 * Contrôle anti-robots Cloudflare Turnstile, exigé par Supabase à la connexion, à l'inscription et pour « mot de passe
 * oublié » quand la protection est activée. Le script de Cloudflare n'est chargé que si une clé de site est configurée
 * et qu'un écran affiche le contrôle ; il vient directement de Cloudflare, seule source prévue par Cloudflare.
 */

/** Rendu explicite : le contrôle n'apparaît que là où l'application le place. */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type TurnstileOptions = {
  sitekey: string;
  language: string;
  /** Pas de champ caché dans le formulaire : le jeton est remis par `callback`. */
  'response-field': boolean;
  callback: (token: string) => void;
  'expired-callback': () => void;
  /** Renvoyer true : l'erreur est prise en charge par l'application. */
  'error-callback': (code: string) => boolean;
};

export type Turnstile = {
  render(container: HTMLElement, options: TurnstileOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

type ScriptLike = { src: string; onload: (() => void) | null; onerror: (() => void) | null; remove(): void };
/** Ce que le chargement utilise de la page (remplaçable dans les tests, qui ne chargent jamais Cloudflare). */
export type TurnstileHost = {
  document: { createElement(tag: 'script'): ScriptLike; head: { appendChild(node: ScriptLike): unknown } };
  turnstile?: Turnstile;
};

const loading = new WeakMap<TurnstileHost, Promise<Turnstile>>();

/** Charge le script une seule fois. Après un échec (réseau, bloqueur, délai dépassé), un nouvel appel réessaie. */
export function loadTurnstile(host: TurnstileHost = window as unknown as TurnstileHost, timeoutMs = 20_000): Promise<Turnstile> {
  if (host.turnstile) return Promise.resolve(host.turnstile);
  const pending =
    loading.get(host) ??
    new Promise<Turnstile>((resolve, reject) => {
      const script = host.document.createElement('script');
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok && host.turnstile) return resolve(host.turnstile);
        script.remove();
        loading.delete(host);
        reject(new Error('turnstile_unavailable'));
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      script.src = TURNSTILE_SCRIPT;
      host.document.head.appendChild(script);
    });
  loading.set(host, pending);
  return pending;
}
