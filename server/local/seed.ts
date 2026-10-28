/**
 * Données de DÉMONSTRATION du serveur local (npm run local -- --demo). Jamais utilisées en production.
 * Comptes clairement marqués « (démo) », adresses en @demo.local.
 */
import type { PGlite } from '@electric-sql/pglite';

export const DEMO_PASSWORD = 'demo-cave-2026';
export const DEMO_PEOPLE = [
  { key: 'alex', name: 'Alex (démo)', email: 'alex@demo.local' },
  { key: 'camille', name: 'Camille (démo)', email: 'camille@demo.local' },
  { key: 'sam', name: 'Sam (démo)', email: 'sam@demo.local' },
];

export async function seedDemo(db: PGlite) {
  const ids: Record<string, string> = {};
  for (const p of DEMO_PEOPLE) {
    const id = crypto.randomUUID();
    ids[p.key] = id;
    await db.query(
      `insert into auth.users (id, email, password_hash, raw_user_meta_data)
       values ($1::uuid, $2, encode(sha256(convert_to($1::text || ':' || $3, 'UTF8')), 'hex'), $4)`,
      [id, p.email, DEMO_PASSWORD, JSON.stringify({ display_name: p.name })],
    );
  }

  const as = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec('set local role authenticated');
      return (await tx.query<T>(sql, params)).rows;
    });
  const one = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];

  const { alex, camille, sam } = ids;
  // Camille : amie, les deux caves ouvertes l'une à l'autre. Sam : simple contact (aucune cave ouverte), qui a demandé
  // à voir celle d'Alex.
  const friendLink = await one<{ r: { code: string } }>(alex, `select create_invite('friend') as r`);
  await one(camille, `select respond_friend_invite($1, true)`, [friendLink.r.code]);
  await one(camille, `select grant_cellar_access($1)`, [alex]);
  const discoveryLink = await one<{ r: { code: string } }>(alex, `select create_invite('discovery') as r`);
  await one(sam, `select respond_friend_invite($1, true)`, [discoveryLink.r.code]);
  await one(sam, `select request_cellar_access($1)`, [alex]);

  const cellar = (await one<{ id: string }>(alex, `update cellars set name = 'Cave de la maison', storage = 'cave' returning id`)).id;
  const casier = (await one<{ id: string }>(alex, `insert into locations (cellar_id, name, kind) values ($1, 'Casier A', 'casier') returning id`, [cellar])).id;
  const etagere = (await one<{ id: string }>(alex, `insert into locations (cellar_id, name, kind) values ($1, 'Étagère du haut', 'etagere') returning id`, [cellar])).id;

  const wine = async (user: string, w: Record<string, unknown>) => {
    const cols = Object.keys(w);
    return (await one<{ id: string }>(user, `insert into wines (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(w))).id;
  };
  const lot = async (user: string, l: Record<string, unknown>) =>
    (await one<{ r: { id: string } }>(user, `select to_json(create_lot($1::jsonb, gen_random_uuid())) as r`, [JSON.stringify(l)])).r.id;

  const talbot = await wine(alex, {
    name: 'Château Talbot',
    producer: 'Château Talbot',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Saint-Julien',
    color: 'rouge',
    wine_type: 'tranquille',
    grapes: '{Cabernet sauvignon,Merlot}',
    vintage: 2015,
    drink_from: 2023,
    drink_until: 2038,
    window_source: 'ai',
    notes: 'Acheté à la foire aux vins.',
  });
  await lot(alex, { wine_id: talbot, cellar_id: cellar, location_id: casier, quantity: 6, purchase_price: 42, purchase_date: '2023-09-20', purchase_place: 'Foire aux vins' });
  const talbotShared = await lot(alex, { wine_id: talbot, cellar_id: cellar, location_id: etagere, quantity: 3, purchase_price: 48, visibility: 'event' });
  const sancerre = await wine(alex, { name: 'Sancerre blanc', appellation: 'Sancerre', region: 'Loire', country: 'France', color: 'blanc', wine_type: 'tranquille', grapes: '{Sauvignon blanc}', vintage: 2022 });
  await lot(alex, { wine_id: sancerre, cellar_id: cellar, location_id: etagere, quantity: 4, purchase_price: 19, visibility: 'friends' });
  const champagne = await wine(alex, { name: 'Champagne Brut Réserve', appellation: 'Champagne', region: 'Champagne', country: 'France', color: 'effervescent', wine_type: 'effervescent', non_vintage: true });
  await lot(alex, { wine_id: champagne, cellar_id: cellar, location_id: casier, quantity: 2, purchase_price: 35 });
  const morgon = await wine(alex, { name: 'Morgon Côte du Py', appellation: 'Morgon', region: 'Beaujolais', country: 'France', color: 'rouge', wine_type: 'tranquille', grapes: '{Gamay}', vintage: 2020, favorite: true });
  await lot(alex, { wine_id: morgon, cellar_id: cellar, location_id: casier, quantity: 5, purchase_price: 17, visibility: 'friends', hide_price: true });
  const jurancon = await wine(alex, { name: 'Jurançon moelleux', appellation: 'Jurançon', region: 'Sud-Ouest', country: 'France', color: 'blanc', wine_type: 'moelleux', grapes: '{Petit manseng}', vintage: 2018 });
  await lot(alex, { wine_id: jurancon, cellar_id: cellar, quantity: 1, purchase_price: 24 });
  await as(alex, `insert into market_prices (wine_id, volume_ml, price_low, price_high, method, note, checked_at) values ($1, 750, 55, 70, 'manual', 'Relevé noté à la main (démo)', now() - interval '20 days')`, [talbot]);
  // Relevés plus anciens (démo) : la courbe d'évolution du prix a de quoi s'afficher.
  for (const [low, high, ago] of [[48, 58, 700], [52, 62, 400], [60, 74, 200], [58, 70, 90]] as const) {
    await as(alex, `insert into market_prices (wine_id, volume_ml, price_low, price_high, method, note, checked_at) values ($1, 750, $2, $3, 'manual', 'Relevé de démonstration', now() - make_interval(days => $4))`, [talbot, low, high, ago]);
  }

  const camilleCellar = (await one<{ id: string }>(camille, `select id from cellars`)).id;
  const meursault = await wine(camille, { name: 'Meursault', appellation: 'Meursault', region: 'Bourgogne', country: 'France', color: 'blanc', wine_type: 'tranquille', grapes: '{Chardonnay}', vintage: 2019 });
  const meursaultLot = await lot(camille, { wine_id: meursault, cellar_id: camilleCellar, quantity: 3, purchase_price: 58, visibility: 'event', hide_quantity: true });
  const crozes = await wine(camille, { name: 'Crozes-Hermitage', appellation: 'Crozes-Hermitage', region: 'Rhône', country: 'France', color: 'rouge', grapes: '{Syrah}', vintage: 2020 });
  await lot(camille, { wine_id: crozes, cellar_id: camilleCellar, quantity: 6, purchase_price: 21, visibility: 'friends', hide_price: false, notes: 'Très bon sur une côte de bœuf.', hide_notes: false });
  const secret = await wine(camille, { name: 'Bouteille privée de Camille', color: 'rouge', vintage: 2005 });
  await lot(camille, { wine_id: secret, cellar_id: camilleCellar, quantity: 1, purchase_price: 120 });
  // Partagée avec ses amis, mais Sam n'a ouvert sa cave à personne : Alex ne la voit pas.
  const samCellar = (await one<{ id: string }>(sam, `select id from cellars`)).id;
  const bandol = await wine(sam, { name: 'Bandol rouge', appellation: 'Bandol', region: 'Provence', country: 'France', color: 'rouge', grapes: '{Mourvèdre}', vintage: 2019 });
  await lot(sam, { wine_id: bandol, cellar_id: samCellar, quantity: 4, visibility: 'friends' });

  const inTenDays = new Date(Date.now() + 10 * 86400_000);
  inTenDays.setUTCHours(18, 0, 0, 0);
  const event = (
    await one<{ r: { id: string } }>(alex, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ kind: 'diner', title: 'Dîner d’automne', starts_at: inTenDays.toISOString(), place: 'Chez Alex', theme: 'Cuisine du Sud-Ouest', description: 'Exemple de démonstration.' }),
      `{${camille},${sam}}`,
    ])
  ).r.id;
  await one(camille, `select respond_event($1, 'yes')`, [event]);
  for (const [course, name, pos] of [
    ['entree', 'Velouté de potimarron', 1],
    ['plat', 'Magret de canard, pommes sarladaises', 2],
    ['dessert', 'Tarte Tatin', 3],
  ] as const) {
    await as(alex, `insert into event_dishes (event_id, course, name, position) values ($1, $2, $3, $4)`, [event, course, name, pos]);
  }
  await one(alex, `select propose_event_wine($1, $2, 1, 'Pour le magret', true, gen_random_uuid())`, [event, talbotShared]);
  await one(alex, `select propose_event_wine($1, $2, 1, 'Avec le velouté ?', false, gen_random_uuid())`, [event, meursaultLot]);

  // Mode soirée (démo) : une dégustation à l'aveugle commencée il y a une heure, deux bouteilles d'Alex, quelques messages.
  const tonight = (
    await one<{ r: { id: string } }>(alex, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ kind: 'degustation', title: 'Dégustation à l’aveugle', starts_at: new Date(Date.now() - 3600_000).toISOString(), place: 'Chez Alex' }),
      `{${camille},${sam}}`,
    ])
  ).r.id;
  await one(camille, `select respond_event($1, 'yes')`, [tonight]);
  await one(sam, `select respond_event($1, 'yes')`, [tonight]);
  const blindWines: string[] = [];
  for (const name of ['Morgon Côte du Py', 'Jurançon moelleux']) {
    const l = await one<{ id: string }>(alex, `select l.id from lots l join wines w on w.id = l.wine_id where w.name = $1 limit 1`, [name]);
    blindWines.push((await one<{ r: { id: string } }>(alex, `select to_json(propose_event_wine($1, $2, 1, null, true, gen_random_uuid())) as r`, [tonight, l.id])).r.id);
  }
  await one(alex, `select start_event_live($1, true)`, [tonight]);
  await one(alex, `select event_live_serve($1, $2)`, [tonight, blindWines[0]]);
  for (const [who, body] of [
    [camille, 'Belle surprise !'],
    [sam, 'Je pense à un gamay ?'],
    [camille, 'Très fruité, belle longueur.'],
  ] as const) {
    await one(who, `select post_event_message($1, $2)`, [tonight, body]);
  }
  await one(camille, `select vote_event_wine($1, 4::smallint)`, [blindWines[0]]);

  // Achat groupé (démo), dans un groupe d'Alex et Camille.
  const copains = (await one<{ id: string }>(alex, `select (create_group('Les copains (démo)', '🍷', null, null, $1::uuid[])).id`, [[camille]])).id;
  await one(camille, `select respond_group_invite($1, true)`, [copains]);
  const purchase = (await one<{ r: { id: string } }>(alex, `select to_json(create_group_purchase($1, $2::jsonb)) as r`, [copains, JSON.stringify({ title: 'Bourgogne', budget: 500 })])).r.id;
  for (const [name, vintage, price, bottles, alexPart, camillePart] of [
    ['Domaine du Val', 2022, 30, 4, 2, 1],
    ['Clos Saint-Roch', 2022, 30, 3, 1, 1],
    ['Côte des Ormes', 2022, 80, 2, 0, 1],
  ] as const) {
    const item = (await one<{ r: { id: string } }>(alex, `select to_json(add_group_purchase_item($1, $2::jsonb)) as r`, [purchase, JSON.stringify({ wine_name: name, vintage, unit_price: price, bottles, color: 'rouge' })])).r.id;
    if (alexPart) await one(alex, `select set_purchase_part($1, $2)`, [item, alexPart]);
    if (camillePart) await one(camille, `select set_purchase_part($1, $2)`, [item, camillePart]);
  }
  await one(camille, `select validate_purchase_parts($1, true)`, [purchase]);

  const tasting = async (user: string, t: Record<string, unknown>) => one(user, `select create_tasting($1::jsonb, null, gen_random_uuid())`, [JSON.stringify(t)]);
  await tasting(alex, {
    wine_name: 'Pouilly-Fumé',
    vintage: 2021,
    color: 'blanc',
    region: 'Loire',
    occasion: 'restaurant',
    place: 'Bistrot du marché',
    rating: 4,
    comment: 'Très frais, agrumes et pierre à fusil.',
    acidite: 'vive',
    dish: 'Dos de cabillaud',
    price_paid: 9,
    price_kind: 'verre',
    rebuy: true,
  });
  await tasting(alex, {
    wine_name: 'Barolo',
    vintage: 2016,
    color: 'rouge',
    region: 'Piémont',
    occasion: 'amis',
    place: 'Chez Camille',
    rating: 5,
    comment: 'Rose fanée, cerise, tanins fins. Magnifique.',
    tanins: 'presents',
    longueur: 'longue',
    favorite: true,
  });
  await as(alex, `insert into wishlist (wine_name, region, color, note) values ('Côte-Rôtie', 'Rhône', 'rouge', 'Goûté au salon des vins')`);
  return ids;
}
