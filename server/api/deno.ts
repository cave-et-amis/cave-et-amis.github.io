/**
 * Point d'entrée Supabase Edge Function (Deno). `npm run build:function` le regroupe avec ses modules dans
 * supabase/functions/cave-api/index.ts (un seul fichier, déployable par la CLI ou collé dans le tableau de bord).
 * La clé ANTHROPIC_API_KEY se règle dans Supabase › Edge Functions › Secrets : jamais dans le code.
 */
import { createApiHandler } from './handler.ts';
import { readEnv } from './util.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

Deno.serve(createApiHandler(readEnv((name) => Deno.env.get(name))));
