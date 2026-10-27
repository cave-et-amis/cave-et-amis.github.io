import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
});

const createTasting = (user: string, p: Record<string, unknown>, lot: string | null = null, req = rid()) =>
  one<{ r: Record<string, unknown> }>(db, user, `select to_json(create_tasting($1::jsonb, $2, $3)) as r`, [JSON.stringify(p), lot, req]).then((x) => x.r);

describe('carnet de dégustation', () => {
  it('une dégustation au restaurant ne modifie pas le stock', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Pouilly-Fumé' }, { quantity: 4 });
    const t = await createTasting(bruno, {
      wine_name: 'Pouilly-Fumé',
      vintage: 2021,
      occasion: 'restaurant',
      place: 'Le Bistrot',
      rating: 4,
      price_paid: 9,
      price_kind: 'verre',
      acidite: 'vive',
      rebuy: true,
    });
    expect(t).toMatchObject({ wine_name: 'Pouilly-Fumé', rating: 4, rebuy: true, movement_id: null });
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
  });

  it('bouteille de ma cave : le stock baisse seulement si je l’indique, une seule fois', async () => {
    const { lotId, wineId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 4 });
    const req = rid();
    const t = await createTasting(bruno, { wine_name: 'Morgon', occasion: 'maison' }, lotId, req);
    expect(t.wine_id).toBe(wineId);
    expect(t.movement_id).not.toBeNull();
    await createTasting(bruno, { wine_name: 'Morgon', occasion: 'maison' }, lotId, req);
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 0 });
    expect((await as(db, bruno, `select * from tastings`)).length).toBe(1);
  });

  it('impossible de déclarer une bouteille de la cave d’un autre', async () => {
    const { lotId } = await addWine(db, claire, { name: 'Morgon' }, { quantity: 4 });
    await expectError(createTasting(bruno, { wine_name: 'Morgon' }, lotId), /not_found/);
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
  });

  it('notes privées par défaut ; partage possible avec les participants d’un événement', async () => {
    await befriend(db, bruno, claire);
    const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ title: 'Dégustation', kind: 'degustation', starts_at: new Date().toISOString() }),
      `{${claire}}`,
    ]);
    await createTasting(bruno, { wine_name: 'Privée', event_id: ev.r.id });
    await createTasting(bruno, { wine_name: 'Partagée', event_id: ev.r.id, share_with_event: true, comment: 'Très belle' });
    // Les notes partagées se lisent par event_tastings (sans le prix payé), jamais dans la table.
    expect(await as(db, claire, `select wine_name from tastings`)).toEqual([]);
    const seen = await as<{ wine_name: string }>(db, claire, `select wine_name from event_tastings($1)`, [ev.r.id]);
    expect(seen.map((s) => s.wine_name)).toEqual(['Partagée']);
    await expectError(createTasting(claire, { wine_name: 'X', event_id: crypto.randomUUID() }), /not_participant/);
    // Partage impossible sans événement.
    await expectError(createTasting(bruno, { wine_name: 'Seule', share_with_event: true }), /check constraint/);
  });

  it('liste d’envies personnelle', async () => {
    await as(db, bruno, `insert into wishlist (wine_name, region) values ('Côte-Rôtie', 'Rhône')`);
    expect((await as(db, bruno, `select * from wishlist`)).length).toBe(1);
    expect(await as(db, claire, `select * from wishlist`)).toEqual([]);
  });
});

describe('prix de marché', () => {
  it('saisie manuelle autorisée, relevé « web » réservé au serveur', async () => {
    const { wineId } = await addWine(db, bruno, { name: 'Talbot', vintage: 2015 });
    await as(db, bruno, `insert into market_prices (wine_id, price_low, price_high, method) values ($1, 40, 55, 'manual')`, [wineId]);
    await expectError(
      as(db, bruno, `insert into market_prices (wine_id, price_low, price_high, method, sources) values ($1, 40, 55, 'web', '[{"url":"https://exemple.fr"}]')`, [wineId]),
      /row-level security/,
    );
    await expectError(as(db, bruno, `insert into price_checks (user_id, wine_id, volume_ml, status) values (auth.uid(), $1, 750, 'unverified')`, [wineId]), /permission denied/);
  });

  it('un relevé vérifié par le serveur peut être enregistré une fois par son propriétaire', async () => {
    const { wineId } = await addWine(db, bruno, { name: 'Talbot', vintage: 2015 });
    const check = (
      await db.query<{ id: string }>(
        `insert into price_checks (user_id, wine_id, volume_ml, status, currency, price_low, price_high, offers)
         values ($1, $2, 750, 'verified', 'EUR', 48, 62, '[{"url":"https://caviste.example/talbot-2015","title":"Caviste","price":48,"currency":"EUR"}]') returning id`,
        [bruno, wineId],
      )
    ).rows[0].id;
    await expectError(one(db, claire, `select save_price_check($1)`, [check]), /not_found/);
    const a = await one<{ r: { id: string; method: string } }>(db, bruno, `select to_json(save_price_check($1)) as r`, [check]);
    const b = await one<{ r: { id: string } }>(db, bruno, `select to_json(save_price_check($1)) as r`, [check]);
    expect(a.r.method).toBe('web');
    expect(a.r.id).toBe(b.r.id);
  });

  it('un relevé non vérifié ne peut pas devenir un prix de marché', async () => {
    const { wineId } = await addWine(db, bruno, { name: 'Talbot', vintage: 2015 });
    const check = (
      await db.query<{ id: string }>(
        `insert into price_checks (user_id, wine_id, volume_ml, status, reason) values ($1, $2, 750, 'unverified', 'Recherche indisponible') returning id`,
        [bruno, wineId],
      )
    ).rows[0].id;
    await expectError(one(db, bruno, `select save_price_check($1)`, [check]), /price_unverified/);
  });
});
