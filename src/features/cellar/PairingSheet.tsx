/**
 * « Que boire avec… » (mission H de Cave & Amis 2.0) : le plat, puis les bouteilles libres de ma cave qui s'y prêtent,
 * présélectionnées sur l'appareil par des règles simples (src/domain/pairing.ts), sans IA. Lia affine sur demande.
 */
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '../../data/store';
import { buildRows } from '../../domain/cellar';
import { currentYear } from '../../domain/format';
import { DISH_FAMILIES, suggestPairings } from '../../domain/pairing';
import { Button, Chips, EmptyState, Field, Notice, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';
import { WineItem } from '../../ui/WineItem';

export function PairingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot, userId } = useStore();
  const [dish, setDish] = useState('');
  const year = currentYear();
  // Seulement mes bouteilles (pas celles des caves gérées à plusieurs dont je ne suis pas propriétaire).
  const rows = useMemo(
    () => buildRows(snapshot.wines.filter((w) => w.owner_id === userId), snapshot.lots, snapshot.cellars, year, snapshot.groupShares),
    [snapshot, userId, year],
  );
  const { family, suggestions } = useMemo(() => suggestPairings(dish, rows), [dish, rows]);
  const ask = () => {
    const names = suggestions.map((s) => `${s.row.wine.name}${s.row.wine.vintage ? ` ${s.row.wine.vintage}` : ''}`).join(', ');
    onClose();
    go('/assistant?q=' + encodeURIComponent(`Quel vin de ma cave ouvrir avec ${dish.trim()} ?${names ? ` J’hésite entre : ${names}.` : ''}`));
  };

  return (
    <Sheet open={open} onClose={onClose} title="Que boire avec…">
      <div className="stack">
        <Field label="Votre plat" hint="Par exemple : magret de canard, huîtres, tarte au citron.">
          <input className="input" value={dish} onChange={(e) => setDish(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Chips
          label="Idées de plats"
          options={DISH_FAMILIES.slice(0, 6).map((f) => ({ value: f.words[0], label: f.label }))}
          value={null}
          onChange={(v) => v && setDish(String(v))}
        />
        {dish.trim().length >= 3 && !family && (
          <Notice>Je ne reconnais pas ce plat. Lia peut vous conseiller à partir de votre cave.</Notice>
        )}
        {family && (
          <>
            <p className="small muted">
              {family.label} : {family.tip} Présélection par des règles simples parmi vos bouteilles libres, à affiner avec Lia.
            </p>
            {suggestions.length === 0 ? (
              <EmptyState icon="🍽️" title="Aucune bouteille libre ne s’y prête vraiment">
                Lia peut chercher dans votre cave, ou vous suggérer quoi acheter.
              </EmptyState>
            ) : (
              <div className="list">
                {suggestions.map((s, i) => (
                  <div key={s.row.wine.id}>
                    {/* La fenêtre se ferme proprement avant d’ouvrir la fiche (historique du téléphone). */}
                    <WineItem row={s.row} index={i} onOpen={() => go(`/cave/vin/${s.row.wine.id}`)} />
                    <p className="small faint" style={{ margin: '2px 12px 8px' }}>
                      {s.reasons.join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Button variant="secondary" icon={<Sparkles />} disabled={dish.trim().length < 3} onClick={ask}>
          Demander à Lia
        </Button>
      </div>
    </Sheet>
  );
}
