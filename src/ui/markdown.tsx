/**
 * Affichage sûr des réponses de l'assistant et des documents légaux : paragraphes, listes, **gras**, _italique_ et liens
 * http(s) ; titres « # » seulement pour les documents (`headings`). Aucun HTML n'est interprété (React échappe tout le texte).
 */
import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)<>]+)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('_')) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok)!;
      out.push(
        <a key={k} href={mm[2]} target="_blank" rel="noopener noreferrer">
          {mm[1]}
        </a>,
      );
    } else {
      const url = tok.replace(/[.,;:!?]+$/, '');
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (url.length < tok.length) out.push(tok.slice(url.length));
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*([-*•]|\d+[.)])\s+/;

const HEADING = /^(#{1,3})\s+/;

type Group = { kind: 'p' | 'ul' | 'ol' | 'h1' | 'h2' | 'h3'; lines: string[] };

export function toGroups(text: string, headings = false): Group[] {
  const groups: Group[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    let current: Group | null = null;
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const h = headings ? HEADING.exec(line) : null;
      if (h) {
        groups.push({ kind: `h${h[1].length}` as Group['kind'], lines: [line.slice(h[0].length).trim()] });
        current = null;
        continue;
      }
      const kind: Group['kind'] = BULLET.test(line) ? (/^\s*\d/.test(line) ? 'ol' : 'ul') : 'p';
      if (!current || current.kind !== kind) {
        current = { kind, lines: [] };
        groups.push(current);
      }
      current.lines.push(kind === 'p' ? line.replace(/^#+\s*/, '') : line.replace(BULLET, ''));
    }
  }
  return groups;
}

export function Markdown({ text, headings = false }: { text: string; headings?: boolean }) {
  return (
    <>
      {toGroups(text, headings).map((g, b) => {
        // Titres du document : un niveau sous le titre de la page.
        if (g.kind === 'h1') return <h3 key={b}>{inline(g.lines[0], `${b}`)}</h3>;
        if (g.kind === 'h2') return <h4 key={b}>{inline(g.lines[0], `${b}`)}</h4>;
        if (g.kind === 'h3') return <h5 key={b}>{inline(g.lines[0], `${b}`)}</h5>;
        if (g.kind === 'p')
          return (
            <p key={b}>
              {g.lines.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {inline(l, `${b}-${i}`)}
                </Fragment>
              ))}
            </p>
          );
        const items = g.lines.map((l, i) => <li key={i}>{inline(l, `${b}-${i}`)}</li>);
        return g.kind === 'ol' ? <ol key={b}>{items}</ol> : <ul key={b}>{items}</ul>;
      })}
    </>
  );
}
