// FAUX serveur Anthropic pour les tests d'interface UNIQUEMENT (jamais utilisé par l'application réelle).
// Il imite l'API Messages et l'API Models avec des réponses écrites à l'avance, pour vérifier les parcours
// (identification d'étiquette, prix sourcés, conversation avec action à confirmer) sans appeler le vrai service.
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 54398);
const KEY = process.env.MOCK_ANTHROPIC_KEY ?? 'sk-ant-e2e-test-key';

const usage = (searches = 0) => ({
  input_tokens: 1500,
  output_tokens: 250,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: null,
  inference_geo: null,
  output_tokens_details: null,
  server_tool_use: searches ? { web_search_requests: searches, web_fetch_requests: 0 } : null,
  service_tier: 'standard',
});
const message = (body, content, stop_reason = 'end_turn', searches = 0) => ({
  id: `msg_${Date.now()}`,
  type: 'message',
  role: 'assistant',
  model: body.model,
  content,
  stop_reason,
  stop_sequence: null,
  stop_details: null,
  container: null,
  usage: usage(searches),
});
const text = (t) => ({ type: 'text', text: t, citations: null });
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 10)}`, name, input, caller: { type: 'direct' } });

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const t = m.content.filter((b) => b.type === 'text').map((b) => b.text);
    if (t.length) return t.join('\n');
  }
  return '';
}

function toolResults(messages) {
  return messages.flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []));
}

function chat(body) {
  const results = toolResults(body.messages);
  const question = lastUserText(body.messages.filter((m) => !(Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))));
  const wantsExit = /sortie|bu une/i.test(question);
  if (results.length === 0) return message(body, [toolUse('search_my_cellar', { query: null, color: null, maturity: null, include_empty: null, limit: null })], 'tool_use');
  const first = JSON.parse(results[0].content);
  const wine = first.wines?.[0];
  if (!wine) return message(body, [text('Votre cave est vide pour l’instant : ajoutez une bouteille et je pourrai vous conseiller.')]);
  if (wantsExit && results.length === 1) return message(body, [toolUse('get_wine_details', { wine_id: wine.wine_id })], 'tool_use');
  if (wantsExit && results.length === 2) {
    const details = JSON.parse(results[1].content);
    return message(body, [toolUse('propose_consumption', { lot_id: details.lots[0].lot_id, quantity: 1, note: null })], 'tool_use');
  }
  if (wantsExit) return message(body, [text('Confirmez la sortie ci-dessous si elle est juste.')]);
  return message(body, [text(`**D’après votre cave :** je vous propose le **${wine.name}**.\n\n- **Repère général :** servez-le à ${wine.serving_temperature?.text ?? '16 °C'}.\n- **Estimation :** il accompagnera bien un magret.`)]);
}

function label(body) {
  return message(body, [
    text(
      JSON.stringify({
        is_wine_label: true,
        fields: {
          name: 'Château Labeille',
          domaine: null,
          producer: 'Château Labeille',
          cuvee: null,
          country: 'France',
          region: 'Bordeaux',
          appellation: 'Pauillac',
          color: 'rouge',
          wine_type: 'tranquille',
          grapes: ['Cabernet sauvignon'],
          vintage: 2016,
          non_vintage: false,
          volume_ml: 750,
        },
        uncertain: ['vintage'],
        advice: { drink_from: 2024, drink_until: 2040, serve_temp_min: 16, serve_temp_max: 18, aeration: 'Carafer 1 heure', pairings: 'Agneau, gibier' },
        notes: null,
      }),
    ),
  ]);
}

// Scanner : deux cuvées possibles (Lia demande laquelle), prix du rayon lu, millésime incertain, reflet signalé.
function scan(body) {
  return message(body, [
    text(
      JSON.stringify({
        is_wine_label: true,
        fields: {
          name: 'Château Labeille',
          domaine: '',
          producer: 'Château Labeille',
          cuvee: '',
          country: 'France',
          region: 'Bordeaux',
          appellation: 'Pauillac',
          color: 'rouge',
          wine_type: 'tranquille',
          grapes: [],
          vintage: 2016,
          non_vintage: false,
          volume_ml: 750,
          barcode: '',
          alcohol: 13.5,
        },
        uncertain: ['vintage'],
        candidates: [
          { name: 'Château Labeille', producer: 'Château Labeille', cuvee: 'Grand vin', appellation: 'Pauillac', vintage: 2016, reason: 'Étiquette crème' },
          { name: 'Château Labeille', producer: 'Château Labeille', cuvee: 'Le Petit Labeille', appellation: 'Pauillac', vintage: 2016, reason: 'Second vin, même étiquette' },
        ],
        price_tag: { price: 24.9, currency: 'EUR', label: 'PAUILLAC LABEILLE 2016', conditions: '2 achetées : -20 % sur la 2e' },
        photo_issues: ['glare'],
        notes: '',
      }),
    ),
  ]);
}

function price(body) {
  return message(
    body,
    [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'prix' }, caller: { type: 'direct' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        caller: { type: 'direct' },
        content: [{ type: 'web_search_result', url: 'https://caviste.example/vin-2016', title: 'Caviste exemple', encrypted_content: 'x', page_age: null }],
      },
      toolUse('report_offers', {
        comment: 'Une offre trouvée',
        offers: [
          { url: 'https://caviste.example/vin-2016', title: 'Offre', seller: 'Caviste exemple', price: 61.5, currency: 'EUR', vintage: 2016, volume_ml: 750 },
          { url: 'https://inventee.example/faux', title: 'Inventée', seller: 'Faux', price: 12, currency: 'EUR', vintage: 2016, volume_ml: 750 },
        ],
      }),
    ],
    'tool_use',
    1,
  );
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_e2e' });
    res.end(JSON.stringify(obj));
  };
  if (req.headers['x-api-key'] !== KEY) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    return send(200, {
      data: [
        { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
        { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-01T00:00:00Z' },
      ],
      has_more: false,
      first_id: 'claude-opus-5-5',
      last_id: 'claude-sonnet-5-5',
    });
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    const body = JSON.parse(raw);
    if (body.output_config?.format?.schema?.properties?.price_tag) return send(200, scan(body));
    if (body.output_config?.format) return send(200, label(body));
    if ((body.tools ?? []).some((t) => t.name === 'report_offers')) return send(200, price(body));
    if ((body.tools ?? []).some((t) => t.name === 'search_my_cellar')) return send(200, chat(body));
    return send(200, message(body, [text('OK')]));
  }
  send(404, { type: 'error', error: { type: 'not_found_error', message: 'introuvable' } });
}).listen(PORT, '127.0.0.1', () => console.log(`Faux Anthropic (tests) sur http://127.0.0.1:${PORT}`));
