/**
 * « Découvrir l'application » : une présentation en quelques écrans, sans compte et sans aucune donnée (visiteurs,
 * personnes invitées). Aucune cave, aucune bouteille, aucun nom n'y apparaît : seulement ce que permet l'application.
 */
import { useState, type ReactNode } from 'react';
import { CalendarHeart, KeyRound, Sparkles, Users, Wine } from 'lucide-react';
import { Button } from '../../ui/kit';

const SLIDES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <Wine />,
    title: 'Organisez votre cave',
    text: 'Chaque bouteille avec sa photo, son emplacement et le bon moment pour l’ouvrir. Ajoutez-la en photographiant l’étiquette : Lia remplit la fiche.',
  },
  {
    icon: <KeyRound />,
    title: 'Votre cave reste à vous',
    text: 'Elle est privée. Vous l’ouvrez à qui vous voulez, en entier ou seulement quelques bouteilles, et vous la refermez quand vous voulez.',
  },
  {
    icon: <Users />,
    title: 'Partagez avec vos amis',
    text: 'Invitez par un simple lien, même une personne sans compte. Créez des groupes (la famille, les amis du vendredi) pour partager quelques bouteilles.',
  },
  {
    icon: <CalendarHeart />,
    title: 'Préparez vos événements',
    text: 'Dîners et dégustations : invitez, prévoyez le menu, choisissez les vins ensemble. Chacun répond « Je viens », « Peut-être » ou « Je ne viens pas ».',
  },
  {
    icon: <Sparkles />,
    title: 'Lia, votre sommelière',
    text: 'Quel vin ouvrir ce soir ? Comment inviter un ami ? Lia répond, et ne modifie jamais rien sans votre accord.',
  },
];

export function Discover({ actions }: { actions: ReactNode }) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <section className="card stack" aria-roledescription="présentation" aria-label="Découvrir Cave & Amis">
      <div className="discover-slide" aria-live="polite">
        <span className="discover-icon" aria-hidden>
          {slide.icon}
        </span>
        <h2 className="title-font" style={{ fontSize: '1.3rem' }}>
          {slide.title}
        </h2>
        <p className="muted">{slide.text}</p>
      </div>
      <div className="dots" role="group" aria-label="Écrans de la présentation">
        {SLIDES.map((s, n) => (
          <button key={s.title} type="button" aria-label={`Écran ${n + 1} : ${s.title}`} aria-current={n === i ? 'true' : undefined} onClick={() => setI(n)} />
        ))}
      </div>
      {last ? (
        <div key="fin" className="stack-sm">
          {actions}
          <Button variant="ghost" block onClick={() => setI(i - 1)}>
            Précédent
          </Button>
        </div>
      ) : (
        <div key="navigation" className="inline" style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            Précédent
          </Button>
          <Button onClick={() => setI(i + 1)}>Suivant</Button>
        </div>
      )}
    </section>
  );
}
