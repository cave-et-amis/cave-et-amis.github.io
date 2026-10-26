/**
 * Lecture des documents légaux publiés (conditions d'utilisation, politique de confidentialité, mentions légales,
 * cookies) : page dans l'application, page sans compte (avant l'inscription), fenêtre de lecture, liens de bas de page.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import type { Api } from '../../data/api';
import { dateLong } from '../../domain/format';
import { LEGAL_KINDS, LEGAL_TITLES, type LegalDoc, type LegalKind } from '../../domain/legal';
import { toMessage } from '../../domain/errors';
import { EmptyState, InlineLoading, Notice, Sheet } from '../../ui/kit';
import { Markdown } from '../../ui/markdown';
import { go } from '../../ui/router';

/** Dernières versions publiées (lisibles sans compte). `docs` reste vide tant que rien n'est publié. */
export function useLegalDocs(api: Api) {
  const [docs, setDocs] = useState<LegalDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .legalCurrent()
      .then((d) => alive && setDocs(d))
      .catch((e) => {
        if (!alive) return;
        setError(toMessage(e));
        setDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  const byKind = (kind: LegalKind) => docs?.find((d) => d.kind === kind) ?? null;
  return { docs, error, byKind };
}

export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal-doc stack-sm">
      <p className="small faint">
        Version {doc.version} du {dateLong(doc.published_at)}
      </p>
      <Markdown text={doc.content} headings />
    </article>
  );
}

/** Liens vers les quatre documents (bas d'écran de connexion, réglages). */
export function LegalLinks() {
  return (
    <nav className="legal-links small" aria-label="Documents légaux">
      {LEGAL_KINDS.map((k) => (
        <a key={k} href={`#/legal/${k}`}>
          {LEGAL_TITLES[k]}
        </a>
      ))}
    </nav>
  );
}

function LegalBody({ api, kind }: { api: Api; kind: LegalKind }) {
  const { docs, error, byKind } = useLegalDocs(api);
  if (!docs) return <InlineLoading />;
  const doc = byKind(kind);
  return (
    <>
      {error && <Notice tone="warn">{error}</Notice>}
      {doc ? (
        <section className="card">
          <LegalDocView doc={doc} />
        </section>
      ) : (
        <EmptyState icon="📄" title="Document pas encore publié">
          {LEGAL_TITLES[kind]} : ce document est en cours de rédaction.
        </EmptyState>
      )}
      <LegalLinks />
    </>
  );
}

/** Page d'un document, dans l'application. */
export function LegalPage({ api, kind }: { api: Api; kind: LegalKind }) {
  return <LegalBody api={api} kind={kind} />;
}

/** Page d'un document sans être connecté (avant l'inscription). */
export function LegalScreen({ api, kind }: { api: Api; kind: LegalKind }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="inline">
          <button type="button" className="icon-btn" aria-label="Retour" onClick={() => (history.length > 1 ? history.back() : go('/', { replace: true }))}>
            <ArrowLeft />
          </button>
          <h1 className="title-font" style={{ fontSize: '1.3rem', margin: 0 }}>
            {LEGAL_TITLES[kind]}
          </h1>
        </div>
        <LegalBody api={api} kind={kind} />
      </div>
    </main>
  );
}

/** Lecture d'un document dans une fenêtre (inscription, fenêtre d'acceptation, nouvelle version). */
export function LegalSheet({ doc, onClose, footer }: { doc: LegalDoc; onClose: () => void; footer?: ReactNode }) {
  return (
    <Sheet open onClose={onClose} title={doc.title} footer={footer}>
      <LegalDocView doc={doc} />
    </Sheet>
  );
}

export function LegalRow({ kind, sub }: { kind: LegalKind; sub?: string }) {
  return (
    <a className="row" href={`#/legal/${kind}`}>
      <FileText aria-hidden style={{ color: 'var(--primary)' }} />
      <span className="row-main">
        <span className="row-title">{LEGAL_TITLES[kind]}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
    </a>
  );
}
