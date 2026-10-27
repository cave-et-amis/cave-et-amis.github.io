/**
 * Suggestions sous le nom du vin, tirées du dictionnaire LWIN des vins français : sans IA, sans serveur, sans quota.
 * Choisir une suggestion remplit nom, cuvée, appellation, région, pays, couleur et type ; tout reste modifiable.
 */
import { useEffect, useState } from 'react';
import { loadLwin } from '../../data/lwin';
import { LWIN_CREDIT, LWIN_LICENCE_URL, searchLwin, type LwinWine } from '../../domain/lwin';
import { COLORS } from '../../domain/wine';

export function LwinSuggest({ query, active, onPick }: { query: string; active: boolean; onPick: (w: LwinWine) => void }) {
  const [results, setResults] = useState<LwinWine[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle');

  useEffect(() => {
    if (!active || query.trim().length < 3) {
      setResults([]);
      return;
    }
    let alive = true;
    // Petite pause : la recherche part quand on s'arrête de taper.
    const timer = setTimeout(() => {
      setState((s) => (s === 'ready' ? s : 'loading'));
      loadLwin()
        .then((index) => {
          if (!alive) return;
          setState('ready');
          setResults(searchLwin(index, query));
        })
        .catch(() => alive && setState('offline'));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, active]);

  if (!active || query.trim().length < 3) return null;
  if (state === 'offline') return <p className="small faint">Suggestions indisponibles sans connexion : saisissez le vin vous-même.</p>;
  if (state === 'loading' && !results.length) return <p className="small faint">Recherche dans le dictionnaire des vins…</p>;
  if (!results.length) return null;
  return (
    <div className="stack-sm" aria-live="polite">
      <div className="list" role="list" aria-label="Vins correspondants">
        {results.map((w) => (
          <button key={w.lwin} type="button" role="listitem" className="row" style={{ textAlign: 'left', width: '100%' }} onClick={() => onPick(w)}>
            <span className="row-main">
              <span className="row-title">{w.cuvee ? `${w.name}, ${w.cuvee}` : w.name}</span>
              <span className="row-sub">{[w.appellation, w.region, COLORS.find((c) => c.value === w.color)?.label.toLowerCase()].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="small faint" style={{ margin: 0 }}>
        {LWIN_CREDIT}{' '}
        <a href={LWIN_LICENCE_URL} target="_blank" rel="noopener noreferrer">
          Licence
        </a>
      </p>
    </div>
  );
}
