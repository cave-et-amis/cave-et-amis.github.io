import { describe, expect, it } from 'vitest';
import { text, toolUse, TEST_ANTHROPIC_KEY } from '../helpers/anthropicMock.ts';
import { TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv, setSettings, usageRows, type AiEnv } from './setup.ts';

async function cellarWith(env: AiEnv) {
  const bruno = await env.signUp('Bruno');
  const claire = await env.signUp('Claire');
  const { data: inv } = await bruno.sb.rpc('create_friend_invite');
  await claire.sb.rpc('respond_friend_invite', { p_code: (inv as { code: string }).code, p_accept: true });
  // Le lien ouvre la cave de Bruno à Claire ; Claire ouvre la sienne en retour.
  await claire.sb.rpc('grant_cellar_access', { p_user: bruno.id });
  const add = async (who: typeof bruno, wine: Record<string, unknown>, lot: Record<string, unknown>) => {
    const { data: w, error } = await who.sb.from('wines').insert(wine).select().single();
    if (error) throw error;
    const { data: l, error: e2 } = await who.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 3, ...lot }, p_request: crypto.randomUUID() });
    if (e2) throw e2;
    return { wineId: w.id as string, lotId: (l as { id: string }).id };
  };
  const madiran = await add(bruno, { name: 'Madiran Château Montus', vintage: 2016, color: 'rouge', appellation: 'Madiran' }, { purchase_price: 32 });
  const privateClaire = await add(claire, { name: 'Secret de Claire', vintage: 2010, color: 'rouge', notes: 'cadeau de mariage' }, { purchase_price: 150 });
  const sharedClaire = await add(claire, { name: 'Cahors partagé', vintage: 2018, color: 'rouge' }, { visibility: 'friends', purchase_price: 18 });
  return { bruno, claire, madiran, privateClaire, sharedClaire };
}

