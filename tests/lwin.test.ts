import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accentuate, decodeLwin, frenchRegion, lwinRow, searchLwin, type LwinFile } from '../src/domain/lwin.ts';

/** Ligne au format du fichier officiel (« NA » pour une case vide). */
const row = (o: Record<string, string | number>) => ({
  LWIN: 1000001,
  STATUS: 'Live',
  DISPLAY_NAME: 'NA',
  PRODUCER_TITLE: 'NA',
  PRODUCER_NAME: 'NA',
  WINE: 'NA',
  COUNTRY: 'France',
  REGION: 'NA',
  SUB_REGION: 'NA',
  SITE: 'NA',
  PARCEL: 'NA',
  COLOUR: 'Red',
  TYPE: 'Wine',
  SUB_TYPE: 'Still',
  DESIGNATION: 'AOP',
  CLASSIFICATION: 'NA',
  ...o,
});

describe('dictionnaire LWIN : conversion d’une ligne', () => {
  it('Bordeaux : producteur avec son titre, cuvée, appellation, région en français, accents rétablis', () => {
    expect(
      lwinRow(
        row({
          DISPLAY_NAME: 'Cuvee Les Graves, Chateau Le Manoir, Lalande de Pomerol',
          PRODUCER_TITLE: 'Chateau',
          PRODUCER_NAME: 'Le Manoir',
          WINE: 'Cuvee Les Graves',
          REGION: 'Bordeaux',
          SUB_REGION: 'Lalande de Pomerol',
        }),
      ),
    ).toEqual({ lwin: 1000001, name: 'Château Le Manoir', cuvee: 'Cuvée Les Graves', appellation: 'Lalande de Pomerol', region: 'Bordeaux', color: 'rouge', wine_type: 'tranquille' });
  });

  it('Bourgogne : climat comme cuvée, classement ajouté à l’appellation', () => {
    expect(
      lwinRow(row({ PRODUCER_NAME: 'Philippe Pacalet', REGION: 'Burgundy', SUB_REGION: 'Meursault', SITE: 'Perrieres', COLOUR: 'White', CLASSIFICATION: 'Premier Cru' })),
    ).toMatchObject({ name: 'Philippe Pacalet', cuvee: 'Perrieres', appellation: 'Meursault Premier Cru', region: 'Bourgogne', color: 'blanc' });
  });

  it('appellation tirée du nom affiché, jamais la cuvée elle-même ; Champagne effervescent', () => {
    expect(lwinRow(row({ DISPLAY_NAME: 'Chateau Malbec, Bordeaux', PRODUCER_TITLE: 'Chateau', PRODUCER_NAME: 'Malbec', REGION: 'Bordeaux' }))).toMatchObject({
      appellation: 'Bordeaux',
    });
    expect(
      lwinRow(row({ DISPLAY_NAME: "Chateau Monbousquet, Bordeaux Blanc d'Exception", PRODUCER_TITLE: 'Chateau', PRODUCER_NAME: 'Monbousquet', WINE: "Blanc d'Exception", REGION: 'Bordeaux', COLOUR: 'White' })),
    ).toMatchObject({ appellation: 'Bordeaux', cuvee: "Blanc d'Exception" });
    expect(
      lwinRow(row({ DISPLAY_NAME: 'Jean Milan, Extra Brut Premier Cru', PRODUCER_NAME: 'Jean Milan', WINE: 'Extra Brut', REGION: 'Champagne', COLOUR: 'White', SUB_TYPE: 'Sparkling', CLASSIFICATION: 'Premier Cru' })),
    ).toMatchObject({ appellation: 'Champagne Premier Cru', color: 'effervescent', wine_type: 'effervescent', region: 'Champagne' });
  });

  it('écarte les autres pays, les lignes supprimées, les spiritueux et les caisses d’assortiment', () => {
    expect(lwinRow(row({ PRODUCER_NAME: 'X', COUNTRY: 'Italy' }))).toBeNull();
    expect(lwinRow(row({ PRODUCER_NAME: 'X', STATUS: 'Deleted' }))).toBeNull();
    expect(lwinRow(row({ PRODUCER_NAME: 'X', TYPE: 'Spirit' }))).toBeNull();
    expect(lwinRow(row({ PRODUCER_NAME: 'X', COLOUR: 'Mixed' }))).toBeNull();
    expect(lwinRow(row({ PRODUCER_NAME: 'X', WINE: 'NV Assortment Case' }))).toBeNull();
    expect(lwinRow(row({ PRODUCER_NAME: 'X', TYPE: 'Fortified Wine', SUB_TYPE: 'Vin Doux Naturel' }))).toMatchObject({ wine_type: 'fortifie' });
  });

  it('accents : seulement les mots courants, casse gardée ; régions traduites', () => {
    expect(accentuate('Chateauneuf-du-Pape, Cotes du Rhone, Saint-Emilion')).toBe('Châteauneuf-du-Pape, Côtes du Rhône, Saint-Émilion');
    expect(accentuate('La cuvee Rose de Leoville')).toBe('La cuvée Rose de Leoville');
    expect(frenchRegion('Burgundy')).toBe('Bourgogne');
    expect(frenchRegion('Rhone')).toBe('Vallée du Rhône');
    expect(frenchRegion('NA')).toBe('');
  });
});

