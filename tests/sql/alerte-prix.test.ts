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
    await expectError(one(db, bruno, `select record_price_watch($1, 'verified', 1, 'EUR')`, [bruno]), /permission denied/);
    // Première vérification sans référence : elle devient la référence, sans alerte.
    expect((await asService<{ s: string }>(db, `select record_price_watch($1, 'verified', 40, 'EUR') as s`, [bruno]))[0].s).toBe('not_lower');
    expect((await asService<{ s: string }>(db, `select record_price_watch($1, 'verified', 35, 'EUR') as s`, [bruno]))[0].s).toBe('lower');
    // Autre devise : pas de comparaison.
    expect((await asService<{ s: string }>(db, `select record_price_watch($1, 'verified', 10, 'CHF') as s`, [bruno]))[0].s).toBe('not_lower');
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
    expect(await begin('price', 0.3)).toMatchObject({ ok: true });
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