describe('assistant : sécurité et droits', () => {
  it('refuse les appels sans session', async () => {
    const env = await makeAiEnv();
    const res = await call(env.client(), { action: 'status' });
    expect(res.status).toBe(401);
    expect(res.code).toBe('not_authenticated');
    expect(env.anthropic.requests).toHaveLength(0);
  });

  it('clé absente : « non configuré », les fonctions manuelles restent utilisables', async () => {
    const env = await makeAiEnv({ withKey: false });
    const bruno = await env.signUp('Bruno');
    const status = await call(bruno.sb, { action: 'status' });
    expect(status).toMatchObject({ ok: true, configured: false });
    const chat = await call(bruno.sb, { action: 'chat', message: 'Bonjour' });
    expect(chat).toMatchObject({ ok: false, code: 'ai_not_configured' });
    const { data: w, error } = await bruno.sb.from('wines').insert({ name: 'Saisie manuelle' }).select().single();
    expect(error).toBeNull();
    const { error: e2 } = await bruno.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 2 }, p_request: crypto.randomUUID() });
    expect(e2).toBeNull();
  });

  it('les outils lisent avec les droits de la personne : rien de privé d’un autre, masques respectés', async () => {
    const env = await makeAiEnv();
    const { bruno, privateClaire } = await cellarWith(env);
    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t1', 'search_my_cellar', { query: null, color: null, maturity: null, include_empty: null, limit: null }), toolUse('t2', 'search_friends_wines', { query: null, color: null, limit: null }), toolUse('t3', 'get_wine_details', { wine_id: privateClaire.wineId })] },
      { kind: 'message', content: [text('Je vous propose le **Madiran Château Montus 2016**.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'Quel vin ouvrir avec un magret de canard ?' });
    expect(res.ok).toBe(true);
    const second = env.anthropic.requests[1].body!;
    const toolResults = JSON.stringify((second.messages as { content: unknown }[]).at(-1)!.content);
    expect(toolResults).toContain('Madiran');
    expect(toolResults).toContain('Cahors partagé');
    expect(toolResults).not.toContain('Secret de Claire');
    expect(toolResults).not.toContain('cadeau de mariage');
    expect(toolResults).not.toContain('150');
    expect(toolResults).not.toContain('18 EUR');
    expect(toolResults).toContain('Vin introuvable');
    // La clé n'est envoyée qu'à Anthropic, jamais au navigateur ni dans les messages du modèle.
    expect(env.anthropic.requests[0].headers['x-api-key']).toBe(TEST_ANTHROPIC_KEY);
    expect(JSON.stringify(res)).not.toContain(TEST_ANTHROPIC_KEY);
    expect(JSON.stringify(env.anthropic.requests.map((r) => r.body))).not.toContain(TEST_ANTHROPIC_KEY);
    // Conversation enregistrée pour Bruno seul.
    const { data: msgs } = await bruno.sb.from('ai_messages').select('role, content');
    expect(msgs).toHaveLength(2);
    const claire = await env.signUp('Marc');
    const { data: none } = await claire.sb.from('ai_messages').select('*');
    expect(none).toEqual([]);
    const usage = await usageRows(env);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ action: 'chat', status: 'done', api_calls: 2 });
    expect(Number(usage[0].cost_usd)).toBeGreaterThan(0);
    expect(Number(usage[0].reserved_usd)).toBe(0);
  });

  it('un simple contact ne montre aucune bouteille à Lia, ni dans sa cave ni pour un événement', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const marc = await env.signUp('Marc');
    const { data: inv } = await bruno.sb.rpc('create_invite', { p_kind: 'discovery', p_target: null });
    await marc.sb.rpc('respond_friend_invite', { p_code: (inv as { code: string }).code, p_accept: true });
    const { data: w } = await marc.sb.from('wines').insert({ name: 'Bandol de Marc', color: 'rouge' }).select().single();
    await marc.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 3, visibility: 'event' }, p_request: crypto.randomUUID() });
    const { data: ev } = await bruno.sb.rpc('create_event', { p: { title: 'Dîner', starts_at: '2030-03-01T19:00:00Z' }, p_guests: [marc.id] });
    const eventId = (ev as { id: string }).id;
    await marc.sb.rpc('respond_event', { p_event: eventId, p_rsvp: 'yes' });
    const lastResults = (i: number) => JSON.stringify((env.anthropic.requests[i].body!.messages as { content: unknown }[]).at(-1)!.content);
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [toolUse('t1', 'search_friends_wines', { query: null, color: null, limit: null }), toolUse('t2', 'get_event', { event_id: eventId })],
      },
      { kind: 'message', content: [text('Marc ne vous a pas ouvert sa cave.')] },
    );
    expect((await call(bruno.sb, { action: 'chat', message: 'Que pourrait apporter Marc ?' })).ok).toBe(true);
    expect(lastResults(1)).toContain('total_matching');
    expect(lastResults(1)).not.toContain('Bandol de Marc');
    // Prénoms des participants : lus par profile_names (la table profiles ne donne que sa propre ligne).
    const blocks = (env.anthropic.requests[1].body!.messages as { content: { tool_use_id: string; content: string }[] }[]).at(-1)!.content;
    const event = JSON.parse(blocks.find((b) => b.tool_use_id === 't2')!.content) as { organizer: string; participants: { name: string }[] };
    expect(event.organizer).toBe('vous');
    expect(event.participants.map((p) => p.name).sort()).toEqual(['Marc', 'vous']);
    // Une fois sa cave ouverte à Bruno, la bouteille apparaît.
    await marc.sb.rpc('grant_cellar_access', { p_user: bruno.id });
    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t3', 'search_friends_wines', { query: null, color: null, limit: null })] },
      { kind: 'message', content: [text('Marc a un **Bandol**.')] },
    );
    await call(bruno.sb, { action: 'chat', message: 'Et maintenant ?' });
    expect(lastResults(3)).toContain('Bandol de Marc');
  });

  it('une proposition de consommation ne modifie rien sans confirmation', async () => {
    const env = await makeAiEnv();
    const { bruno, madiran } = await cellarWith(env);
    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t1', 'propose_consumption', { lot_id: madiran.lotId, quantity: 1, note: null })] },
      { kind: 'message', content: [text('Confirmez la sortie ci-dessous.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'J’ai bu une bouteille de Madiran hier' });
    const actions = (res.message as { meta: { actions: { type: string; label: string; quantity: number }[] } }).meta.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'consume', quantity: 1 });
    expect(actions[0].label).toContain('Madiran');
    const { data: lot } = await bruno.sb.from('lots').select('quantity').eq('id', madiran.lotId).single();
    expect(lot!.quantity).toBe(3);
  });

  it('une proposition visant le lot d’un autre est refusée par le serveur', async () => {
    const env = await makeAiEnv();
    const { bruno, privateClaire } = await cellarWith(env);
    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t1', 'propose_consumption', { lot_id: privateClaire.lotId, quantity: 1, note: null })] },
      { kind: 'message', content: [text('Je ne trouve pas ce lot.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'Sors une bouteille de ce lot' });
    expect((res.message as { meta: { actions: unknown[] } }).meta.actions).toEqual([]);
  });

  it('Lia distingue les bouteilles libres de celles mises à disposition d’un groupe', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const { data: w } = await bruno.sb.from('wines').insert({ name: 'Morgon', vintage: 2020, color: 'rouge' }).select().single();
    const { data: lot } = await bruno.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 6 }, p_request: crypto.randomUUID() });
    const { data: g } = await bruno.sb.rpc('create_group', { p_name: 'Les soirées entre amis', p_emoji: '🎉', p_description: null, p_photo: null, p_invite: [] });
    const { error } = await bruno.sb.rpc('allocate_to_group', { p_lot: (lot as { id: string }).id, p_group: (g as { id: string }).id, p_quantity: 2 });
    expect(error).toBeNull();
    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t1', 'search_my_cellar', { query: null, color: null, maturity: null, include_empty: null, limit: null })] },
      { kind: 'message', content: [text('Ouvrez une de vos **4 bouteilles libres** de Morgon.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'Que boire ce soir ?' });
    expect(res.ok).toBe(true);
    const last = (env.anthropic.requests[1].body!.messages as { content: { content: string }[] }[]).at(-1)!.content;
    const found = JSON.parse(last[0].content) as { wines: Record<string, unknown>[] };
    expect(found.wines[0]).toMatchObject({
      name: 'Morgon',
      bottles_in_stock: 6,
      bottles_available: 4,
      bottles_set_aside_for_groups: [{ group: 'Les soirées entre amis', bottles: 2 }],
    });
    expect(found.wines[0].bottles_reserved_for_events).toBeUndefined();
  });

  it('cave gérée à plusieurs : Lia voit la cave partagée, nommée comme telle ; on n’apporte que ses propres bouteilles', async () => {
    const env = await makeAiEnv();
    const { bruno, claire, madiran } = await cellarWith(env);
    const { data: cellar } = await bruno.sb.from('cellars').select('id').eq('name', 'Ma cave').single();
    await bruno.sb.rpc('invite_to_cellar', { p_cellar: (cellar as { id: string }).id, p_users: [claire.id] });
    const { error } = await claire.sb.rpc('respond_cellar_invite', { p_cellar: (cellar as { id: string }).id, p_accept: true });
    expect(error).toBeNull();
    const { data: ev } = await claire.sb.rpc('create_event', { p: { title: 'Dîner', starts_at: '2030-01-01T19:00:00Z' }, p_guests: [] });
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [
          toolUse('t1', 'get_wine_details', { wine_id: madiran.wineId }),
          toolUse('t2', 'propose_event_wine', { event_id: (ev as { id: string }).id, lot_id: madiran.lotId, quantity: 1 }),
        ],
      },
      { kind: 'message', content: [text('Le **Madiran** de la cave de Bruno se boit bien.')] },
    );
    const res = await call(claire.sb, { action: 'chat', message: 'Que boire avec un magret ?' });
    expect(res.ok).toBe(true);
    const results = (env.anthropic.requests[1].body!.messages as { content: { content: string }[] }[]).at(-1)!.content.map((c) => c.content);
    expect(JSON.parse(results[0]).lots[0].cellar).toBe('Ma cave (cave de Bruno, gérée à plusieurs)');
    expect(results[1]).toContain('n’est pas proposable');
  });

  it('groupe : Lia connaît ses bouteilles, les goûts des membres et les envies, et propose pour la soirée du groupe', async () => {
    const env = await makeAiEnv();
    const { bruno, claire, madiran } = await cellarWith(env);
    const { data: g } = await bruno.sb.rpc('create_group', { p_name: 'Les copains', p_emoji: '🍷', p_description: null, p_photo: null, p_invite: [claire.id] });
    const groupId = (g as { id: string }).id;
    await claire.sb.rpc('respond_group_invite', { p_group: groupId, p_accept: true });
    await bruno.sb.rpc('allocate_to_group', { p_lot: madiran.lotId, p_group: groupId, p_quantity: 2 });
    await claire.sb.rpc('create_tasting', { p: { wine_name: 'Cahors partagé', rating: 4, comment: 'Fruité', group_id: groupId }, p_consume_lot: null, p_request: crypto.randomUUID() });
    await claire.sb.rpc('add_group_wish', { p_group: groupId, p: { wine_name: 'Château Montus', vintage: 2016 } });
    const { data: ev, error } = await claire.sb.rpc('create_event', { p: { title: 'Soirée des copains', starts_at: '2030-02-01T19:00:00Z', group_id: groupId }, p_guests: [bruno.id] });
    expect(error).toBeNull();
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [
          toolUse('t1', 'get_group', { group_id: groupId }),
          toolUse('t2', 'propose_event_wine', { event_id: (ev as { id: string }).id, lot_id: madiran.lotId, quantity: 2 }),
        ],
      },
      { kind: 'message', content: [text('Je propose le **Madiran** mis à disposition par Bruno.')] },
    );
    const res = await call(claire.sb, { action: 'chat', message: 'Que boire à notre soirée ?', context: { kind: 'group', id: groupId } });
    expect(res.ok).toBe(true);
    const first = JSON.stringify(env.anthropic.requests[0].body!.messages);
    expect(first).toContain('depuis le groupe « Les copains »');
    const results = (env.anthropic.requests[1].body!.messages as { content: { content: string }[] }[]).at(-1)!.content.map((c) => c.content);
    const group = JSON.parse(results[0]);
    expect(group.bottles[0]).toMatchObject({ name: 'Madiran Château Montus', owner: 'Bruno', set_aside_for_the_group: 2 });
    expect(group.member_tastes[0]).toMatchObject({ member: 'la personne', wine: 'Cahors partagé', rating_out_of_5: 4 });
    expect(group.common_wishes[0]).toMatchObject({ wine: 'Château Montus', vintage: 2016, participants: 1 });
    expect(group.evenings[0]).toMatchObject({ title: 'Soirée des copains', status: 'planned' });
    const actions = (res.message as { meta: { actions: { type: string; own: boolean; label: string }[] } }).meta.actions;
    expect(actions).toMatchObject([{ type: 'event_wine', own: false }]);
    expect(actions[0].label).toContain('Bruno');
  });

  it('message trop long, conversation d’un autre', async () => {
    const env = await makeAiEnv();
    const { bruno, claire } = await cellarWith(env);
    await setSettings(env, { max_input_chars: 100 });
    expect(await call(bruno.sb, { action: 'chat', message: 'x'.repeat(101) })).toMatchObject({ ok: false, code: 'message_too_long' });
    await setSettings(env, { max_input_chars: 2000 });
    env.anthropic.reply({ kind: 'message', content: [text('Bonjour Claire')] });
    const first = await call(claire.sb, { action: 'chat', message: 'Bonjour' });
    const res = await call(bruno.sb, { action: 'chat', message: 'Suite', conversation_id: first.conversation_id });
    expect(res).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('assistant : aide sur l’application', () => {
  type HelpResult = { topics: { id: string; available: boolean; steps?: string[]; reason?: string }[]; note?: string; page?: string };
  const toolResults = (env: AiEnv, i: number) =>
    (env.anthropic.requests[i].body!.messages as { content: { content: string }[] }[]).at(-1)!.content.map((c) => JSON.parse(c.content) as HelpResult & Record<string, string>);

  it('répond d’après les fiches d’aide et propose d’ouvrir le vrai écran ; rien n’est modifié', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [toolUse('t1', 'app_help', { question: 'Je veux inviter Paul sans lui montrer mes bouteilles' }), toolUse('t2', 'propose_open_page', { topic_id: 'inviter-decouverte' })],
      },
      { kind: 'message', content: [text('Envoyez-lui une invitation « Découvrir l’application » : Paul ne verra pas votre cave.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'Je veux inviter Paul sans lui montrer mes bouteilles.' });
    expect(res.ok).toBe(true);
    const [help, open] = toolResults(env, 1);
    expect(help.topics[0]).toMatchObject({ id: 'inviter-decouverte', available: true });
    expect(help.topics[0].steps!.join(' ')).toContain('« Découvrir l’application »');
    expect(open).toMatchObject({ proposed: 'Ouvrir les invitations' });
    const actions = (res.message as { meta: { actions: unknown[] } }).meta.actions;
    expect(actions).toEqual([expect.objectContaining({ type: 'open', label: 'Ouvrir les invitations', path: '/amis?onglet=invitations' })]);
  });

  it('fonction inaccessible : l’administration pour une personne qui n’est pas administratrice ; jamais d’adresse libre', async () => {
    const env = await makeAiEnv();
    await env.signUp('Bruno'); // premier compte : administrateur
    const marc = await env.signUp('Marc');
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [
          toolUse('t1', 'app_help', { question: 'Comment changer la clé et les quotas de l’assistant ?' }),
          toolUse('t2', 'propose_open_page', { topic_id: 'administration' }),
          toolUse('t3', 'propose_open_page', { topic_id: 'https://exemple.test/piege' }),
        ],
      },
      { kind: 'message', content: [text('C’est réservé à l’administrateur de l’application.')] },
    );
    const res = await call(marc.sb, { action: 'chat', message: 'Comment changer la clé de l’assistant ?' });
    const [help, open, trap] = toolResults(env, 1);
    expect(help.topics.find((t) => t.id === 'administration')).toEqual({
      id: 'administration',
      title: 'Administration de l’assistant',
      available: false,
      reason: 'Réservé à l’administrateur de l’application.',
    });
    expect(open.error).toBeTruthy();
    expect(trap.error).toBeTruthy();
    expect((res.message as { meta: { actions: unknown[] } }).meta.actions).toEqual([]);
  });

  it('question sans fiche : l’outil le dit ; la page d’origine est transmise, une page inconnue est ignorée', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    env.anthropic.reply(
      {
        kind: 'message',
        stop_reason: 'tool_use',
        content: [toolUse('t1', 'app_help', { question: 'Comment payer un abonnement premium ?' }), toolUse('t2', 'app_help', { question: null })],
      },
      { kind: 'message', content: [text('Cette fonction n’existe pas dans Cave & Amis.')] },
      { kind: 'message', content: [text('Bonjour.')] },
    );
    await call(bruno.sb, { action: 'chat', message: 'Comment payer un abonnement premium ?', context: { kind: 'page', id: 'evenements' } });
    expect(JSON.stringify(env.anthropic.requests[0].body!.messages)).toContain('depuis la page « Événements »');
    const [none, page] = toolResults(env, 1);
    expect(none.topics).toEqual([]);
    expect(none.note).toContain('n’existe pas');
    expect(page.page).toBe('Événements');
    expect(page.topics.map((t) => t.id)).toEqual(expect.arrayContaining(['organiser-evenement', 'inviter-evenement']));
    // Bruno n'organise aucun événement : y inviter n'est pas possible pour lui.
    expect(page.topics.find((t) => t.id === 'inviter-evenement')).toMatchObject({ available: false });
    await call(bruno.sb, { action: 'chat', message: 'Bonjour', context: { kind: 'page', id: 'constructor' } });
    expect(JSON.stringify(env.anthropic.requests[2].body!.messages)).not.toContain('depuis la page');
  });
});

