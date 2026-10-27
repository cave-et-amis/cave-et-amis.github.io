import { useMemo, useState } from 'react';
import { BookOpen, ChartColumn, Download, Search, SlidersHorizontal } from 'lucide-react';
import { useStore } from '../../data/store';
import { activeFilterCount, applyFilters, buildRows, cellarCsv, EMPTY_FILTERS, sortRows, type Filters, type Sort } from '../../domain/cellar';
import { currentYear, parseNumber } from '../../domain/format';
import { MATURITY_LABELS, type Maturity } from '../../domain/maturity';
import { COLORS } from '../../domain/wine';
import type { Color } from '../../domain/types';
import { useActions } from '../../ui/Shell';
import { Button, Check, EmptyState, Field, Segmented, Sheet } from '../../ui/kit';
import { routeQuery } from '../../ui/router';
import { WineItem } from '../../ui/WineItem';
import { FirstTip } from '../tour/Tour';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Nom' },
  { value: 'maturity', label: 'À boire en premier' },
  { value: 'vintage', label: 'Millésime' },
  { value: 'recent', label: 'Ajout récent' },
  { value: 'stock', label: 'Quantité' },
];

const QUICK_MATURITY: Maturity[] = ['past', 'soon', 'ready', 'young'];

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CellarPage() {
  const { snapshot, location, cellarLabel } = useStore();
  const actions = useActions();
  const query = routeQuery();
  const year = currentYear();
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    maturity: (['young', 'ready', 'soon', 'past'] as string[]).includes(query.get('maturite') ?? '') ? (query.get('maturite') as Maturity) : null,
  }));
  const [sort, setSort] = useState<Sort>(query.get('tri') === 'maturite' ? 'maturity' : 'name');
  const [panel, setPanel] = useState(false);

  const rows = useMemo(() => buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year), [snapshot.wines, snapshot.lots, snapshot.cellars, year]);
  const shown = useMemo(() => sortRows(applyFilters(rows, filters), sort), [rows, filters, sort]);
  const count = activeFilterCount(filters);
  const bottles = shown.reduce((s, r) => s + r.stock, 0);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleColor = (c: Color) => set({ colors: filters.colors.includes(c) ? filters.colors.filter((x) => x !== c) : [...filters.colors, c] });

  if (snapshot.wines.length === 0) {
    return (
      <EmptyState icon="🍾" title="Votre cave est vide" action={<Button onClick={actions.add}>Ajouter un vin</Button>}>
        Photographiez une étiquette ou saisissez un vin : nom, millésime et quantité suffisent pour commencer.
      </EmptyState>
    );
  }

  return (
    <>
      <FirstTip id="cave" title="Votre cave" onHelp={actions.help}>
        « Ajouter » pour une nouvelle bouteille, la recherche et les « Filtres » pour la retrouver. Chaque bouteille reste privée tant que vous ne
        choisissez pas de la partager (fiche du vin › « Lot et partage »).
      </FirstTip>
      {/* Carnet et statistiques : rangés dans Statistiques, accessibles aussi depuis la cave. */}
      <div className="inline cellar-links">
        <a className="pill-link" href="#/statistiques?onglet=carnet">
          <BookOpen aria-hidden />
          Mon carnet
        </a>
        <a className="pill-link" href="#/statistiques">
          <ChartColumn aria-hidden />
          Statistiques
        </a>
      </div>

      <div className="stack-sm">
        <div className="search">
          <Search aria-hidden />
          <input
            className="input"
            type="search"
            placeholder="Nom, domaine, appellation, cépage, millésime…"
            aria-label="Rechercher dans ma cave"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        <div className="subtabs" role="group" aria-label="Couleur">
          {COLORS.filter((c) => c.value !== 'autre').map((c) => (
            <button key={c.value} type="button" aria-pressed={filters.colors.includes(c.value)} onClick={() => toggleColor(c.value)}>
              <span className="dot" style={{ background: `var(--wine-${c.value})`, width: 12, height: 12 }} aria-hidden />
              {c.label}
            </button>
          ))}
        </div>
        <div className="subtabs" role="group" aria-label="Maturité">
          {QUICK_MATURITY.map((m) => (
            <button key={m} type="button" aria-pressed={filters.maturity === m} onClick={() => set({ maturity: filters.maturity === m ? null : m })}>
              {MATURITY_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="inline" style={{ flexWrap: 'nowrap' }}>
          <select className="input" style={{ minHeight: 42, flex: 1, minWidth: 0, maxWidth: 320, padding: '6px 10px' }} aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
          </select>
          <Button variant="secondary" size="sm" icon={<SlidersHorizontal />} onClick={() => setPanel(true)}>
            Filtres{count ? ` (${count})` : ''}
          </Button>
        </div>
        <span className="small muted" aria-live="polite">
          {shown.length} vin{shown.length > 1 ? 's' : ''} · {bottles} bouteille{bottles > 1 ? 's' : ''}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="🔎" title="Aucun vin ne correspond" action={<Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Effacer la recherche et les filtres</Button>}>
          Essayez d’autres mots, ou affichez aussi les vins épuisés dans les filtres.
        </EmptyState>
      ) : (
        <div className="list">
          {shown.map((r, i) => (
            <WineItem key={r.wine.id} row={r} index={i} />
          ))}
        </div>
      )}

      <Button
        variant="ghost"
        icon={<Download />}
        onClick={() => download(`ma-cave-${new Date().toISOString().slice(0, 10)}.csv`, cellarCsv(shown, snapshot.cellars, (id) => location(id)?.name ?? ''))}
      >
        Exporter ces vins (tableur)
      </Button>

      <Sheet
        open={panel}
        onClose={() => setPanel(false)}
        title="Filtres"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>
              Tout effacer
            </Button>
            <Button onClick={() => setPanel(false)}>Voir {shown.length} vin{shown.length > 1 ? 's' : ''}</Button>
          </>
        }
      >
        <div className="form">
          <Field label="Stock">
            <Segmented<Filters['stock']>
              label="Stock"
              value={filters.stock}
              onChange={(stock) => set({ stock })}
              options={[
                { value: 'in', label: 'En stock' },
                { value: 'all', label: 'Tous' },
                { value: 'empty', label: 'Épuisés' },
              ]}
            />
          </Field>
          <Field label="Région, pays ou appellation" htmlFor="f-region">
            <input id="f-region" className="input" value={filters.region} onChange={(e) => set({ region: e.target.value })} placeholder="Bourgogne, Loire, Italie…" />
          </Field>
          <div className="field-row">
            <Field label="Millésime de" htmlFor="f-vf">
              <input id="f-vf" className="input" inputMode="numeric" value={filters.vintageFrom ?? ''} onChange={(e) => set({ vintageFrom: parseNumber(e.target.value) })} />
            </Field>
            <Field label="à" htmlFor="f-vt">
              <input id="f-vt" className="input" inputMode="numeric" value={filters.vintageTo ?? ''} onChange={(e) => set({ vintageTo: parseNumber(e.target.value) })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Prix d’achat min. (€)" htmlFor="f-pmin">
              <input id="f-pmin" className="input" inputMode="decimal" value={filters.priceMin ?? ''} onChange={(e) => set({ priceMin: parseNumber(e.target.value) })} />
            </Field>
            <Field label="max. (€)" htmlFor="f-pmax">
              <input id="f-pmax" className="input" inputMode="decimal" value={filters.priceMax ?? ''} onChange={(e) => set({ priceMax: parseNumber(e.target.value) })} />
            </Field>
          </div>
          <Field label="Maturité">
            <select className="input" value={filters.maturity ?? ''} onChange={(e) => set({ maturity: (e.target.value || null) as Maturity | null })}>
              <option value="">Toutes</option>
              {(['past', 'soon', 'ready', 'young', 'unknown'] as Maturity[]).map((m) => (
                <option key={m} value={m}>
                  {MATURITY_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          {snapshot.cellars.length > 1 && (
            <Field label="Cave">
              <select className="input" value={filters.cellarId ?? ''} onChange={(e) => set({ cellarId: e.target.value || null, locationId: null })}>
                <option value="">Toutes les caves</option>
                {snapshot.cellars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cellarLabel(c)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {snapshot.locations.length > 0 && (
            <Field label="Emplacement">
              <select className="input" value={filters.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value || null })}>
                <option value="">Tous les emplacements</option>
                {snapshot.locations
                  .filter((l) => !filters.cellarId || l.cellar_id === filters.cellarId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {snapshot.cellars.length > 1 ? `${snapshot.cellars.find((c) => c.id === l.cellar_id)?.name} › ` : ''}
                      {l.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Check checked={filters.favorite} onChange={(favorite) => set({ favorite })} label="Favoris seulement" />
          <Check checked={filters.shared} onChange={(shared) => set({ shared })} label="Partagés avec mes amis seulement" />
        </div>
      </Sheet>
    </>
  );
}
