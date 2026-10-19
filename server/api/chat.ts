/** Conversation avec l'assistant : historique de la conversation, outils, propositions à confirmer. */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { baseParams, textOf, type Meter } from './claude.ts';
import { CHAT_SYSTEM } from './prompts.ts';
import { CHAT_TOOLS, ToolBox } from './tools.ts';
import { AiFailure, isUuid, sanitize, todayParis } from './util.ts';

export type ChatInput = { conversation_id?: string | null; message: string; context?: { kind: 'wine' | 'event'; id: string } | null };

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown>; created_at: string };

const STOP_NOTES: Record<string, string> = {
  max_tokens: '\n\n_(Réponse coupée : elle dépassait la longueur maximale autorisée.)_',
  call_limit: '\n\n_(Je me suis arrêté là : la demande nécessitait trop d’étapes. Posez une question plus précise si besoin.)_',
  budget: '\n\n_(Réponse interrompue : la limite d’utilisation de l’assistant est atteinte.)_',
};

export async function runChat(o: {
  input: ChatInput;
  user: SupabaseClient;
  svc: SupabaseClient;
  meter: Meter;
  userId: string;
  currency: string;
  now: Date;
}): Promise<{ conversation_id: string; message: ChatMessage }> {
  const { input, user, svc, meter, userId } = o;
  const settings = meter.settings;
  const message = String(input.message ?? '').trim();

  // Conversation existante (lue avec les droits de la personne : impossible d'ouvrir celle d'un autre).
  let conversationId: string | null = null;
  let history: { role: 'user' | 'assistant'; content: string }[] = [];
  if (input.conversation_id) {
    if (!isUuid(input.conversation_id)) throw new AiFailure('invalid');
    const { data } = await user.from('ai_conversations').select('id').eq('id', input.conversation_id).maybeSingle();
    if (!data) throw new AiFailure('not_found');
    conversationId = input.conversation_id;
    const { data: historyRows } = await user
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(settings.history_messages);
    history = ((historyRows ?? []) as typeof history).reverse();
  }
  const context = input.context && isUuid(input.context.id) && ['wine', 'event'].includes(input.context.kind) ? input.context : null;

  const box = new ToolBox({ user, svc, meter, userId, currency: o.currency, year: Number(o.now.getFullYear()) });
  const contextNote = await box.contextNote(context);

  // L'historique ne contient que du texte (alternance utilisateur / assistant), puis la nouvelle question.
  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const h of history) {
    const last = messages[messages.length - 1];
    if (last && last.role === h.role) last.content = `${last.content as string}

${h.content}`;
    else messages.push({ role: h.role, content: h.content });
  }
  if (messages[0]?.role === 'assistant') messages.shift();
  const turn: Anthropic.Messages.TextBlockParam[] = [{ type: 'text', text: `[Informations de l’application — date du jour : ${todayParis(o.now)}${contextNote ? ` ; ${contextNote}` : ''}]` }];
  turn.push({ type: 'text', text: message });
  messages.push({ role: 'user', content: turn });
  const request = (): Anthropic.Messages.MessageCreateParamsNonStreaming => ({
    ...baseParams(settings),
    system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: CHAT_TOOLS,
    messages,
  });

  // Contrôle des quotas et du budget AVANT d'enregistrer quoi que ce soit, avec l'enveloppe exacte du premier appel.
  await meter.start(meter.bound(request()));

  if (!conversationId) {
    const { data, error } = await svc
      .from('ai_conversations')
      .insert({ user_id: userId, title: sanitize(message, 70) || 'Conversation', context_kind: context?.kind ?? null, context_id: context?.id ?? null })
      .select('id')
      .single();
    if (error) throw new AiFailure('internal', sanitize(error.message));
    conversationId = (data as { id: string }).id;
  }
  const { error: insErr } = await svc.from('ai_messages').insert({ conversation_id: conversationId, user_id: userId, role: 'user', content: message });
  if (insErr) throw new AiFailure('internal', sanitize(insErr.message));

  let answer = '';
  let note = '';
  try {
    for (;;) {
      const res = await meter.call(request());
      const text = textOf(res);
      if (text) answer = text;
      if (res.stop_reason === 'refusal') {
        answer = answer || 'Je ne peux pas répondre à cette demande. Pouvez-vous la reformuler ?';
        break;
      }
      if (res.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: res.content });
        continue;
      }
      if (res.stop_reason !== 'tool_use') {
        if (res.stop_reason === 'max_tokens') note = STOP_NOTES.max_tokens;
        break;
      }
      const calls = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const r = await box.run(call.name, call.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (!(e instanceof AiFailure)) throw e;
    if (e.code === 'call_limit') note = STOP_NOTES.call_limit;
    else if (['budget_exhausted', 'quota_monthly'].includes(e.code) && answer) note = STOP_NOTES.budget;
    else throw e;
  }

  if (!answer) answer = box.actions.length ? 'Voici ma proposition : confirmez-la ci-dessous si elle vous convient.' : 'Je n’ai pas pu formuler de réponse. Pouvez-vous préciser votre question ?';
  const meta = {
    actions: box.actions,
    sources: box.sources,
    prices: box.prices.map((p) => ({ status: p.status, wine_id: p.wine_id, low: p.low, high: p.high, currency: p.currency, checked_at: p.checked_at, reason: p.reason })),
    tools: [...new Set(box.used)],
    web_searches: meter.searches,
  };
  const { data: saved, error } = await svc
    .from('ai_messages')
    .insert({ conversation_id: conversationId!, user_id: userId, role: 'assistant', content: `${answer}${note}`.slice(0, 40000), meta })
    .select('*')
    .single();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  await svc.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  return { conversation_id: conversationId!, message: saved as ChatMessage };
}
