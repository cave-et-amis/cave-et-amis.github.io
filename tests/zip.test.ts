import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from '../src/domain/zip.ts';
import { legalPlaceholders } from '../src/domain/legal.ts';

/** Relit une archive comme le ferait un logiciel de décompression : fin de répertoire, répertoire central, fichiers. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const files: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.push({ name, data });
    at += 46 + nameLength;
  }
  return files;
}

describe('archive de l’export', () => {
  it('somme de contrôle CRC-32 standard', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('relue à l’identique : noms accentués, données binaires, archive vide', () => {
    const json = new TextEncoder().encode('{"prénom":"Léa"}');
    const photo = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
    const files = readZip(makeZip([
      { name: 'données.json', data: json },
      { name: 'photos/étiquette.jpg', data: photo },
    ]));
    expect(files.map((f) => f.name)).toEqual(['données.json', 'photos/étiquette.jpg']);
    expect(new TextDecoder().decode(files[0].data)).toBe('{"prénom":"Léa"}');
    expect([...files[1].data]).toEqual([...photo]);
    expect(readZip(makeZip([]))).toEqual([]);
  });
});

describe('documents légaux : emplacements à compléter', () => {
  it('repère chaque emplacement ou point à valider, comme la base', () => {
    expect(legalPlaceholders('Contact : [À COMPLÉTER : adresse e-mail]. Clause [À VALIDER : âge] ok.')).toEqual([
      '[À COMPLÉTER : adresse e-mail]',
      '[À VALIDER : âge]',
    ]);
    expect(legalPlaceholders('Texte complet, sans rien à compléter.')).toEqual([]);
    expect(legalPlaceholders('Oubli : [À COMPLÉTER sans fin')).toEqual(['[À COMPLÉTER sans fin']);
  });
});
