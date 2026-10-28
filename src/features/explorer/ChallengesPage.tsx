/**
 * Défis et découvertes (maquette Cave & Amis 2.0, panneau 10) : progression calculée sur l'appareil à partir du carnet
 * (src/domain/challenges.ts). Découvrir, pas boire plus : un verre goûté compte autant qu'une bouteille.
 */
import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useStore } from '../../data/store';
import { DISCOVERIES, itemLabel, monthlyChallenge, progress, type Progress } from '../../domain/challenges';
import { Button, Segmented } from '../../ui/kit';
import { useActions } from '../../ui/Shell';

type Tab = 'defis' | 'decouvertes';

function ChallengeCard({ p, kicker, extra }: { p: Progress; kicker: string; extra?: string }) {
  const actions = useActions();
  const c = p.challenge;
  return (
    <section className="challenge" aria-labelledby={`h-${c.id}`}>
      <img src={`/img/${c.image}.webp`} alt="" className="challenge-bg" />
      <div className="challenge-body">
        <span className="eyebrow">{kicker}</span>
        <h2 id={`h-${c.id}`} className="challenge-title">
          {c.title}
        </h2>
        <p className="small">{c.hint}</p>
        <p className="small strong">
          {Math.min(p.count, c.goal)} sur {c.goal}
          {extra ? ` · ${extra}` : ''}
          {p.complete ? ' · réussi !' : ''}
        </p>
        <span className="challenge-bar" aria-hidden>
          {Array.from({ length: c.goal }, (_, i) => (
            <i key={i} className={i < p.count ? 'on' : ''} />
          ))}
        </span>
        <ul className="challenge-items">
          {c.items.map((item) => (
            <li key={item} className={p.done.includes(item) ? 'done' : ''}>
              {itemLabel(c, item)}
              {p.done.includes(item) && <span className="sr-only"> (goûté)</span>}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" icon={<BookOpen />} onClick={() => actions.newTasting()}>
          Noter une dégustation
        </Button>
      </div>
    </section>
  );
}

export function ChallengesPage() {
  const { snapshot, userId } = useStore();
  const [tab, setTab] = useState<Tab>('defis');
  const month = useMemo(() => monthlyChallenge(), []);
  const monthly = useMemo(() => progress(month.challenge, snapshot.tastings.filter(month.inMonth), userId), [month, snapshot.tastings, userId]);
  const discoveries = useMemo(() => DISCOVERIES.map((d) => progress(d, snapshot.tastings, userId)), [snapshot.tastings, userId]);
  const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long' });

  return (
    <div className="stack">
      <Segmented<Tab>
        label="Défis et découvertes"
        options={[
          { value: 'defis', label: 'Défis' },
          { value: 'decouvertes', label: 'Découvertes' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'defis' ? (
        <ChallengeCard p={monthly} kicker={`Défi du mois · ${monthName}`} extra="dégustations de ce mois" />
      ) : (
        discoveries.map((p) => <ChallengeCard key={p.challenge.id} p={p} kicker="Découverte" extra="tout votre carnet" />)
      )}
      <p className="small faint">
        Découvrir, pas boire plus : une dégustation compte, même d’un seul verre. Calculé sur ce téléphone à partir de votre carnet (appellation, région,
        cépage ou couleur notés sur la fiche).
      </p>
    </div>
  );
}
