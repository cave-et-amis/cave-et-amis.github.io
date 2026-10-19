/**
 * FAUX serveur Anthropic, réservé aux tests automatiques : il répond à l'API Messages et à l'API Models
 * avec des réponses écrites à l'avance, pour vérifier le comportement du serveur sans appeler le vrai service.
 * Il n'est utilisé nulle part dans l'application.
 */
export const TEST_ANTHROPIC_KEY = 'sk-ant-test-0123456789-ne-pas-utiliser';

export type MockReply =
  | { kind: 'message'; content: unknown[]; stop_reason?: string; usage?: Partial<{ input_tokens: number; output_tokens: number; web_search_requests: number }> }
  | { kind: 'error'; status: number; type: string; message: string }
  | { kind: 'network' };

export type Recorded = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };

export function createAnthropicMock(opts: { key?: string } = {}) {
  const key = opts.key ?? TEST_ANTHROPIC_KEY;
  const queue: (MockReply | ((body: Record<string, unknown>) => MockReply | Promise<MockReply>))[] = [];
  const requests: Recorded[] = [];
  let gate: Promise<void> | null = null;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const text = req.method === 'GET' ? '' : await req.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    requests.push({ url: url.pathname, headers, body });
    if (gate) await gate;
    const err = (status: number, type: string, message: string) =>
      new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
    if (req.headers.get('x-api-key') !== key) return err(401, 'authentication_error', 'invalid x-api-key');
    if (url.pathname.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          data: [
            { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
            { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-01T00:00:00Z' },
          ],
          has_more: false,
          first_id: 'claude-opus-5-5',
          last_id: 'claude-sonnet-5-5',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    const next = queue.shift();
    if (!next) return err(500, 'api_error', 'Aucune réponse préparée dans le faux serveur');
    const reply = typeof next === 'function' ? await next(body ?? {}) : next;
    if (reply.kind === 'network') throw new TypeError('fetch failed');
    if (reply.kind === 'error') return err(reply.status, reply.type, reply.message);
    return new Response(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: String(body?.model ?? 'claude-opus-5-5'),
        content: reply.content,
        stop_reason: reply.stop_reason ?? 'end_turn',
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: {
          input_tokens: reply.usage?.input_tokens ?? 1200,
          output_tokens: reply.usage?.output_tokens ?? 300,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: null,
          inference_geo: null,
          output_tokens_details: null,
          server_tool_use: reply.usage?.web_search_requests ? { web_search_requests: reply.usage.web_search_requests, web_fetch_requests: 0 } : null,
          service_tier: 'standard',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } },
    );
  }) as typeof fetch;

  return {
    key,
    fetch: fetchImpl,
    requests,
    reply(...r: (MockReply | ((body: Record<string, unknown>) => MockReply | Promise<MockReply>))[]) {
      queue.push(...r);
    },
    /** Bloque les réponses jusqu'à l'appel de la fonction renvoyée (demandes simultanées). */
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    pending: () => queue.length,
  };
}

export const text = (t: string) => ({ type: 'text', text: t, citations: null });
export const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
