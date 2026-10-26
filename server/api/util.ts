/** Outils communs du serveur : réponses JSON, CORS, lecture plafonnée, limites de fréquence, nettoyage des erreurs. */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Site en ligne : seule origine autorisée par défaut à appeler la fonction depuis un navigateur. */
export const SITE_ORIGIN = 'https://cave-et-amis.github.io';

export type ApiEnv = {
  supabaseUrl: string;
  /** Clé publique (publishable / anon) : clients agissant avec les droits de l'utilisateur. */
  publishableKey: string;
  /** Clé secrète (service_role) : comptabilité de l'assistant uniquement. */
  serviceKey: string;
  /** Clé Anthropic commune, lue côté serveur uniquement. Absente : l'assistant est « non configuré ». */
  anthropicKey?: string;
  /** Adresse de l'API Anthropic : tests et serveur local seulement (jamais lue dans les réglages en ligne). */
  anthropicBaseUrl?: string;
  /** Origines autorisées (CORS). Vide : l'origine du site (CAVE_APP_URL, sinon SITE_ORIGIN) ; « * » : toutes. */
  allowedOrigins?: string[];
  /** Durée maximale d'une demande à l'assistant (ms), sous la limite d'exécution des fonctions Supabase. */
  deadlineMs?: number;
  /** Intégration Nous : secret partagé des requêtes signées (absent : intégration désactivée). */
  ecosystemSecret?: string;
  /** Intégration Nous : adresse de la fonction « cave-sync » du projet Nous. */
  nousFunctionUrl?: string;
  /** Intégration Nous : adresse du site Nous et de ce site (liens envoyés). */
  nousAppUrl?: string;
  caveAppUrl?: string;
  /** Notifications push : origine du faux service de notifications (tests et serveur local seulement, jamais en ligne). */
  pushTestOrigin?: string;
};

/** Lit la configuration dans les variables d'environnement (Supabase Edge Functions ou serveur local). */
export function readEnv(get: (name: string) => string | undefined): ApiEnv {
  const firstKey = (json: string | undefined) => {
    if (!json) return undefined;
    try {
      const obj = JSON.parse(json) as Record<string, string>;
      return obj.default ?? Object.values(obj)[0];
    } catch {
      return undefined;
    }
  };
  return {
    supabaseUrl: (get('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
    publishableKey: firstKey(get('SUPABASE_PUBLISHABLE_KEYS')) ?? get('SUPABASE_ANON_KEY') ?? '',
    serviceKey: firstKey(get('SUPABASE_SECRET_KEYS')) ?? get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    anthropicKey: (get('ANTHROPIC_API_KEY') ?? '').trim() || undefined,
    // ANTHROPIC_BASE_URL n'est pas lue : en ligne, la clé ne part que vers l'adresse officielle d'Anthropic.
    deadlineMs: Number(get('AI_REQUEST_DEADLINE_MS')) > 0 ? Number(get('AI_REQUEST_DEADLINE_MS')) : undefined,
    // Un secret trop court équivaut à aucun secret : l'intégration reste désactivée.
    ecosystemSecret: (get('ECOSYSTEM_SECRET') ?? '').trim().length >= 32 ? (get('ECOSYSTEM_SECRET') ?? '').trim() : undefined,
    nousFunctionUrl: (get('NOUS_FUNCTION_URL') ?? '').trim() || undefined,
    nousAppUrl: (get('NOUS_APP_URL') ?? '').trim() || undefined,
    caveAppUrl: (get('CAVE_APP_URL') ?? '').trim() || undefined,
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  };
}

/** Origine d'une adresse (« https://site.exemple/chemin/ » → « https://site.exemple »), ou null. */
function originOf(url: string | undefined) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * CORS : seul le site (ou les origines d'ALLOWED_ORIGINS) peut lire les réponses depuis un navigateur. Une autre origine
 * reçoit celle du site, que le navigateur refuse. Sans effet sur les appels de serveur à serveur (Nous, tâches planifiées).
 */
export function corsHeaders(env: ApiEnv, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const list = env.allowedOrigins?.length ? env.allowedOrigins : [originOf(env.caveAppUrl) ?? SITE_ORIGIN];
  const allowed = list.includes('*') ? '*' : list.includes(origin) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Retire de tout message ce qui pourrait ressembler à un secret (clés, jetons) avant journalisation. */
export function sanitize(text: unknown, max = 300): string {
  return String(text ?? '')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[clé masquée]')
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[clé masquée]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jeton masqué]')
    .replace(/(x-api-key|authorization|apikey)\s*[:=]\s*(bearer\s+)?\S+/gi, '$1: [masqué]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export class AiFailure extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Lit un corps (requête, réponse, fichier) sans dépasser `max` octets : refus d'après la taille annoncée
 * (Content-Length), puis lecture interrompue dès que la limite est franchie. null : trop gros.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number, declared?: string | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (declared && Number(declared) > max) {
    await body?.cancel().catch(() => undefined);
    return null;
  }
  if (!body) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * Limites de fréquence hors IA, par personne, sur une fenêtre glissante (comptées par la base : rate_take). Les liens
 * d'invitation sont limités par la base elle-même (30 par 24 heures).
 */
export const RATE_LIMITS = {
  // Notification d'essai : jusqu'à 10 appareils par envoi.
  push_test: { max: 5, seconds: 3600 },
  // Open Food Facts : recherche et import d'une photo officielle, indice du code-barres pour le scanner.
  off: { max: 30, seconds: 600 },
  // Envoi immédiat vers l'agenda Nous demandé par l'application (sinon la tâche planifiée s'en charge dans la minute).
  nous_flush: { max: 20, seconds: 600 },
} as const;

/** Compte un appel de la personne ; false : limite atteinte (rien n'est compté). */
export async function rateOk(svc: SupabaseClient, bucket: keyof typeof RATE_LIMITS, userId: string): Promise<boolean> {
  const limit = RATE_LIMITS[bucket];
  const { data, error } = await svc.rpc('rate_take', { p_bucket: bucket, p_subject: userId, p_limit: limit.max, p_window_seconds: limit.seconds });
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return data === true;
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Date du jour en France. */
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
}
