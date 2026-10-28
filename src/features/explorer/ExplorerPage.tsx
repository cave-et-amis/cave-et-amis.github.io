/**
 * Explorer (Cave & Amis 2.0) : chercher un vin dans le dictionnaire des vins français (LWIN, sans IA ni serveur), puis
 * l'ajouter à ma cave ou à mes envies ; accès au scanner, aux caves des amis et aux accords mets et vins.
 */
import { Camera, Heart, Plus, Search, ScanLine, Users, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadLwin } from '../../data/lwin';
import { LWIN_CREDIT, LWIN_LICENCE_URL, searchLwin, type LwinWine } from '../../domain/lwin';
import { COLORS } from '../../domain/wine';
import { Button } from '../../ui/kit';
import { go } from '../../ui/router';
import { useActions } from '../../ui/Shell';
import { PairingSheet } from '../cellar/PairingSheet';

/** Appellations connues de chaque grande région, pour une première recherche. */
const IDEAS = ['Pauillac', 'Saint-Émilion', 'Margaux', 'Chablis', 'Meursault', 'Gevrey-Chambertin', 'Sancerre', 'Vouvray', 'Châteauneuf-du-Pape', 'Côte-Rôtie', 'Champagne', 'Bandol', 'Cahors', 'Jurançon'];

export function ExplorerPage() {
  const actions = useActions();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LwinWine[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle');
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) {
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
          setResults(searchLwin(index, q, 12));
        })
        .catch(() => alive && setState('offline'));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const fields = (w: LwinWine) => ({ name: w.name, cuvee: w.cuvee, appellation: w.appellation, region: w.region, color: w.color });

  return (
    <div className="stack explore-page">
      <section className="explore-hero" aria-labelledby="h-explore">
        <img src="/img/decouverte-raisin.webp" alt="" />
        <div>
          <h2 id="h-explore">Explorer les vins</h2>
          <p>Plus de 60 000 vins français, appellations et domaines : trouvez-en un, ajoutez-le à votre cave ou à vos envies.</p>
        </div>
      </section>

      <div className="search">
        <Search aria-hidden />
        <input
          className="input"
          type="search"
          placeholder="Château, domaine, appellation…"
          aria-label="Rechercher un vin"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {q.trim().length >= 3 && (
        <section className="stack-sm" aria-live="polite" aria-label="Résultats">
          {state === 'offline' ? (
            <p className="small faint">Recherche indisponible sans connexion.</p>
          ) : state === 'loading' && !results.length ? (
            <p className="small faint">Recherche dans le dictionnaire des vins…</p>
          ) : !results.length ? (
            <p className="small faint">Aucun vin trouvé. Vous pouvez l’ajouter vous-même avec le bouton « Ajouter ».</p>
          ) : (
            <ul className="list explore-results">
              {results.map((w) => (
                <li key={w.lwin} className="row">
                  <span className="dot" style={{ background: w.color ? `var(--wine-${w.color})` : 'var(--line)', width: 12, height: 12 }} aria-hidden />
                  <span className="row-main">
                    <span className="row-title">{w.cuvee ? `${w.name}, ${w.cuvee}` : w.name}</span>
                    <span className="row-sub">{[w.appellation, w.region, COLORS.find((c) => c.value === w.color)?.label.toLowerCase()].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="explore-actions">
                    <Button size="sm" icon={<Plus />} aria-label={`Ajouter ${w.name} à ma cave`} onClick={() => actions.newWine({ wine: { ...fields(w), country: 'France', wine_type: w.wine_type } })}>
                      <span className="explore-label">Ma cave</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Heart />}
                      aria-label={`Ajouter ${w.name} à mes envies`}
                      onClick={() => actions.newWish({ wine_name: w.cuvee ? `${w.name}, ${w.cuvee}` : w.name, appellation: w.appellation, region: w.region, color: w.color })}
                    >
                      <span className="explore-label">Envies</span>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="small faint" style={{ margin: 0 }}>
            {LWIN_CREDIT}{' '}
            <a href={LWIN_LICENCE_URL} target="_blank" rel="noopener noreferrer">
              Licence
            </a>
          </p>
        </section>
      )}

      {q.trim().length < 3 && (
        <section className="card stack-sm" aria-labelledby="h-explore-ideas">
          <div className="section-title">
            <h2 id="h-explore-ideas">
              Appellations à découvrir
              <small>Un clic lance la recherche</small>
            </h2>
          </div>
          <div className="explore-chips">
            {IDEAS.map((idea) => (
              <button key={idea} type="button" onClick={() => setQ(idea)}>
                {idea}
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="h-explore-more">
        <h2 id="h-explore-more" className="sr-only">
          Autres façons de découvrir
        </h2>
        <div className="shortcuts">
          <button type="button" className="shortcut" onClick={() => go('/scanner')}>
            <ScanLine aria-hidden />
            Scanner en magasin
            <span className="hint">Prix et avis avant d’acheter</span>
          </button>
          <button type="button" className="shortcut" onClick={actions.scanLabel}>
            <Camera aria-hidden />
            Photo d’étiquette
            <span className="hint">La fiche se remplit seule</span>
          </button>
          <button type="button" className="shortcut" onClick={() => go('/amis')}>
            <Users aria-hidden />
            Caves de mes amis
            <span className="hint">Ce qu’ils vous partagent</span>
          </button>
          <button type="button" className="shortcut" onClick={() => setPairing(true)}>
            <UtensilsCrossed aria-hidden />
            Accords mets-vins
            <span className="hint">Quel vin pour quel plat</span>
          </button>
        </div>
      </section>
      <PairingSheet open={pairing} onClose={() => setPairing(false)} />
    </div>
  );
}
