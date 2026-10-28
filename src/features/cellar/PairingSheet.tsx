/**
 * « Que boire avec… » (mission H de Cave & Amis 2.0) : le plat, ou le menu (entrée, plat, dessert), puis les bouteilles
 * libres de ma cave qui s'y prêtent, présélectionnées sur l'appareil par des règles simples (src/domain/pairing.ts), sans
 * IA, avec un niveau (« Parfait », « Excellent », « Belle alternative »). Lia affine sur demande.
 */
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '../../data/store';
import { buildRows, type WineRow } from '../../domain/cellar';
import { currentYear } from '../../domain/format';
import { DISH_FAMILIES, LEVEL_LABELS, pairingLevel, suggestPairings } from '../../domain/pairing';
import { Button, Chips, EmptyState, Field, Notice, Segmented, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';
import { WineItem } from '../../ui/WineItem';

/** Photo de chaque famille de plats (images générées, sans marque). */
const DISH_IMAGES: Record<string, string> = {
  mer: 'plat-fruits-de-mer',
  viande_rouge: 'plat-viande-rouge',
  viande_blanche: 'plat-volaille',
  poisson: 'plat-poisson',
  epice: 'plat-epice',
  vegetarien: 'plat-legumes',
  fromage: 'plat-fromage',
  charcuterie: 'plat-charcuterie',
  dessert: 'plat-dessert',
};
const LEVEL_DOTS = { parfait: 3, excellent: 2, alternative: 1 } as const;

type Mode = 'plat' | 'menu';
const COURSES = [
  { key: 'entree', label: 'Entrée', hint: 'Par exemple : huîtres, terrine, salade de chèvre.' },
  { key: 'plat', label: 'Plat', hint: 'Par exemple : magret de canard, curry, risotto.' },
  { key: 'dessert', label: 'Dessert', hint: 'Par exemple : tarte au citron, fondant au chocolat.' },
] as const;
type Course = (typeof COURSES)[number]['key'];

/** Ce que les règles proposent pour un plat : famille reconnue, photo, bouteilles avec leur niveau. */
function DishSuggestions({ dish, rows, limit }: { dish: string; rows: WineRow[]; limit: number }) {
  const { family, suggestions } = useMemo(() => suggestPairings(dish, rows, limit), [dish, rows, limit]);
  if (dish.trim().length >= 3 && !family) return <Notice>Je ne reconnais pas ce plat. Lia peut vous conseiller à partir de votre cave.</Notice>;
  if (!family) return null;
  return (
    <div className="stack-sm">
      <div className="dish-card">
        <img src={`/img/${DISH_IMAGES[family.id]}.webp`} alt="" width={72} height={72} />
        <p className="small">
          {family.label} : {family.tip}
        </p>
      </div>
      {suggestions.length === 0 ? (
        <EmptyState icon="🍽️" title="Aucune bouteille libre ne s’y prête vraiment">
          Lia peut chercher dans votre cave, ou vous suggérer quoi acheter.
        </EmptyState>
      ) : (
        <>
          <span className="eyebrow">Dans votre cave, disponibles</span>
          <div className="list">
            {suggestions.map((s, i) => {
              const level = pairingLevel(family, s.score);
              return (
                <div key={s.row.wine.id}>
                  {/* La fenêtre se ferme proprement avant d’ouvrir la fiche (historique du téléphone). */}
                  <WineItem row={s.row} index={i} onOpen={() => go(`/cave/vin/${s.row.wine.id}`)} />
                  <p className="small faint pairing-why">
                    <span className={`pairing-level ${level}`}>
                      <span className="pairing-dots" aria-hidden>
                        {[0, 1, 2].map((d) => (
                          <i key={d} className={d < LEVEL_DOTS[level] ? 'on' : ''} />
                        ))}
                      </span>
                      {LEVEL_LABELS[level]}
                    </span>
                    {s.reasons.join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function PairingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot, userId } = useStore();
  const [mode, setMode] = useState<Mode>('plat');
  const [dish, setDish] = useState('');
  const [menu, setMenu] = useState<Record<Course, string>>({ entree: '', plat: '', dessert: '' });
  const year = currentYear();
  // Seulement mes bouteilles (pas celles des caves gérées à plusieurs dont je ne suis pas propriétaire).
  const rows = useMemo(
    () => buildRows(snapshot.wines.filter((w) => w.owner_id === userId), snapshot.lots, snapshot.cellars, year, snapshot.groupShares),
    [snapshot, userId, year],
  );
  const filledMenu = COURSES.filter((c) => menu[c.key].trim());
  const canAsk = mode === 'plat' ? dish.trim().length >= 3 : filledMenu.some((c) => menu[c.key].trim().length >= 3);

  const ask = () => {
    let q: string;
    if (mode === 'plat') {
      const names = suggestPairings(dish, rows)
        .suggestions.map((s) => `${s.row.wine.name}${s.row.wine.vintage ? ` ${s.row.wine.vintage}` : ''}`)
        .join(', ');
      q = `Quel vin de ma cave ouvrir avec ${dish.trim()} ?${names ? ` J’hésite entre : ${names}.` : ''}`;
    } else {
      q = `Quels vins de ma cave ouvrir pour ce menu ? ${filledMenu.map((c) => `${c.label} : ${menu[c.key].trim()}`).join(' ; ')}.`;
    }
    onClose();
    go('/assistant?q=' + encodeURIComponent(q));
  };

  return (
    <Sheet open={open} onClose={onClose} title="Que boire avec…">
      <div className="stack">
        <Segmented<Mode>
          label="Quel est votre menu ?"
          options={[
            { value: 'plat', label: 'Plat unique' },
            { value: 'menu', label: 'Menu complet' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'plat' ? (
          <>
            <Field label="Votre plat" hint="Par exemple : magret de canard, huîtres, tarte au citron.">
              <input className="input" value={dish} onChange={(e) => setDish(e.target.value)} maxLength={120} autoFocus />
            </Field>
            <Chips
              label="Idées de plats"
              options={DISH_FAMILIES.slice(0, 6).map((f) => ({ value: f.words[0], label: f.label }))}
              value={null}
              onChange={(v) => v && setDish(String(v))}
            />
            <DishSuggestions dish={dish} rows={rows} limit={5} />
          </>
        ) : (
          COURSES.map((c) => (
            <div key={c.key} className="stack-sm">
              <Field label={c.label} hint={c.hint}>
                <input className="input" value={menu[c.key]} onChange={(e) => setMenu((m) => ({ ...m, [c.key]: e.target.value }))} maxLength={120} />
              </Field>
              <DishSuggestions dish={menu[c.key]} rows={rows} limit={3} />
            </div>
          ))
        )}
        <p className="small faint">Présélection par des règles simples parmi vos bouteilles libres, à affiner avec Lia.</p>
        <Button variant="secondary" icon={<Sparkles />} disabled={!canAsk} onClick={ask}>
          Demander à Lia
        </Button>
      </div>
    </Sheet>
  );
}