describe('assistant : identification d’étiquette', () => {
  it('pré-remplit un formulaire, signale l’incertain, laisse vide l’inconnu', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const path = `${bruno.id}/etiquette.jpg`;
    await bruno.sb.storage.from('photos').upload(path, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    env.anthropic.reply({
      kind: 'message',
      content: [
        text(
          JSON.stringify({
            is_wine_label: true,
            fields: { name: 'Château Talbot', domaine: null, producer: 'Château Talbot', cuvee: null, country: 'France', region: 'Bordeaux', appellation: 'Saint-Julien', color: 'rouge', wine_type: 'tranquille', grapes: [], vintage: 2015, non_vintage: false, volume_ml: 750 },
            uncertain: ['region'],
            advice: { drink_from: 2022, drink_until: 2040, serve_temp_min: 16, serve_temp_max: 18, aeration: 'Carafer 1 heure', pairings: null },
            notes: null,
          }),
        ),
      ],
    });
    const res = await call(bruno.sb, { action: 'identify_label', photo_path: path });
    expect(res.ok).toBe(true);
    const result = res.result as { fields: Record<string, unknown>; uncertain: string[]; advice: Record<string, unknown> };
    expect(result.fields).toMatchObject({ name: 'Château Talbot', vintage: 2015, appellation: 'Saint-Julien', cuvee: null });
    expect(result.uncertain).toEqual(['region']);
    expect(result.advice).toMatchObject({ drink_from: 2022, serve_temp_max: 18 });
    // L'image est bien envoyée, avec un format de sortie structuré.
    const sent = env.anthropic.requests[0].body!;
    expect(JSON.stringify(sent.messages)).toContain('"type":"image"');
    expect((sent.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    // Rien n'est enregistré.
    const { data: wines } = await bruno.sb.from('wines').select('*');
    expect(wines).toEqual([]);
  });

  it('lit l’étiquette et la contre-étiquette ensemble, deux photos au plus', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const front = `${bruno.id}/face.jpg`;
    const back = `${bruno.id}/dos.jpg`;
    for (const p of [front, back]) await bruno.sb.storage.from('photos').upload(p, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    const other = `${claire.id}/dos.jpg`;
    await claire.sb.storage.from('photos').upload(other, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    env.anthropic.reply({
      kind: 'message',
      content: [text(JSON.stringify({ is_wine_label: true, fields: { name: 'Château Talbot', grapes: ['Cabernet sauvignon'], volume_ml: 750 }, uncertain: [], advice: {}, notes: '' }))],
    });
    const res = await call(bruno.sb, { action: 'identify_label', photo_paths: [front, back] });
    expect(res.ok).toBe(true);
    expect((res.result as { fields: Record<string, unknown> }).fields).toMatchObject({ name: 'Château Talbot', grapes: ['Cabernet sauvignon'], cuvee: null });
    const sent = JSON.stringify(env.anthropic.requests[0].body!.messages);
    expect(sent.match(/"type":"image"/g)).toHaveLength(2);
    expect(sent).toContain('contre-étiquette');
    // Trois photos, ou une contre-étiquette d'une autre personne : refusé sans appel à Claude.
    expect(await call(bruno.sb, { action: 'identify_label', photo_paths: [front, back, front] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await call(bruno.sb, { action: 'identify_label', photo_paths: [front, other] })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(env.anthropic.requests).toHaveLength(1);
  });

  it('refuse la photo d’une autre personne', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const path = `${claire.id}/privee.jpg`;
    await claire.sb.storage.from('photos').upload(path, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    const res = await call(bruno.sb, { action: 'identify_label', photo_path: path });
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
    expect(env.anthropic.requests).toHaveLength(0);
  });
});

describe('assistant : prix de marché', () => {
  const searchResult = (urls: string[]) => ({
    type: 'web_search_tool_result',
    tool_use_id: 'srv1',
    caller: { type: 'direct' },
    content: urls.map((url) => ({ type: 'web_search_result', url, title: 'Caviste', encrypted_content: 'x', page_age: null })),
  });

  it('ne retient que les offres dont le lien vient de la recherche, puis enregistrement sur confirmation', async () => {
    const env = await makeAiEnv();
    const { bruno, madiran } = await cellarWith(env);
    env.anthropic.reply({
      kind: 'message',
      stop_reason: 'tool_use',
      usage: { web_search_requests: 2 },
      content: [
        { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Montus 2016' }, caller: { type: 'direct' } },
        searchResult(['https://www.caviste.example/montus-2016', 'https://vins.example/madiran/montus-2016/']),
        toolUse('t1', 'report_offers', {
          comment: 'Deux offres',
          offers: [
            { url: 'https://www.caviste.example/montus-2016', title: 'Montus 2016', seller: 'Caviste', price: 39.9, currency: 'EUR', vintage: 2016, volume_ml: 750 },
            { url: 'https://vins.example/madiran/montus-2016', title: 'Montus', seller: 'Vins', price: 45, currency: 'EUR', vintage: 2016, volume_ml: 750 },
            { url: 'https://invente.example/faux', title: 'Inventé', seller: 'X', price: 10, currency: 'EUR', vintage: 2016, volume_ml: 750 },
            { url: 'https://www.caviste.example/montus-2016-magnum', title: 'Magnum', seller: 'Caviste', price: 90, currency: 'EUR', vintage: 2016, volume_ml: 1500 },
          ],
        }),
      ],
    });
    const res = await call(bruno.sb, { action: 'price_lookup', wine_id: madiran.wineId, volume_ml: 750 });
    expect(res.ok).toBe(true);
    const result = res.result as { status: string; low: number; high: number; offers: { url: string }[]; check_id: string };
    expect(result.status).toBe('verified');
    expect(result.offers.map((o) => o.url)).toEqual(['https://www.caviste.example/montus-2016', 'https://vins.example/madiran/montus-2016']);
    expect([result.low, result.high]).toEqual([39.9, 45]);
    const tool = (env.anthropic.requests[0].body!.tools as { type?: string; max_uses?: number }[]).find((t) => t.type?.startsWith('web_search'));
    expect(tool).toMatchObject({ type: 'web_search_20260209', max_uses: 3 });
    // Pas de prix de marché tant que la personne ne l'a pas enregistré.
    expect((await bruno.sb.from('market_prices').select('*')).data).toEqual([]);
    const { data: saved, error } = await bruno.sb.rpc('save_price_check', { p_check: result.check_id });
    expect(error).toBeNull();
    expect(saved).toMatchObject({ method: 'web', price_low: 39.9, price_high: 45 });
    const usage = await usageRows(env);
    // 2 recherches à 10 $ les 1 000 = 0,02 $ en plus des jetons.
    expect(Number(usage[0].cost_usd)).toBeGreaterThan(0.02);
  });

  it('sans recherche web : « prix non vérifié », aucun appel à l’API', async () => {
    const env = await makeAiEnv();
    const { bruno, madiran } = await cellarWith(env);
    await setSettings(env, { web_search_enabled: false });
    const res = await call(bruno.sb, { action: 'price_lookup', wine_id: madiran.wineId });
    const result = res.result as { status: string; reason: string; check_id: string };
    expect(result.status).toBe('unverified');
    expect(result.reason).toMatch(/désactivée/);
    expect(env.anthropic.requests).toHaveLength(0);
    const { error } = await bruno.sb.rpc('save_price_check', { p_check: result.check_id });
    expect(error?.message).toBe('price_unverified');
  });

  it('aucune offre vérifiable : « prix non vérifié », jamais de prix inventé', async () => {
    const env = await makeAiEnv();
    const { bruno, madiran } = await cellarWith(env);
    env.anthropic.reply({
      kind: 'message',
      stop_reason: 'tool_use',
      content: [toolUse('t1', 'report_offers', { comment: 'Rien', offers: [{ url: 'https://invente.example/x', title: 'x', seller: 'x', price: 12, currency: 'EUR', vintage: 2016, volume_ml: 750 }] })],
    });
    const res = await call(bruno.sb, { action: 'price_lookup', wine_id: madiran.wineId });
    expect(res.result).toMatchObject({ status: 'unverified', low: null, offers: [] });
  });

  it('impossible de chercher le prix du vin d’un autre', async () => {
    const env = await makeAiEnv();
    const { bruno, privateClaire } = await cellarWith(env);
    expect(await call(bruno.sb, { action: 'price_lookup', wine_id: privateClaire.wineId })).toMatchObject({ ok: false, code: 'not_found' });
  });
});
