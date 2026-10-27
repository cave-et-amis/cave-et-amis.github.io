import { describe, expect, it } from 'vitest';
import { text, toolUse } from '../helpers/anthropicMock.ts';
import { call, makeAiEnv } from './setup.ts';

describe('Lia et le profil de goûts (mission C)', () => {
  it('get_my_taste : préférences déclarées et traits du carnet de la personne, rien d’un autre compte', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const taste = (who: typeof bruno, p: Record<string, unknown>) =>
      who.sb.rpc('create_tasting', { p: { wine_name: 'Vin', ...p }, p_consume_lot: null, p_request: crypto.randomUUID() });
    expect((await taste(bruno, { rating: 5, color: 'rouge', region: 'Bourgogne' })).error).toBeNull();
    expect((await taste(bruno, { rating: 4, color: 'rouge', region: 'Bourgogne' })).error).toBeNull();
    expect((await taste(claire, { rating: 5, color: 'blanc', region: 'REPERE-CLAIRE' })).error).toBeNull();
    expect((await taste(claire, { rating: 5, color: 'blanc', region: 'REPERE-CLAIRE' })).error).toBeNull();
    expect((await bruno.sb.from('taste_profiles').insert({ likes: ['Pinot noir'], dislikes: ['Boisé marqué'], ignored: ['couleur:rouge'] })).error).toBeNull();
    expect((await claire.sb.from('taste_profiles').insert({ likes: ['SECRET-CLAIRE'] })).error).toBeNull();

    env.anthropic.reply(
      { kind: 'message', stop_reason: 'tool_use', content: [toolUse('t1', 'get_my_taste', {})] },
      { kind: 'message', content: [text('Vous aimez le pinot noir de Bourgogne.')] },
    );
    const res = await call(bruno.sb, { action: 'chat', message: 'Que boire ce soir selon mes goûts ?' });
    expect(res.ok).toBe(true);
    const result = JSON.parse(
      ((env.anthropic.requests[1].body!.messages as { content: { type: string; content: string }[] }[]).at(-1)!.content.find((c) => c.type === 'tool_result')!).content,
    );
    expect(result.declared).toEqual({ likes: ['Pinot noir'], dislikes: ['Boisé marqué'], budget_max: null, note: null });
    // Couleur écartée par Bruno : seule la région reste.
    expect(result.from_tastings).toEqual({ rated_tastings: 2, likes: [{ trait: 'Bourgogne', type: 'region', tastings: 2, average_rating: 4.5 }], dislikes: [] });
    const all = JSON.stringify(env.anthropic.requests.map((r) => r.body));
    expect(all).not.toContain('SECRET-CLAIRE');
    expect(all).not.toContain('REPERE-CLAIRE');
  });
});
