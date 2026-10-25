/**
 * Photo officielle de la bouteille depuis Open Food Facts (licence CC BY-SA : réutilisable en citant la source).
 * Recherche par code-barres (produit exact) puis par nom ; la personne choisit, ou garde sa propre photo.
 */
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../../data/store';
import { Button, InlineLoading, Notice } from '../../ui/kit';

type Candidate = { code: string; name: string; brand: string | null; thumb: string; exact: boolean; url: string };
export type OfficialChoice = { path: string; credit: string; code: string; exact: boolean };

/** Mention de source : le texte, puis le lien vers la fiche Open Food Facts s'il y en a un. */
export function PhotoCredit({ credit }: { credit: string | null }) {
  if (!credit) return null;
  const m = /^(.*?)\s*—\s*(https:\/\/\S+)$/.exec(credit);
  return (
    <p className="small muted photo-credit">
      {m ? (
        <>
          {m[1]} —{' '}
          <a href={m[2]} target="_blank" rel="noreferrer noopener">
            voir la source
          </a>
        </>
      ) : (
        credit
      )}
    </p>
  );
}

export function OfficialPhoto({
  query,
  auto,
  onChoose,
}: {
  query: { barcode: string; name: string; vintage: number | null; appellation: string; producer: string };
  /** Chercher dès l'ouverture (code-barres lu par l'assistant). */
  auto: boolean;
  onChoose: (c: OfficialChoice) => void;
}) {
  const { api } = useStore();
  const [state, setState] = useState<'idle' | 'search' | 'done' | 'import' | 'chosen'>('idle');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  async function search() {
    setState('search');
    setMessage(null);
    const res = await api.ai('photo_search', {
      barcode: query.barcode || null,
      name: query.name,
      vintage: query.vintage,
      appellation: query.appellation || null,
      producer: query.producer || null,
    });
    setState('done');
    if (!res.ok) return setMessage(res.message);
    setCandidates((res.candidates as Candidate[]) ?? []);
  }

  useEffect(() => {
    if (auto && !started.current && (query.barcode || query.name)) {
      started.current = true;
      void search();
    }
  });

  async function choose(c: Candidate) {
    setState('import');
    const res = await api.ai('photo_import', { code: c.code });
    if (!res.ok) {
      setState('done');
      return setMessage(res.message);
    }
    setCandidates([]);
    setState('chosen');
    onChoose({ path: res.path as string, credit: res.credit as string, code: c.code, exact: c.exact });
  }

  const canSearch = Boolean(query.barcode || query.name.trim());
  return (
    <div className="stack-sm">
      {state === 'chosen' && <p className="small muted">Photo officielle ajoutée ci-dessus. Vous pouvez la retirer ou la remplacer par la vôtre.</p>}
      {(state === 'idle' || (state === 'done' && candidates.length === 0)) && (
        <Button variant="secondary" size="sm" icon={<Search />} disabled={!canSearch} onClick={() => void search()}>
          {state === 'idle' ? 'Chercher la photo officielle (Open Food Facts)' : 'Relancer la recherche'}
        </Button>
      )}
      {state === 'search' && <InlineLoading text="Recherche dans Open Food Facts…" />}
      {state === 'import' && <InlineLoading text="Import de la photo…" />}
      {message && <Notice tone="warn">{message}</Notice>}
      {state === 'done' && !message && candidates.length === 0 && (
        <Notice tone="info">Aucune photo trouvée dans Open Food Facts pour ce vin. Vous pouvez garder ou prendre votre propre photo.</Notice>
      )}
      {candidates.length > 0 && (
        <>
          <p className="small muted">
            Photos de la base ouverte Open Food Facts (licence CC BY-SA). Vérifiez que c’est bien votre vin
            {query.vintage ? ` (millésime ${query.vintage})` : ''} avant de choisir.
          </p>
          <ul className="photo-candidates">
            {candidates.map((c) => (
              <li key={c.code}>
                <img src={c.thumb} alt={c.name} loading="lazy" />
                <span className="small strong">{c.name}</span>
                {c.brand && <span className="small muted">{c.brand}</span>}
                {c.exact && <span className="pill small">Même code-barres</span>}
                <Button size="sm" onClick={() => void choose(c)}>
                  Utiliser cette photo
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => (setCandidates([]), setState('idle'))}>
            Aucune ne correspond
          </Button>
        </>
      )}
    </div>
  );
}
