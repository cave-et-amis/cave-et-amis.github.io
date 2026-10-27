// Extrait les vins français de la base LWIN (Liv-ex, licence CC BY 4.0) vers src/data/lwin-fr.json, le fichier compact
// lu par le formulaire d'ajout d'un vin (suggestions sans IA).
// Usage : node scripts/lwin-extract.mjs <LWINdatabase.xlsx>
// Le fichier officiel se télécharge ici (mise à jour : relancer ce script, puis exporter le site) :
//   https://s3-eu-west-1.amazonaws.com/lwin-dictionary/latest/LWINdatabase.xlsx
// Lecture sans dépendance : le classeur est une archive ZIP, la feuille un XML de plus de 250 Mo, lu par morceaux.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { lwinRow } from '../src/domain/lwin.ts';

const source = process.argv[2];
if (!source) {
  console.error('Usage : node scripts/lwin-extract.mjs <LWINdatabase.xlsx>');
  process.exit(1);
}
const out = join(import.meta.dirname, '..', 'src', 'data', 'lwin-fr.json');

/** Données compressées d'un fichier de l'archive ZIP (répertoire central, puis en-tête local). */
function zipEntry(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Archive ZIP illisible');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Répertoire ZIP illisible');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      return { method, data: buf.subarray(start, start + size) };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} absent de l'archive`);
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Cellules d'une ligne : { A: texte, B: texte, … } (textes en ligne ou nombres). */
function cells(rowXml) {
  const out = {};
  for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const inner = m[2] ?? '';
    const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner) ?? /<v>([\s\S]*?)<\/v>/.exec(inner);
    out[m[1]] = t ? decode(t[1]) : '';
  }
  return out;
}

const { method, data } = zipEntry(readFileSync(source), 'xl/worksheets/sheet1.xml');
if (method !== 8) throw new Error('Feuille non compressée par « deflate » : format inattendu');

let header = null;
let rows = 0;
const wines = [];
let rest = '';
const inflate = Readable.from([data]).pipe(createInflateRaw());
inflate.setEncoding('utf8');
for await (const chunk of inflate) {
  rest += chunk;
  const end = rest.lastIndexOf('</row>');
  if (end < 0) continue;
  const block = rest.slice(0, end + 6);
  rest = rest.slice(end + 6);
  for (const m of block.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const c = cells(m[1]);
    if (!header) {
      header = c;
      continue;
    }
    rows++;
    const r = {};
    for (const [col, name] of Object.entries(header)) r[name] = c[col];
    const w = lwinRow(r);
    if (w) wines.push(w);
  }
}
if (!header || !['LWIN', 'COUNTRY', 'PRODUCER_NAME'].every((k) => Object.values(header).includes(k))) throw new Error('Colonnes LWIN introuvables');

// Tables partagées (appellations, régions…) : chaque vin n'en garde que le numéro.
function table() {
  const list = [''];
  const pos = new Map([['', 0]]);
  return {
    list,
    id(v) {
      const k = v ?? '';
      if (!pos.has(k)) pos.set(k, list.push(k) - 1);
      return pos.get(k);
    },
  };
}
const appellations = table();
const regions = table();
const couleurs = table();
const types = table();
wines.sort((a, b) => a.name.localeCompare(b.name, 'fr') || (a.cuvee ?? '').localeCompare(b.cuvee ?? '', 'fr') || a.lwin - b.lwin);
const file = {
  source: 'LWIN (Liv-ex Wine Identification Number), https://www.liv-ex.com/lwin/ — licence CC BY 4.0 ; vins français seulement, adaptés pour Cave & Amis',
  extrait_le: new Date().toISOString().slice(0, 10),
  appellations: appellations.list,
  regions: regions.list,
  couleurs: couleurs.list,
  types: types.list,
  vins: wines.map((w) => [w.lwin, w.name, w.cuvee ?? '', appellations.id(w.appellation), regions.id(w.region), couleurs.id(w.color), types.id(w.wine_type)]),
};
// Tables remplies pendant le map ci-dessus : écrites après.
file.appellations = appellations.list;
file.regions = regions.list;
file.couleurs = couleurs.list;
file.types = types.list;
const json = JSON.stringify(file);
writeFileSync(out, json);
console.log(`${rows} lignes lues ; ${wines.length} vins français retenus ; ${appellations.list.length - 1} appellations ; ${(json.length / 1e6).toFixed(1)} Mo → ${out}`);
