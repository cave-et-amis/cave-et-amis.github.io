/** Outils communs du serveur : réponses JSON, CORS, nettoyage des messages d'erreur. */

export type ApiEnv = {
  supabaseUrl: string;
  /** Clé publique (publishable / anon) : clients agissant avec les droits de l'utilisateur. */
  publishableKey: string;
  /** Clé secrète (service_role) : comptabilité de l'assistant uniquement. */
  serviceKey: string;
  /** Clé Anthropic commune, lue côté serveur uniquement. Absente : l'assistant est « non configuré ». */
  anthropicKey?: string;
  /** Adresse de l'API Anthropic (tests uniquement). */
  anthropicBaseUrl?: string;
  /** Origines autorisées (CORS). Vide : toutes. */
  allowedOrigins?: string[];
  /** Durée maximale d'une demande à l'assistant (ms), sous la limite d'exécution des fonctions Supabase. */
  deadlineMs?: number;
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
    anthropicBaseUrl: (get('ANTHROPIC_BASE_URL') ?? '').trim() || undefined,
    deadlineMs: Number(get('AI_REQUEST_DEADLINE_MS')) > 0 ? Number(get('AI_REQUEST_DEADLINE_MS')) : undefined,
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  };
}

export function corsHeaders(env: ApiEnv, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = !env.allowedOrigins?.length ? '*' : env.allowedOrigins.includes(origin) ? origin : env.allowedOrigins[0];
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

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Date du jour en France. */
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
}
