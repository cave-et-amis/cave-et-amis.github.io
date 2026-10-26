/**
 * Affichage sûr des réponses de l'assistant et des documents légaux : paragraphes, listes, **gras**, _italique_ et liens
 * http(s) ; titres « # » seulement pour les documents (`headings`). Aucun HTML n'est interprété (React échappe tout le texte).
 * Lien vers un autre site : son domaine est affiché quand le texte ne le montre pas, et signalé quand le texte en annonce
 * un autre ; `confirmLinks` (assistant) demande en plus « Ouvrir le site … ? » avant de l'ouvrir.
 */
import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { useConfirm } from './kit';

const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)<>]+)/g;

/** Nom de domaine écrit dans un texte (« banque.fr », « https://www.banque.fr/… », « château.fr »). */
const DOMAIN = /(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:\p{L}{2,}|xn--[a-z0-9-]+)/giu;

const bareHost = (host: string) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

function hostOf(domain: string) {
  try {
    return bareHost(new URL(`http://${domain}`).hostname);
  } catch {
    return null;
  }
}

/**
 * Où mène vraiment un lien : `host` (sans « www. » ; un nom accentué en punycode), `shown` (le texte montre déjà ce
 * domaine), `misleading` (le texte annonce un autre site, ou l'adresse cache son domaine derrière « nom@ »).
 */
export type LinkCheck = { host: string; shown: boolean; misleading: boolean };

export function checkLink(text: string, href: string): LinkCheck | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = bareHost(url.hostname);
  const cited = [...text.matchAll(DOMAIN)].map((m) => hostOf(m[0])).filter((d): d is string => Boolean(d));
  // Le lien mène au domaine cité ou à l'un de ses sous-domaines (fr.vivino.com pour « vivino.com »).
  const match = cited.some((d) => host === d || host.endsWith(`.${d}`));
  return {
    host,
    // Nom accentué : toujours montré en punycode (une lettre d'un autre alphabet peut imiter un nom connu).
    shown: match && !host.split('.').some((label) => label.startsWith('xn--')),
    misleading: Boolean(url.username || url.password) || (cited.length > 0 && !match),
  };
}

/** Lien vers un autre site : domaine affiché si besoin, alerte si le texte trompe ; `confirmOpen` : confirmation avant. */
export function SafeLink({ href, label, confirmOpen = false, children }: { href: string; label: string; confirmOpen?: boolean; children?: ReactNode }) {
  const confirm = useConfirm();
  const check = checkLink(label, href);
  if (!check) return <>{label}</>;
  const open = async (e: MouseEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: `Ouvrir le site ${check.host} ?`,
      message: (
        <>
          {check.misleading && <p className="strong">Attention : le texte du lien annonce un autre site.</p>}
          <p className="small" style={{ overflowWrap: 'anywhere' }}>
            {href}
          </p>
        </>
      ),
      confirmLabel: 'Ouvrir',
    });
    if (ok) window.open(href, '_blank', 'noopener,noreferrer');
  };
  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={confirmOpen ? (e) => void open(e) : undefined}>
        {label}
        {children}
      </a>
      {check.misleading ? (
        <span className="link-host warn">{` (attention : ce lien mène à ${check.host})`}</span>
      ) : (
        !check.shown && <span className="link-host">{` (${check.host})`}</span>
      )}
    </>
  );
}

function inline(text: string, key: string, confirmLinks: boolean): ReactNode[] {
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
      out.push(<SafeLink key={k} href={mm[2]} label={mm[1]} confirmOpen={confirmLinks} />);
    } else {
      const url = tok.replace(/[.,;:!?]+$/, '');
      out.push(<SafeLink key={k} href={url} label={url} confirmOpen={confirmLinks} />);
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

export function Markdown({ text, headings = false, confirmLinks = false }: { text: string; headings?: boolean; confirmLinks?: boolean }) {
  const md = (line: string, key: string) => inline(line, key, confirmLinks);
  return (
    <>
      {toGroups(text, headings).map((g, b) => {
        // Titres du document : un niveau sous le titre de la page.
        if (g.kind === 'h1') return <h3 key={b}>{md(g.lines[0], `${b}`)}</h3>;
        if (g.kind === 'h2') return <h4 key={b}>{md(g.lines[0], `${b}`)}</h4>;
        if (g.kind === 'h3') return <h5 key={b}>{md(g.lines[0], `${b}`)}</h5>;
        if (g.kind === 'p')
          return (
            <p key={b}>
              {g.lines.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {md(l, `${b}-${i}`)}
                </Fragment>
              ))}
            </p>
          );
        const items = g.lines.map((l, i) => <li key={i}>{md(l, `${b}-${i}`)}</li>);
        return g.kind === 'ol' ? <ol key={b}>{items}</ol> : <ul key={b}>{items}</ul>;
      })}
    </>
  );
}
