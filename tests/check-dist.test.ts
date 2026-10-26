import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const work = join(root, 'reports', `check-dist-${Date.now()}`);
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Export minimal (fichiers obligatoires), plus des fichiers choisis ; puis le contrôle de l'export. */
function check(name: string, extra: Record<string, string>) {
  const dir = join(work, name);
  const files: Record<string, string> = {
    'index.html': '<!doctype html><title>Cave & Amis</title>',
    'config.js': 'window.CAVE_CONFIG = {};',
    'sw.js': '',
    'manifest.webmanifest': '{}',
    _headers: '',
    'asset-manifest.json': '{"files":[]}',
    'icon-192.png': '',
    'icon-512.png': '',
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return spawnSync(process.execPath, [join(root, 'scripts', 'check-dist.mjs'), dir], { encoding: 'utf8' });
}

describe('contrôle de l’export (audit, F11)', () => {
  it('accepte un export propre', () => {
    const res = check('propre', { 'assets/app.js': 'console.log("ok")', 'assets/app.js.map': '{"version":3}', 'icon.svg': '<svg/>' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('cherche dans tous les fichiers texte (.mjs, .map, .svg…) : clés privées PEM et JWK, jetons GitHub', () => {
    // Valeurs factices, assemblées ici pour ne jamais ressembler à un vrai secret dans le dépôt.
    const pem = `-----BEGIN ${'PRIVATE'} KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----`;
    const jwk = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43), d: 'C'.repeat(43) });
    const github = `gh${'p'}_${'x'.repeat(36)}`;
    const res = check('secrets', { 'assets/moteur.mjs': pem, 'assets/app.js.map': jwk, 'icon.svg': `<svg><!-- ${github} --></svg>` });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Clé privée (PEM) dans moteur.mjs');
    expect(res.stderr).toContain('Clé privée (JWK) dans app.js.map');
    expect(res.stderr).toContain('Jeton GitHub dans icon.svg');
  });

  it('une clé publique (JWK sans « d ») n’est pas un secret', () => {
    const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) });
    expect(check('publique', { 'assets/app.js': `const k = ${pub};` }).status).toBe(0);
  });
});
