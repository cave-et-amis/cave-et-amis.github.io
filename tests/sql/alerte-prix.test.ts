import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, asService, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
});

describe('alerte de baisse de prix : base', () => {
  it('réservée au serveur pour la liste et le résultat ; dans l’export de mes données', async () => {
    const { wineId } = await addWine(db, bruno, { name: 'Montus', vintage: 2016 });
    await one(db, bruno, `select set_price_watch($1, 750)`, [wineId]);
    await expectError(one(db, bruno, `select * from price_watches_due(10)`), /permission denied/);
    await expectError(one(db, bruno, `select record_price_watch($1, $2, 'verified', 1, 'EUR')`, [bruno, wineId]), /permission denied/);
    const rec = async (low: number, currency: string, wine = wineId) =>
      (await asService<{ s: string | null }>(db, `select record_price_watch($1, $2, 'verified', $3, $4) as s`, [bruno, wine, low, currency]))[0].s;
    // Première vérification sans référence : elle devient la référence, sans alerte.
    expect(await rec(40, 'EUR')).toBe('not_lower');
    expect(await rec(35, 'EUR')).toBe('lower');
    // Autre devise : pas de comparaison.
    expect(await rec(10, 'CHF')).toBe('not_lower');
    // Vin changé pendant la vérification : le résultat de l'ancien vin est ignoré.
    const { wineId: other } = await addWine(db, bruno, { name: 'Madiran', vintage: 2018 });
    expect(await rec(1, 'EUR', other)).toBeNull();
    const d = (await one<{ d: { alerte_de_prix: { vin: string; reference_price: number } } }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d.alerte_de_prix.vin).toBe('Montus 2016');
    expect(Number(d.alerte_de_prix.reference_price)).toBe(35);
    expect(d).toHaveProperty('parts_d_achats_groupes');
  });

  it('plafond des alertes : vérifié par ai_begin, avec le budget global', async () => {
    await asService(db, `update ai_settings set price_alert_budget_usd = 0.5`);
    const begin = async (action: string, amount: number) => (await asService<{ r: { ok: boolean; code?: string } }>(db, `select ai_begin($1, $2, 'claude-sonnet-5-5', $3) as r`, [bruno, action, amount]))[0].r;
    expect(await begin('price_alert', 0.3)).toMatchObject({ ok: true });
    expect(await begin('price_alert', 0.3)).toMatchObject({ ok: false, code: 'price_alert_budget' });
    // Les autres usages de l'assistant ne sont pas concernés par ce plafond.
    const other = (await begin('price', 0.3)) as { ok: boolean; usage_id?: string };
    expect(other).toMatchObject({ ok: true });
    // Les appels suivants d'une même alerte : le plafond vaut aussi (0,3 + 0,15 + 0,1 > 0,5).
    const first = (await asService<{ id: string }>(db, `select id from ai_usage where action = 'price_alert'`))[0].id;
    const more = async (id: string, amount: number) => (await asService<{ r: { ok: boolean; code?: string } }>(db, `select ai_reserve_more($1, $2) as r`, [id, amount]))[0].r;
    expect(await more(first, 0.15)).toMatchObject({ ok: true });
    expect(await more(first, 0.1)).toMatchObject({ ok: false, code: 'price_alert_budget' });
    expect(await more(other.usage_id!, 0.1)).toMatchObject({ ok: true });
  });

  it('retour arrière : état d’avant, export et réservation compris', async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000008.sql'), 'utf8'));
    const d = (await one<{ d: Record<string, unknown> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d).not.toHaveProperty('alerte_de_prix');
    expect(d).toHaveProperty('parts_d_achats_groupes');
    const r = (await asService<{ r: { ok: boolean } }>(db, `select ai_begin($1, 'price', 'claude-sonnet-5-5', 0.1) as r`, [bruno]))[0].r;
    expect(r.ok).toBe(true);
  });
});
