import { describe, expect, it } from 'vitest';
import { availability, HELP_PAGES, HELP_PATHS, HELP_QUESTIONS, HELP_TOPICS, helpTopic, pageOfRoute, searchHelp, topicsForPage } from '../src/domain/help.ts';

const everyone = { admin: false, groupManager: false, eventOrganizer: false, assistant: true };

describe('aide intégrée', () => {
  it('chaque question de l’aide trouve sa fiche en premier', () => {
    const cases: [string, string][] = [
      ['Comment ajouter une bouteille ?', 'ajouter-bouteille'],
      ['Comment partager une bouteille avec mes amis ?', 'partage-bouteille'],
      ['Comment inviter quelqu’un sans lui montrer ma cave ?', 'inviter-decouverte'],
      ['Je veux inviter Paul sans lui montrer mes bouteilles', 'inviter-decouverte'],
      ['Comment créer un groupe ?', 'creer-groupe'],
      ['Comment organiser une soirée dégustation ?', 'organiser-evenement'],
      ['Comment supprimer une invitation ?', 'supprimer-invitation'],
      ['Comment modifier les informations d’une bouteille ?', 'modifier-bouteille'],
      ['Qui peut voir mes bouteilles ?', 'qui-voit'],
      // Un mot rare l'emporte sur un mot que beaucoup de fiches emploient.
      ['Comment accéder à l’administration de l’application ?', 'administration'],
      ['Comment exporter ma cave dans un tableur ?', 'exporter'],
    ];
    for (const [q, id] of cases) expect(searchHelp(q)[0]?.id, q).toBe(id);
    expect(searchHelp('Comment payer un abonnement premium ?')).toEqual([]);
  });

  it('les fiches sont complètes, leurs liens restent dans l’application', () => {
    const ids = new Set<string>();
    for (const t of HELP_TOPICS) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      expect(t.pages.every((p) => p in HELP_PAGES), t.id).toBe(true);
      if (t.needs) expect(t.unavailable, t.id).toBeTruthy();
      if (t.link) expect(t.link.path, t.id).toMatch(/^\/[a-z/]*(\?[a-z0-9=&]+)?$/);
    }
    for (const id of HELP_QUESTIONS) expect(helpTopic(id), id).toBeDefined();
    for (const p of HELP_PATHS) expect(p.startsWith('/')).toBe(true);
  });

  it('les fiches s’adaptent aux droits ; l’administration n’apparaît qu’à l’administrateur', () => {
    const invite = helpTopic('inviter-evenement')!;
    expect(availability(invite, everyone)).toEqual({ available: false, reason: invite.unavailable });
    expect(availability(invite, { ...everyone, eventOrganizer: true })).toEqual({ available: true });
    expect(topicsForPage('reglages', everyone).map((t) => t.id)).not.toContain('administration');
    expect(topicsForPage('reglages', { ...everyone, admin: true }).map((t) => t.id)).toContain('administration');
    // Les fiches accessibles d'abord.
    const events = topicsForPage('evenements', everyone);
    expect(events.findIndex((t) => !availability(t, everyone).available)).toBeGreaterThan(events.findIndex((t) => t.id === 'organiser-evenement'));
  });

  it('la page se déduit de l’adresse', () => {
    expect(pageOfRoute('/')).toBe('accueil');
    expect(pageOfRoute('/cave')).toBe('cave');
    expect(pageOfRoute('/cave/vin/123')).toBe('vin');
    expect(pageOfRoute('/amis?onglet=invitations')).toBe('invitations');
    expect(pageOfRoute('/amis?onglet=groupes')).toBe('groupes');
    expect(pageOfRoute('/amis/abc?onglet=moi')).toBe('amis');
    expect(pageOfRoute('/groupes/abc')).toBe('groupe');
    expect(pageOfRoute('/evenements/abc')).toBe('evenement');
    expect(pageOfRoute('/reglages/acces')).toBe('reglages');
    expect(pageOfRoute('/inconnue')).toBe('accueil');
  });
});
