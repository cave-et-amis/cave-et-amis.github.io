/**
 * Cave visuelle (maquette « Cave à vin 3D élégante ») : chaque emplacement de la cave est une étagère en chêne, chaque
 * bouteille en stock une vraie bouteille couchée, capsule de la couleur du vin, anneau doré quand elle est à boire.
 * Deux vues : la scène 3D (Three.js, chargée seulement ici) et une liste HTML, qui sert aussi de repli (pas de WebGL,
 * contexte perdu) et que les lecteurs d'écran lisent toujours. Toutes deux montrent les données réelles : lots,
 * emplacements, bouteilles libres. Déplacer des bouteilles passe par move_bottles (aucun mouvement de stock).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Box, List, Maximize2, Plus } from 'lucide-react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { buildRows } from '../../domain/cellar';
import { cellarLayout, freeBottles, MAX_ROWS, MAX_SLOTS, type CellarBottle } from '../../domain/cellarLayout';
import { currentYear } from '../../domain/format';
import { MATURITY_LABELS } from '../../domain/maturity';
import { colorLabel, wineTitle } from '../../domain/wine';
import { Button, EmptyState, Field, InlineLoading, Pill, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';
import { Stepper } from './fields';

const CellarScene3D = lazy(() => import('./scene/CellarScene3D'));

type View = '3d' | 'liste';
const VIEW_KEY = 'cave.plan.vue';

/** WebGL disponible sur cet appareil (sinon : vue liste). */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
function readView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === '3d' || v === 'liste' ? v : null;
  } catch {
    return null;
  }
}
function rememberView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // stockage indisponible (navigation privée) : sans gravité
  }
}

const bottleLabel = (b: CellarBottle, shelf: string) => `${wineTitle(b.row.wine)}, ${shelf}, bouteille ${b.index} sur ${b.lot.quantity}`;