describe('dictionnaire LWIN : recherche', () => {
  const file: LwinFile = {
    source: 'test',
    extrait_le: '2026-10-27',
    appellations: ['', 'Condrieu', 'Côtes du Rhône', 'Vouvray'],
    regions: ['', 'Vallée du Rhône', 'Vallée de la Loire'],
    couleurs: ['', 'blanc', 'rouge'],
    types: ['', 'tranquille'],
    vins: [
      [1, 'E. Guigal', '', 1, 1, 1, 1],
      [2, 'E. Guigal', 'Parallèle 45', 2, 1, 2, 1],
      [3, 'Domaine Huet', 'Le Mont', 3, 2, 1, 1],
      [4, 'Cave de Guigal-sur-Mer', '', 2, 1, 2, 1],
    ],
  };
  const index = decodeLwin(file);

  it('tous les mots, dans n’importe quel ordre, sans accents ni majuscules', () => {
    expect(searchLwin(index, 'condrieu guigal').map((w) => w.lwin)).toEqual([1]);
    expect(searchLwin(index, 'parallele 45').map((w) => w.lwin)).toEqual([2]);
    expect(searchLwin(index, 'COTES RHONE').map((w) => w.lwin).sort()).toEqual([2, 4]);
    expect(searchLwin(index, 'huet vouvray')[0]).toEqual({ lwin: 3, name: 'Domaine Huet', cuvee: 'Le Mont', appellation: 'Vouvray', region: 'Vallée de la Loire', color: 'blanc', wine_type: 'tranquille' });
  });

  it('le nom qui commence par le mot tapé d’abord ; rien sous 3 caractères', () => {
    expect(searchLwin(index, 'guigal').map((w) => w.lwin)).toEqual([1, 2, 4]);
    expect(searchLwin(index, 'gu')).toEqual([]);
    expect(searchLwin(index, 'introuvable')).toEqual([]);
  });
});

describe('fichier src/data/lwin-fr.json', () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'lwin-fr.json'), 'utf8')) as LwinFile;

  it('vins français seulement, source et licence citées, recherche utilisable', () => {
    expect(file.source).toMatch(/LWIN/);
    expect(file.source).toMatch(/CC BY 4\.0/);
    expect(file.vins.length).toBeGreaterThan(50000);
    expect(file.regions).toContain('Bourgogne');
    expect(file.regions).not.toContain('Burgundy');
    const index = decodeLwin(file);
    expect(searchLwin(index, 'guigal condrieu')[0]).toMatchObject({ name: 'E. Guigal', appellation: 'Condrieu', color: 'blanc' });
    expect(searchLwin(index, 'huet vouvray').length).toBeGreaterThan(0);
    // Nom tapé en entier : le cru lui-même avant les autres châteaux de l'appellation Margaux.
    expect(searchLwin(index, 'chateau margaux')[0]).toMatchObject({ name: 'Château Margaux', cuvee: null });
  });
});
