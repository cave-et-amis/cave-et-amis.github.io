/**
 * Cave visuelle en 2D (maquette Cave & Amis 2.0, panneau 5) : chaque emplacement de la cave (étagère, casier, armoire,
 * carton) est une rangée, chaque bouteille en stock une pastille de la couleur du vin. Une pastille ouvre un aperçu du
 * vin (emplacement, maturité) et sa fiche. Rien de nouveau n'est enregistré : la vue se calcule à partir des lots.
 * Les bouteilles sans emplacement sont regroupées à part.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../data/store';
import { buildRows, type WineRow } from '../../domain/cellar';
import { currentYear } from '../../domain/format';
import { MATURITY_LABELS } from '../../domain/maturity';
import type { Lot } from '../../domain/types';
import { colorLabel, wineTitle } from '../../domain/wine';
import { Button, EmptyState, Field, Pill, Segmented, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';

/** Pastilles affichées par rangée au plus ; au-delà, « +N ». */
const MAX_DOTS = 60;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type Dot = { key: string; row: WineRow; lot: Lot; place: string; index: number };

export function CellarMapPage() {
  const { snapshot, userId, api, run } = useStore();
  const cellars = snapshot.cellars.filter((c) => c.owner_id === userId).sort((a, b) => a.position - b.position);
  const [cellarId, setCellarId] = useState(cellars[0]?.id ?? '');
  const [open, setOpen] = useState<Dot | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const year = currentYear();

  const shelves = useMemo(() => {
    const rows = buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year, snapshot.groupShares);
    const byLot = new Map<string, WineRow>();
    for (const r of rows) for (const l of r.lots) byLot.set(l.id, r);
    const locations = snapshot.locations.filter((l) => l.cellar_id === cellarId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'));
    const lots = snapshot.lots.filter((l) => l.cellar_id === cellarId && l.quantity > 0 && byLot.has(l.id));
    const dotsOf = (inPlace: Lot[], place: string): Dot[] =>
      inPlace.flatMap((lot) => Array.from({ length: lot.quantity }, (_, i) => ({ key: `${lot.id}:${i}`, row: byLot.get(lot.id)!, lot, place, index: i + 1 })));
    const out = locations.map((loc, i) => ({
      id: loc.id,
      // Repère par lettre (A, B…) devant le nom donné par la personne (« Casier du fond »…).
      label: `${i < LETTERS.length ? `${LETTERS[i]} · ` : ''}${loc.name}`,
      dots: dotsOf(
        lots.filter((l) => l.location_id === loc.id),
        loc.name,
      ),
    }));
    const loose = lots.filter((l) => !l.location_id || !locations.some((loc) => loc.id === l.location_id));
    if (loose.length) out.push({ id: 'aucun', label: 'Sans emplacement', dots: dotsOf(loose, 'sans emplacement') });
    return out;
  }, [snapshot, cellarId, year]);

  const bottles = shelves.reduce((n, s) => n + s.dots.length, 0);

  async function addShelf() {
    const name = newName.trim();
    if (!name) return;
    const res = await run(() => api.addLocation({ cellar_id: cellarId, name, kind: 'etagere' }), { success: `Étagère « ${name} » ajoutée` });
    if (res.ok) {
      setAdding(false);
      setNewName('');
    }
  }

  if (!cellars.length) {
    return (
      <EmptyState icon="🍷" title="Pas encore de cave" action={<Button onClick={() => go('/cave')}>Ma cave</Button>}>
        Ajoutez une bouteille : votre cave apparaîtra ici, étagère par étagère.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {cellars.length > 1 && (
        <Segmented label="Cave affichée" options={cellars.map((c) => ({ value: c.id, label: c.name }))} value={cellarId} onChange={setCellarId} wrap />
      )}
      <section className="cellar-map" aria-label={`Plan de la cave : ${bottles} bouteille${bottles > 1 ? 's' : ''}`}>
        {shelves.length === 0 && <p className="small cellar-map-empty">Aucune bouteille dans cette cave pour l’instant.</p>}
        {shelves.map((s) => (
          <div key={s.id} className="shelf">
            <span className="shelf-label">
              {s.label} <span className="shelf-count">{s.dots.length}</span>
            </span>
            {s.dots.length === 0 ? (
              <span className="shelf-empty">Vide</span>
            ) : (
              <ul className="shelf-dots">
                {s.dots.slice(0, MAX_DOTS).map((d) => (
                  <li key={d.key}>
                    <button
                      type="button"
                      className={`bottle-dot c-${d.row.wine.color ?? 'autre'}${d.row.maturity === 'ready' || d.row.maturity === 'soon' ? ' ready' : ''}`}
                      aria-label={`${wineTitle(d.row.wine)}, ${s.label}, bouteille ${d.index} sur ${d.lot.quantity}`}
                      onClick={() => setOpen(d)}
                    />
                  </li>
                ))}
                {s.dots.length > MAX_DOTS && <li className="shelf-more">+{s.dots.length - MAX_DOTS}</li>}
              </ul>
            )}
          </div>
        ))}
      </section>
      <p className="small faint">Une pastille par bouteille, de la couleur du vin ; un liseré doré : à boire maintenant ou bientôt.</p>
      <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
        Ajouter une étagère
      </Button>

      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open ? wineTitle(open.row.wine) : ''}>
        {open && (
          <div className="stack-sm">
            <p className="muted">
              {[open.row.wine.appellation || open.row.wine.region, colorLabel(open.row.wine.color)].filter(Boolean).join(' · ')}
            </p>
            <p>
              Emplacement : <strong>{open.place}</strong> · {open.lot.quantity} bouteille{open.lot.quantity > 1 ? 's' : ''} de ce lot
            </p>
            <span>
              <Pill tone={open.row.maturity === 'ready' ? 'success' : open.row.maturity === 'past' ? 'danger' : open.row.maturity === 'soon' ? 'gold' : undefined}>
                {MATURITY_LABELS[open.row.maturity]}
              </Pill>
            </span>
            <Button onClick={() => go(`/cave/vin/${open.row.wine.id}`)}>Voir la fiche</Button>
          </div>
        )}
      </Sheet>
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Ajouter une étagère"
        footer={
          <Button disabled={!newName.trim()} onClick={() => void addShelf()}>
            Ajouter l’étagère
          </Button>
        }
      >
        <Field label="Nom de l’étagère" hint="Par exemple : Haut, Casier du fond, Armoire de la cuisine.">
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} autoFocus />
        </Field>
      </Sheet>
    </div>
  );
}
