import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkLink, Markdown } from '../src/ui/markdown.tsx';

describe('liens vers d’autres sites (réponses de Lia, documents légaux)', () => {
  it('domaine réel extrait, sans « www. » ; à afficher seulement quand le texte ne le montre pas', () => {
    expect(checkLink('Wine-Searcher', 'https://www.wine-searcher.com/find/labeille')).toEqual({ host: 'wine-searcher.com', shown: false, misleading: false });
    expect(checkLink('https://www.vivino.com/fr/x', 'https://www.vivino.com/fr/x')).toEqual({ host: 'vivino.com', shown: true, misleading: false });
    expect(checkLink('vivino.com', 'https://fr.vivino.com/x')).toEqual({ host: 'fr.vivino.com', shown: true, misleading: false });
    expect(checkLink('la CNIL', 'https://www.cnil.fr/fr/cookies')).toEqual({ host: 'cnil.fr', shown: false, misleading: false });
  });

  it('texte trompeur signalé : le texte annonce un site, le lien en ouvre un autre', () => {
    expect(checkLink('https://banque.fr', 'https://banque-fr.exemple.test/connexion')).toEqual({ host: 'banque-fr.exemple.test', shown: false, misleading: true });
    expect(checkLink('www.banque.fr', 'https://banque.fr.exemple.test/')).toMatchObject({ misleading: true });
    expect(checkLink('banque.fr', 'https://autrebanque.fr/')).toMatchObject({ misleading: true });
    // Domaine caché derrière « nom@ » : c'est exemple.test qui s'ouvre.
    expect(checkLink('https://banque.fr@exemple.test/', 'https://banque.fr@exemple.test/')).toMatchObject({ host: 'exemple.test', misleading: true });
  });

  it('nom accentué : toujours montré, en punycode (une lettre d’un autre alphabet peut imiter un nom connu)', () => {
    const lookalike = 'https://bаnque.fr/'; // « а » cyrillique
    const c = checkLink(lookalike, lookalike)!;
    expect(c.host).toMatch(/^xn--/);
    expect(c).toMatchObject({ shown: false, misleading: false });
  });

  it('adresse qui n’est pas une page web : pas de lien', () => {
    expect(checkLink('x', 'javascript:alert(1)')).toBeNull();
    expect(checkLink('x', 'pas une adresse')).toBeNull();
  });

  it('affichage : domaine à côté du lien, alerte si le texte trompe, rien du texte interprété comme HTML', () => {
    const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text, headings: true }));
    expect(html('Voir [la CNIL](https://www.cnil.fr/fr/cookies).')).toContain(
      '<a href="https://www.cnil.fr/fr/cookies" target="_blank" rel="noopener noreferrer">la CNIL</a><span class="link-host"> (cnil.fr)</span>.',
    );
    expect(html('[https://banque.fr](https://banque-fr.exemple.test/)')).toContain('<span class="link-host warn"> (attention : ce lien mène à banque-fr.exemple.test)</span>');
    expect(html('Source : https://www.vivino.com/x.')).not.toContain('link-host');
    expect(html('[<img src=x onerror=alert(1)>](https://exemple.test/)')).not.toContain('<img');
  });
});
