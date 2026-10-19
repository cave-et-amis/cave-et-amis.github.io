/**
 * Affichage sûr des réponses de l'assistant : paragraphes, listes, **gras**, _italique_ et liens http(s).
 * Aucun HTML n'est interprété (React échappe tout le texte).
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

type Group = { kind: 'p' | 'ul' | 'ol'; lines: string[] };

export function toGroups(text: string): Group[] {
  const groups: Group[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    let current: Group | null = null;
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
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

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {toGroups(text).map((g, b) => {
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
