import { BookOpen, Camera, Heart, PenLine, ScanSearch } from 'lucide-react';
import { useActions } from '../../ui/Shell';
import { Sheet } from '../../ui/kit';
import { go } from '../../ui/router';

export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actions = useActions();
  const choose = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const items = [
    { icon: <ScanSearch />, title: 'Scanner avant d’acheter', hint: 'En magasin : Lia identifie la bouteille et relève le prix du rayon. Rien n’est ajouté sans vous.', run: () => go('/scanner') },
    { icon: <Camera />, title: 'Photographier une étiquette', hint: 'L’assistant lit l’étiquette et pré-remplit la fiche, que vous vérifiez.', run: actions.scanLabel },
    { icon: <PenLine />, title: 'Saisir un vin', hint: 'Nom, millésime, quantité : le reste est facultatif.', run: () => actions.newWine() },
    { icon: <BookOpen />, title: 'Enregistrer une dégustation', hint: 'Un vin goûté ici ou ailleurs, même s’il n’est pas dans votre cave.', run: () => actions.newTasting() },
    { icon: <Heart />, title: 'Ajouter à ma liste d’envies', hint: 'Un vin à acheter ou à goûter un jour.', run: () => actions.newWish() },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter">
      <div className="list" style={{ boxShadow: 'none' }}>
        {items.map((it) => (
          <button key={it.title} type="button" className="row" onClick={choose(it.run)}>
            <span className="bottle-thumb" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }} aria-hidden>
              {it.icon}
            </span>
            <span className="row-main">
              <span className="row-title" style={{ whiteSpace: 'normal' }}>
                {it.title}
              </span>
              <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                {it.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
