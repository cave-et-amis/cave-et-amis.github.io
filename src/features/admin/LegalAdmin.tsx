/**
 * Administration › Documents légaux : versions publiées et nombre d'acceptations (sans nom), publication d'une nouvelle
 * version depuis les projets de docs/legal. La base refuse un texte qui contient encore « [À COMPLÉTER » ou
 * « [À VALIDER », et un document publié ne se modifie plus (une correction = une nouvelle version).
 */
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Eye, Pencil } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort } from '../../domain/format';
import { LEGAL_KINDS, LEGAL_TITLES, legalPlaceholders, type LegalKind, type LegalStats } from '../../domain/legal';
import { toMessage } from '../../domain/errors';
import { Button, Check, Field, InlineLoading, Notice, Sheet, useConfirm } from '../../ui/kit';
import { Markdown } from '../../ui/markdown';

// Projets rédigés après l'audit (docs/legal), chargés seulement ici.
const DRAFTS: Record<LegalKind, () => Promise<{ default: string }>> = {
  cgu: () => import('../../../docs/legal/cgu.md?raw'),
  confidentialite: () => import('../../../docs/legal/confidentialite.md?raw'),
  mentions: () => import('../../../docs/legal/mentions-legales.md?raw'),
  cookies: () => import('../../../docs/legal/cookies.md?raw'),
};

/** Texte d'un projet sans son titre de fichier (le titre est affiché à part). */
export function draftBody(text: string) {
  return text.replace(/\r/g, '').replace(/^# [^\n]*\n+/, '').trim();
}

export function LegalAdmin() {
  const { api } = useStore();
  const [stats, setStats] = useState<LegalStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LegalKind | null>(null);
  const load = useCallback(async () => {
    try {
      setStats(await api.adminLegalStats());
      setError(null);
    } catch (e) {
      setError(toMessage(e));
      setStats([]);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card stack-sm" aria-labelledby="h-legal">
      <h2 id="h-legal" className="section">
        Documents légaux
      </h2>
      <p className="small muted">
        Les projets sont dans le dossier docs/legal du dépôt. Avant de publier : complétez chaque « [À COMPLÉTER » et faites valider chaque « [À VALIDER » par un
        juriste. Ordre conseillé : mentions légales, cookies, politique de confidentialité, puis conditions d’utilisation (les personnes déjà inscrites les
        accepteront à leur prochaine connexion).
      </p>
      {error && <Notice tone="warn">{error}</Notice>}
      {!stats ? (
        <InlineLoading />
      ) : (
        <div className="list">
          {LEGAL_KINDS.map((k) => {
            const current = stats.find((s) => s.kind === k);
            return (
              <div key={k} className="row static">
                <span className="row-main">
                  <span className="row-title">{LEGAL_TITLES[k]}</span>
                  <span className="row-sub">
                    {current
                      ? `Version ${current.version} du ${dateShort(current.published_at)} · ${
                          k === 'cgu' ? `${current.acceptances} acceptation${current.acceptances > 1 ? 's' : ''}` : `${current.acknowledgments} lecture${current.acknowledgments > 1 ? 's' : ''}`
                        }`
                      : 'Pas encore publié'}
                  </span>
                </span>
                <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing(k)}>
                  Nouvelle version
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {editing && stats && (
        <PublishSheet kind={editing} first={!stats.some((s) => s.kind === editing)} onClose={() => setEditing(null)} onPublished={load} />
      )}
    </section>
  );
}

function PublishSheet({ kind, first, onClose, onPublished }: { kind: LegalKind; first: boolean; onClose: () => void; onPublished: () => Promise<void> }) {
  const { api, run } = useStore();
  const confirm = useConfirm();
  const [title, setTitle] = useState(LEGAL_TITLES[kind]);
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState(first ? 'Première version' : '');
  const [important, setImportant] = useState(first && kind === 'cgu');
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const missing = legalPlaceholders(content);
  // Les premières conditions d'utilisation sont toujours à accepter par tous (la base l'impose aussi).
  const forced = first && kind === 'cgu';

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${LEGAL_TITLES[kind]} : nouvelle version`}
      footer={
        <Button
          disabled={!title.trim() || !content.trim() || missing.length > 0}
          onClick={async () => {
            const ok = await confirm({
              title: 'Publier ce document ?',
              message: `Il sera visible par tous${kind === 'cgu' && (important || forced) ? ', et chaque compte devra l’accepter à sa prochaine connexion' : ''}. Un document publié ne se modifie plus : une correction se fait par une nouvelle version.`,
              confirmLabel: 'Publier',
            });
            if (!ok) return;
            const res = await run(() => api.adminLegalPublish(kind, title.trim(), content, summary.trim(), kind === 'cgu' && (important || forced)), {
              success: 'Document publié',
              reload: false,
            });
            if (res.ok) {
              await onPublished();
              onClose();
            }
          }}
        >
          Publier
        </Button>
      }
    >
      <div className="form">
        <Button
          variant="secondary"
          icon={<FileUp />}
          loading={loading}
          onClick={async () => {
            setLoading(true);
            try {
              setContent(draftBody((await DRAFTS[kind]()).default));
            } finally {
              setLoading(false);
            }
          }}
        >
          Charger le projet (docs/legal)
        </Button>
        <Field label="Titre affiché" htmlFor="legal-title">
          <input id="legal-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="inline">
          <Button size="sm" variant="ghost" icon={preview ? <Pencil /> : <Eye />} onClick={() => setPreview((p) => !p)}>
            {preview ? 'Modifier le texte' : 'Aperçu'}
          </Button>
        </div>
        {preview ? (
          <div className="legal-scroll legal-doc">
            <Markdown text={content} headings />
          </div>
        ) : (
          <Field label="Texte (Markdown : ## pour un titre, - pour une liste, **gras**)" htmlFor="legal-content">
            <textarea id="legal-content" className="input" rows={14} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
        )}
        {missing.length > 0 && (
          <Notice tone="warn">
            Encore {missing.length} emplacement{missing.length > 1 ? 's' : ''} à compléter ou à faire valider : {missing.slice(0, 5).join(' · ')}
            {missing.length > 5 ? ' …' : ''}
          </Notice>
        )}
        <Field label="Ce qui change (affiché aux personnes)" htmlFor="legal-summary">
          <input id="legal-summary" className="input" value={summary} maxLength={1000} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        {kind === 'cgu' && (
          <Check
            checked={important || forced}
            onChange={(v) => !forced && setImportant(v)}
            label="Changement important : demander une nouvelle acceptation"
            hint={forced ? 'La première version est toujours à accepter par tous.' : 'Sinon, les personnes sont simplement informées de la nouvelle version.'}
          />
        )}
        {content.trim() && !missing.length && <p className="small muted">Prêt à publier.</p>}
      </div>
    </Sheet>
  );
}