export function CellarMapPage() {
  const { snapshot, userId, api, run } = useStore();
  const cellars = snapshot.cellars.filter((c) => c.owner_id === userId).sort((a, b) => a.position - b.position);
  const [cellarId, setCellarId] = useState(cellars[0]?.id ?? '');
  const webgl = useMemo(() => webglAvailable(), []);
  const [view, setView] = useState<View>(() => (webgl ? (readView() ?? '3d') : 'liste'));
  const [lost, setLost] = useState(false);
  const [open, setOpen] = useState<CellarBottle | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [moving, setMoving] = useState<CellarBottle | null>(null);
  const [adding, setAdding] = useState(false);
  const year = currentYear();
  const show3d = view === '3d' && webgl && !lost;

  const shelves = useMemo(() => {
    const rows = buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year, snapshot.groupShares);
    return cellarLayout(cellarId, snapshot.locations, snapshot.lots, rows);
  }, [snapshot, cellarId, year]);
  const bottles = shelves.reduce((n, s) => n + s.bottles.length + s.overflow, 0);

  // Bouteilles qui viennent d'apparaître (après un déplacement ou un ajout) : elles « entrent » dans leur casier.
  const known = useRef<Set<string> | null>(null);
  const appearing = useMemo(() => {
    const keys = new Set(shelves.flatMap((s) => s.bottles.map((b) => b.key)));
    const before = known.current;
    known.current = keys;
    return before ? new Set([...keys].filter((k) => !before.has(k))) : new Set<string>();
  }, [shelves]);
  useEffect(() => {
    setFocus(null);
    setOpen(null);
  }, [cellarId]);

  const changeView = (v: View) => {
    setView(v);
    rememberView(v);
  };
  const shelfOf = (b: CellarBottle) => shelves.find((s) => s.id === b.shelfId)!;
  const pick = (key: string) => {
    const b = shelves.flatMap((s) => s.bottles).find((x) => x.key === key);
    if (b) setOpen(b);
  };

  if (!cellars.length) {
    return (
      <EmptyState icon="🍷" title="Pas encore de cave" action={<Button onClick={() => go('/cave')}>Ma cave</Button>}>
        Ajoutez une bouteille : votre cave apparaîtra ici, étagère par étagère.
      </EmptyState>
    );
  }

  return (
    <div className="stack cellar-page">
      <div className="cellar-toolbar">
        {cellars.length > 1 ? (
          <div className="cellar-tabs" role="group" aria-label="Cave affichée">
            {cellars.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === cellarId} onClick={() => setCellarId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <span className="cellar-name">{cellars[0].name}</span>
        )}
        <div className="cellar-views" role="group" aria-label="Affichage">
          <button type="button" aria-pressed={show3d} disabled={!webgl || lost} onClick={() => changeView('3d')} title={webgl && !lost ? 'Vue 3D' : 'La 3D n’est pas disponible sur cet appareil'}>
            <Box aria-hidden />
            <span className="sr-only">Vue 3D</span>
          </button>
          <button type="button" aria-pressed={!show3d} onClick={() => changeView('liste')} title="Vue liste">
            <List aria-hidden />
            <span className="sr-only">Vue liste</span>
          </button>
        </div>
      </div>

      {lost && <p className="small muted">La vue 3D s’est interrompue sur cet appareil : voici la vue liste.</p>}

      <section className={`cellar-map${show3d ? ' is-3d' : ''}`} aria-label={`Plan de la cave : ${bottles} bouteille${bottles > 1 ? 's' : ''}`}>
        {shelves.length === 0 && <p className="small cellar-map-empty">Aucune bouteille dans cette cave pour l’instant.</p>}
        {show3d && shelves.length > 0 && (
          <>
            <Suspense fallback={<InlineLoading text="Préparation de la cave en 3D…" />}>
              <CellarScene3D
                shelves={shelves}
                focus={focus}
                hovered={hovered}
                selected={open?.key ?? moving?.key ?? null}
                appearing={appearing}
                onHover={setHovered}
                onPick={pick}
                onFocus={setFocus}
                onLost={() => setLost(true)}
              />
            </Suspense>
            {focus && (
              <button type="button" className="cellar3d-back" onClick={() => setFocus(null)}>
                <Maximize2 aria-hidden /> Vue générale
              </button>
            )}
          </>
        )}
        {/* Liste des étagères et des bouteilles : visible en vue liste ; en vue 3D, réservée au clavier et aux lecteurs d'écran. */}
        <div className={show3d ? 'sr-only' : 'cellar-list'}>
          {shelves.map((s) => (
            <div key={s.id} className="shelf">
              <span className="shelf-label">
                {s.label} <span className="shelf-count">{s.bottles.length + s.overflow}</span>
                {show3d && (
                  <button type="button" onClick={() => setFocus(s.id)}>
                    Zoomer sur {s.label}
                  </button>
                )}
              </span>
              {s.bottles.length === 0 ? (
                <span className="shelf-empty">Vide</span>
              ) : (
                <ul className="shelf-dots">
                  {s.bottles.map((b) => (
                    <li key={b.key}>
                      <button
                        type="button"
                        className={`bottle-dot c-${b.row.wine.color ?? 'autre'}${b.row.maturity === 'ready' || b.row.maturity === 'past' ? ' ready' : b.row.maturity === 'soon' ? ' soon' : ''}`}
                        aria-label={bottleLabel(b, s.label)}
                        onClick={() => setOpen(b)}
                        onFocus={() => show3d && setHovered(b.key)}
                        onBlur={() => show3d && setHovered(null)}
                      />
                    </li>
                  ))}
                  {s.overflow > 0 && <li className="shelf-more">+{s.overflow}</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <ul className="cellar-legend small" aria-label="Légende">
        <li>
          <i className="c-rouge" /> Vin rouge
        </li>
        <li>
          <i className="c-blanc" /> Vin blanc
        </li>
        <li>
          <i className="c-rose" /> Vin rosé
        </li>
        <li>
          <i className="c-effervescent" /> Effervescent
        </li>
        <li className="legend-ring">
          <i className="ring" /> À boire maintenant
        </li>
        <li className="legend-ring">
          <i className="ring dashed" /> Bientôt
        </li>
      </ul>

      <button type="button" className="shelf-add" onClick={() => setAdding(true)}>
        <span className="shelf-add-plus" aria-hidden>
          <Plus />
        </span>
        Ajouter une étagère
      </button>

      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open ? wineTitle(open.row.wine) : ''}>
        {open && (
          <div className="stack-sm">
            <p className="muted">{[open.row.wine.appellation || open.row.wine.region, colorLabel(open.row.wine.color)].filter(Boolean).join(' · ')}</p>
            <p>
              Emplacement : <strong>{shelfOf(open).name}</strong> · {open.lot.quantity} bouteille{open.lot.quantity > 1 ? 's' : ''} de ce lot, dont {freeBottles(open.lot)} libre
              {freeBottles(open.lot) > 1 ? 's' : ''}
            </p>
            <span>
              <Pill tone={open.row.maturity === 'ready' ? 'success' : open.row.maturity === 'past' ? 'danger' : open.row.maturity === 'soon' ? 'gold' : undefined}>
                {MATURITY_LABELS[open.row.maturity]}
              </Pill>
            </span>
            <span className="inline">
              <Button onClick={() => go(`/cave/vin/${open.row.wine.id}`)}>Voir la fiche</Button>
              {open.lot.owner_id === userId && (
                <Button
                  variant="secondary"
                  icon={<ArrowLeftRight />}
                  disabled={freeBottles(open.lot) === 0}
                  onClick={() => {
                    setMoving(open);
                    setOpen(null);
                  }}
                >
                  Déplacer
                </Button>
              )}
            </span>
            {freeBottles(open.lot) === 0 && <p className="small faint">Toutes les bouteilles de ce lot sont réservées ou mises à disposition d’un groupe : elles restent en place.</p>}
          </div>
        )}
      </Sheet>

      {moving && (
        <MoveSheet
          bottle={moving}
          from={shelfOf(moving).location?.id ?? null}
          places={shelves.filter((s) => s.location).map((s) => ({ id: s.location!.id, label: s.label }))}
          onClose={() => setMoving(null)}
          onMove={async (quantity, to, requestId) => {
            const res = await run(() => api.moveBottles(moving.lot.id, quantity, to, requestId), {
              success: `${quantity} bouteille${quantity > 1 ? 's' : ''} déplacée${quantity > 1 ? 's' : ''}`,
            });
            if (res.ok) {
              setMoving(null);
              setFocus(to ?? 'aucun');
            }
          }}
        />
      )}
      {adding && (
        <ShelfSheet
          onClose={() => setAdding(false)}
          onCreate={async (name, rows, slots) => {
            const res = await run(() => api.addLocation({ cellar_id: cellarId, name, kind: 'etagere', rows, slots_per_row: slots }), { success: `Étagère « ${name} » ajoutée` });
            if (res.ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function MoveSheet({
  bottle,
  from,
  places,
  onClose,
  onMove,
}: {
  bottle: CellarBottle;
  from: string | null;
  places: { id: string; label: string }[];
  onClose: () => void;
  onMove: (quantity: number, to: string | null, requestId: string) => Promise<void>;
}) {
  const free = freeBottles(bottle.lot);
  const options = [...places, { id: '', label: 'Sans emplacement' }].filter((p) => (p.id || null) !== from);
  const [to, setTo] = useState(options[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  // Une clé par déplacement choisi : un nouvel envoi après une coupure réseau ne déplace pas deux fois.
  const request = useRef({ key: '', id: newId() });
  const requestId = () => {
    const key = `${quantity}:${to}`;
    if (request.current.key !== key) request.current = { key, id: newId() };
    return request.current.id;
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Déplacer : ${wineTitle(bottle.row.wine)}`}
      footer={
        <Button
          loading={busy}
          disabled={!options.length}
          onClick={async () => {
            setBusy(true);
            await onMove(quantity, to || null, requestId());
            setBusy(false);
          }}
        >
          Confirmer le déplacement
        </Button>
      }
    >
      <div className="stack-sm">
        <Field label="Vers">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {options.map((p) => (
              <option key={p.id || 'aucun'} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre de bouteilles" hint={`${free} bouteille${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} dans ce lot ; les bouteilles réservées restent en place.`}>
          <Stepper value={quantity} onChange={setQuantity} min={1} max={free} label="Nombre de bouteilles" />
        </Field>
        <p className="small faint">Le stock ne change pas : seules les bouteilles changent de place.</p>
      </div>
    </Sheet>
  );
}

function ShelfSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, rows: number, slots: number) => Promise<void> }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState(2);
  const [slots, setSlots] = useState(12);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ajouter une étagère"
      footer={
        <Button
          loading={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            await onCreate(name.trim(), rows, slots);
            setBusy(false);
          }}
        >
          Ajouter l’étagère
        </Button>
      }
    >
      <div className="stack-sm">
        <Field label="Nom de l’étagère" hint="Par exemple : Haut, Casier du fond, Armoire de la cuisine.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Rangées">
          <Stepper value={rows} onChange={setRows} min={1} max={MAX_ROWS} label="Rangées" />
        </Field>
        <Field label="Casiers par rangée">
          <Stepper value={slots} onChange={setSlots} min={1} max={MAX_SLOTS} label="Casiers par rangée" />
        </Field>
        <div className="shelf-preview" aria-label={`Aperçu : ${rows} rangée${rows > 1 ? 's' : ''} de ${slots} casier${slots > 1 ? 's' : ''}, ${rows * slots} bouteilles`}>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="shelf-preview-row" style={{ gridTemplateColumns: `repeat(${slots}, 1fr)` }}>
              {Array.from({ length: slots }, (_, s) => (
                <i key={s} />
              ))}
            </div>
          ))}
        </div>
        <p className="small faint">
          {rows * slots} bouteilles au plus ; au-delà, la vue indique « +N ».
        </p>
      </div>
    </Sheet>
  );
}
