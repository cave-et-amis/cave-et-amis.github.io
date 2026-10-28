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

// Question sur l'application : lire les fiches d'aide, proposer l'écran de la première (le serveur refuse si la fonction
// n'est pas disponible pour la personne), puis répondre d'après la fiche, sans rien inventer.
function help(body, question, results) {
  if (results.length === 0) return message(body, [toolUse('app_help', { question })], 'tool_use');
  const found = JSON.parse(results[0].content);
  const topic = found.topics?.[0];
  if (!topic) return message(body, [text(found.note ?? 'Cette fonction n’existe pas dans l’application.')]);
  if (results.length === 1) return message(body, [toolUse('propose_open_page', { topic_id: topic.id })], 'tool_use');
  if (!topic.available) return message(body, [text(`**${topic.title}** : ce n’est pas disponible pour vous. ${topic.reason}`)]);
  return message(body, [text(`**${topic.title}**\n\n${topic.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`)]);
}

function chat(body) {
  const results = toolResults(body.messages);
  const asked = lastUserText(body.messages.filter((m) => !(Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))));
  // Sans la note « [Informations de l'application…] » ajoutée par le serveur.
  const question = asked
    .split('\n')
    .filter((l) => !l.startsWith('['))
    .join(' ')
    .trim();
  if (/^comment /i.test(question) && (body.tools ?? []).some((t) => t.name === 'app_help')) return help(body, question, results);
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

// Documents d'achat : étiquette de prix, ticket (avec un numéro de carte, que le serveur doit effacer), liste de prix.
function documentRead(body) {
  const ask = lastUserText(body.messages);
  const base = { is_readable: true, currency: 'EUR', purchase_date: '', seller: '', title: '', conditions: '', uncertain: [], notes: '' };
  const line = (wine_name, unit_price, extra = {}) => ({ wine_name, producer: '', vintage: null, color: 'rouge', volume_ml: 750, unit_price, quantity: null, ...extra });
  let out;
  if (/ticket de caisse/.test(ask)) {
    out = { ...base, purchase_date: '2026-10-20', seller: 'Cave du Marché', notes: 'Carte 4970 1234 5678 9012', document_lines: [line('Château Labeille 2016', 42.5, { quantity: 3, vintage: 2016 })] };
  } else if (/liste de prix/.test(ask)) {
    out = { ...base, seller: 'Domaine des Abeilles', title: 'Commande au Domaine des Abeilles', conditions: 'Franco de port dès 24 bouteilles', document_lines: [line('Cuvée des Ruches', 14), line('Clos du Miel', 22, { color: 'blanc', vintage: 2023 }), line('Vieilles Vignes', null)] };
  } else {
    out = { ...base, seller: 'Caviste exemple', conditions: '6 pour le prix de 5', uncertain: ['prix'], document_lines: [line('Château Labeille', 39.9)] };
  }
  return message(body, [text(JSON.stringify(out))]);
}

// Import multiple : trois bouteilles, dont deux identiques et une au millésime incertain.
function shelf(body) {
  const b = (name, producer, appellation, vintage, uncertain = []) => ({ name, producer, appellation, region: 'Bordeaux', color: 'rouge', vintage, non_vintage: false, uncertain });
  return message(body, [
    text(
      JSON.stringify({
        bottles: [b('Château Labeille', 'Château Labeille', 'Pauillac', 2016), b('Château Labeille', 'Château Labeille', 'Pauillac', 2016), b('Clos des Abeilles', '', 'Saint-Julien', 2019, ['vintage'])],
        notes: 'Une bouteille de dos, illisible.',
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

// Scanner, lot 3b : analyse sourcée (une source inventée, écartée par le serveur) et trois offres vérifiées.
const searchResults = (urls) => [
  { type: 'server_tool_use', id: 'srvtoolu_s', name: 'web_search', input: { query: 'Labeille 2016' }, caller: { type: 'direct' } },
  {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_s',
    caller: { type: 'direct' },
    content: urls.map((url) => ({ type: 'web_search_result', url, title: `Page ${new URL(url).hostname}`, encrypted_content: 'x', page_age: '2 octobre 2026' })),
  },
];

function assessment(body) {
  return message(
    body,
    [
      ...searchResults(['https://guide.example/labeille-2016', 'https://chateau-labeille.example/']),
      toolUse('report_assessment', {
        producer: { text: 'Second vin d’un cru réputé de Pauillac.', source_urls: ['https://chateau-labeille.example/'] },
        appellation: { text: 'Rouges de garde dominés par le cabernet sauvignon.', source_urls: [] },
        vintage: { text: '2016 est un grand millésime à Bordeaux.', rating: 'exceptionnel', source_urls: ['https://guide.example/labeille-2016'] },
        critics: [
          { publication: 'Guide exemple', reviewer: '', score: '2 étoiles', summary: 'Fruit mûr et tanins fins', url: 'https://guide.example/labeille-2016' },
          { publication: 'Note inventée', reviewer: '', score: '99/100', summary: '', url: 'https://inventee.example/' },
        ],
        consumers: [],
        aromatic_profile: 'Cassis, cèdre, notes grillées.',
        drink_window: { from: 2024, until: 2034, source_url: '' },
        pairings: 'Agneau, entrecôte.',
        quality: 'tres_bon',
        quality_reason: 'Cru réputé et grand millésime.',
      }),
    ],
    'tool_use',
    2,
  );
}

function scanOffers(body) {
  const urls = ['https://caviste-a.example/labeille-2016', 'https://caviste-b.example/labeille-2016', 'https://caviste-c.example/labeille-2016'];
  const offer = (url, price, extra = {}) => ({ url, title: 'Offre', seller: new URL(url).hostname, country: 'FR', price, currency: 'EUR', vat: 'ttc', shipping: null, min_quantity: null, vintage: 2016, volume_ml: 750, ...extra });
  return message(
    body,
    [...searchResults(urls), toolUse('report_scan_offers', { comment: 'Trois offres', offers: [offer(urls[0], 25, { shipping: 8.9 }), offer(urls[1], 27), offer(urls[2], 30, { min_quantity: 6 })] })],
    'tool_use',
    1,
  );
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
    if (body.output_config?.format?.schema?.properties?.bottles) return send(200, shelf(body));
    if (body.output_config?.format?.schema?.properties?.document_lines) return send(200, documentRead(body));
    if (body.output_config?.format) return send(200, label(body));
    if ((body.tools ?? []).some((t) => t.name === 'report_assessment')) return send(200, assessment(body));
    if ((body.tools ?? []).some((t) => t.name === 'report_scan_offers')) return send(200, scanOffers(body));
    if ((body.tools ?? []).some((t) => t.name === 'report_offers')) return send(200, price(body));
    if ((body.tools ?? []).some((t) => t.name === 'search_my_cellar')) return send(200, chat(body));
    return send(200, message(body, [text('OK')]));
  }
  send(404, { type: 'error', error: { type: 'not_found_error', message: 'introuvable' } });
}).listen(PORT, '127.0.0.1', () => console.log(`Faux Anthropic (tests) sur http://127.0.0.1:${PORT}`));
