import { describe, expect, it } from 'vitest';
import { TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv } from './setup.ts';

describe('suppression de compte', () => {
  it('fonctionne avec des bouteilles, des photos et des réservations ; les autres gardent leurs événements', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const { data: inv } = await bruno.sb.rpc('create_friend_invite');
    await claire.sb.rpc('respond_friend_invite', { p_code: (inv as { code: string }).code, p_accept: true });

    // Claire : une cave avec photo (référencée) et une photo orpheline.
    const used = `${claire.id}/etiquette.jpg`;
    const orphan = `${claire.id}/orpheline.jpg`;
    for (const p of [used, orphan]) {
      const up = await claire.sb.storage.from('photos').upload(p, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
      expect(up.error).toBeNull();
    }
    const { data: w } = await claire.sb.from('wines').insert({ name: 'Vin de Claire', label_photo: used }).select().single();
    const { data: lot } = await claire.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 4, visibility: 'event' }, p_request: crypto.randomUUID() });

    // Bruno organise ; Claire apporte une bouteille ; Bruno apporte la sienne, suggérée… par Claire.
    const { data: brunoWine } = await bruno.sb.from('wines').insert({ name: 'Vin de Bruno' }).select().single();
    const { data: brunoLot } = await bruno.sb.rpc('create_lot', { p: { wine_id: brunoWine.id, quantity: 3, visibility: 'event' }, p_request: crypto.randomUUID() });
    const { data: ev } = await bruno.sb.rpc('create_event', { p: { title: 'Dîner', starts_at: new Date(Date.now() + 86400_000).toISOString() }, p_guests: [claire.id] });
    const evId = (ev as { id: string }).id;
    const own = await claire.sb.rpc('propose_event_wine', { p_event: evId, p_lot: (lot as { id: string }).id, p_quantity: 1, p_note: null, p_bring: true, p_request: crypto.randomUUID() });
    expect(own.error).toBeNull();
    const sug = await claire.sb.rpc('propose_event_wine', { p_event: evId, p_lot: (brunoLot as { id: string }).id, p_quantity: 2, p_note: null, p_bring: false, p_request: crypto.randomUUID() });
    expect(sug.error).toBeNull();
    const conf = await bruno.sb.rpc('confirm_event_wine', { p_id: (sug.data as { id: string }).id, p_quantity: null });
    expect(conf.error).toBeNull();

    expect(await call(claire.sb, { action: 'delete_account', confirm: 'non', password: claire.password })).toMatchObject({ ok: false, code: 'invalid' });
    // Mot de passe exigé et vérifié : sans lui, ou faux, rien n'est supprimé (audit, S6).
    expect(await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER' })).toMatchObject({ ok: false, code: 'invalid_password' });
    expect(await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: 'pas-le-bon-1' })).toMatchObject({ ok: false, code: 'invalid_password' });
    expect((await env.db.query(`select 1 from wines where owner_id = $1`, [claire.id])).rows).toHaveLength(1);
    const res = await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: claire.password });
    expect(res).toMatchObject({ ok: true, deleted: true });

    // Plus de compte, plus de données, plus aucune photo dans son dossier.
    expect((await env.db.query(`select 1 from auth.users where id = $1`, [claire.id])).rows).toHaveLength(0);
    expect((await env.db.query(`select 1 from wines where owner_id = $1`, [claire.id])).rows).toHaveLength(0);
    expect((await env.db.query(`select name from storage.objects where name like $1`, [`${claire.id}/%`])).rows).toHaveLength(0);
    expect((await env.db.query(`select name from storage_local.blobs where name like $1`, [`${claire.id}/%`])).rows).toHaveLength(0);

    // Chez Bruno, la notification reste, avec « Ancien membre » à la place du prénom de Claire (audit, R5).
    const { data: notes } = await bruno.sb.from('notifications').select('kind, actor_name').eq('kind', 'invite_joined');
    expect(notes).toEqual([{ kind: 'invite_joined', actor_name: 'Ancien membre' }]);

    // La bouteille de Bruno suggérée par Claire reste prévue et réservée.
    const rows = (await env.db.query<{ status: string; proposed_by: string | null }>(`select status, proposed_by from event_wines where owner_id = $1`, [bruno.id])).rows;
    expect(rows).toEqual([{ status: 'confirmed', proposed_by: null }]);
    const stock = (await env.db.query<{ reserved: number }>(`select reserved from lots where id = $1`, [(brunoLot as { id: string }).id])).rows[0];
    expect(stock.reserved).toBe(2);
  });

  it('photos : suppression vérifiée, un nouvel essai ; ce qui reste est noté sans nom de fichier, le compte est bien supprimé (audit, R5)', async () => {
    // Le stockage refuse les `failures` prochaines suppressions de fichiers.
    let failures = 0;
    const serverFetch = (base: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input as RequestInfo, init);
        if (req.method === 'DELETE' && new URL(req.url).pathname === '/storage/v1/object/photos' && failures > 0) {
          failures -= 1;
          return Response.json({ statusCode: '500', error: 'panne', message: 'Stockage en panne' }, { status: 500 });
        }
        return base(req);
      }) as typeof fetch;
    const env = await makeAiEnv({ serverFetch });
    const files = (id: string) => env.db.query<{ name: string }>(`select name from storage.objects where name like $1`, [`${id}/%`]).then((r) => r.rows.map((x) => x.name));
    const errors = () => env.db.query(`select user_id, action, code, detail from ai_errors`).then((r) => r.rows);
    const withPhoto = async (name: string) => {
      const who = await env.signUp(name);
      const up = await who.sb.storage.from('photos').upload(`${who.id}/etiquette.jpg`, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
      expect(up.error).toBeNull();
      return who;
    };

    // Une panne passagère : le nouvel essai suffit, rien n'est noté.
    const claire = await withPhoto('Claire');
    failures = 1;
    expect(await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: claire.password })).toMatchObject({ ok: true, deleted: true });
    expect(await files(claire.id)).toEqual([]);
    expect(await errors()).toEqual([]);

    // Une panne durable : le compte est bien supprimé (même réponse) ; la photo restante est notée dans le journal technique,
    // sans nom de fichier ni identifiant, et la purge mensuelle des photos qui ne servent plus la retrouve.
    const marc = await withPhoto('Marc');
    failures = 99;
    expect(await call(marc.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: marc.password })).toMatchObject({ ok: true, deleted: true });
    expect((await env.db.query(`select 1 from auth.users where id = $1`, [marc.id])).rows).toHaveLength(0);
    expect(await errors()).toEqual([{ user_id: null, action: 'delete_account', code: 'photos_left', detail: '1 photo(s) laissée(s) à la purge mensuelle' }]);
    expect(await files(marc.id)).toEqual([`${marc.id}/etiquette.jpg`]);
    await env.db.query(`update storage.objects set created_at = now() - interval '40 days' where name like $1`, [`${marc.id}/%`]);
    expect((await env.db.query<{ name: string }>(`select name from retention_orphan_photos(100)`)).rows.map((r) => r.name)).toEqual([`${marc.id}/etiquette.jpg`]);
  });

  it('organisateur dont une invitée a partagé une note avec l’événement : suppression complète, la note reste à l’invitée (audit, S1)', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const { data: inv } = await bruno.sb.rpc('create_friend_invite');
    await claire.sb.rpc('respond_friend_invite', { p_code: (inv as { code: string }).code, p_accept: true });
    const { data: w } = await bruno.sb.from('wines').insert({ name: 'Vin de Bruno' }).select().single();
    await bruno.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 2 }, p_request: crypto.randomUUID() });
    const { data: ev } = await bruno.sb.rpc('create_event', { p: { title: 'Dîner', starts_at: new Date(Date.now() + 86400_000).toISOString() }, p_guests: [claire.id] });
    const evId = (ev as { id: string }).id;
    const note = await claire.sb.rpc('create_tasting', { p: { wine_name: 'Morgon', event_id: evId, share_with_event: true }, p_consume_lot: null, p_request: crypto.randomUUID() });
    expect(note.error).toBeNull();

    expect(await call(bruno.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: bruno.password })).toMatchObject({ ok: true, deleted: true });
    for (const t of ['wines', 'lots', 'cellars']) {
      expect((await env.db.query(`select 1 from ${t} where owner_id = $1`, [bruno.id])).rows, t).toHaveLength(0);
    }
    expect((await env.db.query(`select 1 from events where id = $1`, [evId])).rows).toHaveLength(0);
    expect((await env.db.query(`select share_with_event, event_id from tastings where user_id = $1`, [claire.id])).rows).toEqual([{ share_with_event: false, event_id: null }]);
  });

  it('protection CAPTCHA activée : le serveur vérifie le mot de passe sans jeton, 5 essais par quart d’heure au plus', async () => {
    const env = await makeAiEnv({ captcha: true });
    const claire = await env.signUp('Claire');
    // Une connexion depuis le navigateur exige bien un jeton…
    const direct = await env.client().auth.signInWithPassword({ email: claire.email, password: claire.password });
    expect(direct.error?.code).toBe('captcha_failed');
    // … mais pas la vérification faite par le serveur avec sa clé : mauvais mot de passe refusé, bon mot de passe accepté.
    expect(await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: 'pas-le-bon-1' })).toMatchObject({ ok: false, code: 'invalid_password' });
    expect(await call(claire.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: claire.password })).toMatchObject({ ok: true, deleted: true });
    expect((await env.db.query(`select 1 from auth.users where id = $1`, [claire.id])).rows).toHaveLength(0);
    // Ses compteurs d'essais partent avec le compte.
    expect((await env.db.query(`select 1 from rate_hits where subject = $1`, [claire.id])).rows).toHaveLength(0);

    // Au 6e essai en un quart d'heure, même avec le bon mot de passe, rien n'est supprimé.
    const marc = await env.signUp('Marc');
    for (let i = 1; i <= 5; i++) {
      expect(await call(marc.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: `pas-le-bon-${i}` })).toMatchObject({ ok: false, code: 'invalid_password' });
    }
    expect(await call(marc.sb, { action: 'delete_account', confirm: 'SUPPRIMER', password: marc.password })).toMatchObject({
      ok: false,
      code: 'password_rate_limited',
      message: expect.stringMatching(/quart d’heure/),
    });
    expect((await env.db.query(`select 1 from auth.users where id = $1`, [marc.id])).rows).toHaveLength(1);
  });
});
