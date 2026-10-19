/**
 * Ajout d'un vin (fiche + premier lot) ou modification d'une fiche. Formulaire court ; les champs avancés
 * sont repliés. Après une lecture d'étiquette, les informations incertaines sont signalées et les inconnues restent vides.
 */
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { currentYear, parseNumber, todayIso } from '../../domain/format';
import { fold, LOCATION_KINDS, VOLUMES, WINE_TYPES, wineTitle } from '../../domain/wine';
import type { AdviceSource, Color, Visibility, Wine, WineType } from '../../domain/types';
import { Advanced, Button, Check, Field, Notice, Origin, Sheet, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { ColorChips, PhotoField, Stepper, Uncertain, VisibilityField } from './fields';

export type WinePrefill = {
  wine?: Partial<Wine>;
  uncertain?: string[];
  /** Conseils proposés par la lecture d'étiquette : enregistrés comme « estimation de l'IA ». */
  aiAdvice?: boolean;
  volume_ml?: number | null;
  aiNotes?: string | null;
  /** Photo déjà rangée (lecture d'étiquette). */
  uploaded?: string[];
};

type Form = {
  name: string;
  domaine: string;
  producer: string;
  cuvee: string;
  country: string;
  region: string;
  appellation: string;
  color: Color | null;
  wine_type: WineType | '';
  grapes: string;
  vintage: string;
  non_vintage: boolean;
  label_photo: string | null;
  bottle_photo: string | null;
  drink_from: string;
  drink_until: string;
  serve_temp_min: string;
  serve_temp_max: string;
  aeration: string;
  pairings: string;
  notes: string;
  window_note: string;
};

function initialForm(w: Partial<Wine> | undefined): Form {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    name: s(w?.name),
    domaine: s(w?.domaine),
    producer: s(w?.producer),
    cuvee: s(w?.cuvee),
    country: s(w?.country),
    region: s(w?.region),
    appellation: s(w?.appellation),
    color: (w?.color as Color) ?? null,
    wine_type: (w?.wine_type as WineType) ?? '',
    grapes: (w?.grapes ?? []).join(', '),
    vintage: s(w?.vintage),
    non_vintage: Boolean(w?.non_vintage),
    label_photo: w?.label_photo ?? null,
    bottle_photo: w?.bottle_photo ?? null,
    drink_from: s(w?.drink_from),
    drink_until: s(w?.drink_until),
    serve_temp_min: s(w?.serve_temp_min),
    serve_temp_max: s(w?.serve_temp_max),
    aeration: s(w?.aeration),
    pairings: s(w?.pairings),
    notes: s(w?.notes),
    window_note: s(w?.window_note),
  };
}

const nul = (s: string) => (s.trim() ? s.trim() : null);

export function WineFormSheet({ wine, prefill, onClose }: { wine?: Wine; prefill?: WinePrefill; onClose: () => void }) {
  const { snapshot, api, run, me, lotsOf } = useStore();
  const confirm = useConfirm();
  const editing = Boolean(wine);
  const [f, setF] = useState<Form>(() => initialForm(wine ?? prefill?.wine));
  const uncertain = new Set(prefill?.uncertain ?? []);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const fromAi = Boolean(prefill?.aiAdvice);
  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setTouched((t) => new Set([...t, ...Object.keys(patch)]));
  };
  const isUncertain = (k: string) => uncertain.has(k) && !touched.has(k);

  // Lot (création seulement)
  const [quantity, setQuantity] = useState(1);
  const [volume, setVolume] = useState(prefill?.volume_ml ?? 750);
  const [cellarId, setCellarId] = useState(snapshot.cellars[0]?.id ?? '');
  const [locationId, setLocationId] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [price, setPrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [place, setPlace] = useState('');
  const [origin, setOrigin] = useState<'achat' | 'cadeau_recu' | 'entree'>('achat');
  const [visibility, setVisibility] = useState<Visibility>(me.preferences.default_visibility ?? 'private');
  const [hidePrice, setHidePrice] = useState(true);
  const [hideQuantity, setHideQuantity] = useState(false);
  const [hideNotes, setHideNotes] = useState(true);
  const [lotNotes, setLotNotes] = useState('');
  const [forceNew, setForceNew] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wineId = useRef(newId());
  const requestId = useRef(newId());
  const uploaded = useRef<string[]>([...(prefill?.uploaded ?? [])]);
  const saved = useRef(false);

  const vintageNum = parseNumber(f.vintage);
  const existing = useMemo(() => {
    if (editing || !f.name.trim()) return undefined;
    return snapshot.wines.find(
      (w) => fold(w.name) === fold(f.name) && (w.vintage ?? null) === (f.non_vintage ? null : vintageNum) && Boolean(w.non_vintage) === f.non_vintage,
    );
  }, [editing, f.name, f.non_vintage, vintageNum, snapshot.wines]);
  const reuse = existing && !forceNew;
  const locations = snapshot.locations.filter((l) => l.cellar_id === cellarId);

  async function close() {
    if (!saved.current && uploaded.current.length) {
      const keep = new Set([wine?.label_photo, wine?.bottle_photo]);
      void api.removePhotos(uploaded.current.filter((p) => !keep.has(p))).catch(() => undefined);
    }
    onClose();
  }

  function validate(): string | null {
    if (!f.name.trim()) return 'Indiquez le nom du vin.';
    const y = currentYear();
    if (f.vintage && !f.non_vintage && (!vintageNum || vintageNum < 1800 || vintageNum > y + 1)) return `Le millésime doit être une année entre 1800 et ${y + 1}.`;
    const from = parseNumber(f.drink_from);
    const until = parseNumber(f.drink_until);
    if (from && until && from > until) return 'La période de consommation doit commencer avant de finir.';
    const tmin = parseNumber(f.serve_temp_min);
    const tmax = parseNumber(f.serve_temp_max);
    if ((tmin !== null && (tmin < 0 || tmin > 25)) || (tmax !== null && (tmax < 0 || tmax > 25))) return 'La température de service doit être comprise entre 0 et 25 °C.';
    if (tmin !== null && tmax !== null && tmin > tmax) return 'Température : le minimum doit être inférieur au maximum.';
    if (!editing && quantity < 1) return 'Indiquez au moins une bouteille.';
    if (!editing && price && parseNumber(price) === null) return 'Le prix doit être un nombre.';
    return null;
  }

  function winePayload(): Partial<Wine> {
    const from = parseNumber(f.drink_from);
    const until = parseNumber(f.drink_until);
    const tmin = parseNumber(f.serve_temp_min);
    const tmax = parseNumber(f.serve_temp_max);
    // Origine des conseils : estimation de l'IA s'ils viennent de la lecture d'étiquette et n'ont pas été retouchés.
    const src = (keys: string[], previous: AdviceSource | null | undefined): AdviceSource | null => {
      if (editing && !keys.some((k) => touched.has(k))) return previous ?? null;
      return fromAi && !keys.some((k) => touched.has(k)) ? 'ai' : 'personal';
    };
    return {
      name: f.name.trim(),
      domaine: nul(f.domaine),
      producer: nul(f.producer),
      cuvee: nul(f.cuvee),
      country: nul(f.country),
      region: nul(f.region),
      appellation: nul(f.appellation),
      color: f.color,
      wine_type: (f.wine_type || null) as WineType | null,
      grapes: f.grapes
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 12),
      vintage: f.non_vintage ? null : vintageNum,
      non_vintage: f.non_vintage,
      label_photo: f.label_photo,
      bottle_photo: f.bottle_photo,
      drink_from: from,
      drink_until: until,
      window_source: from || until ? src(['drink_from', 'drink_until'], wine?.window_source) : null,
      window_note: nul(f.window_note),
      serve_temp_min: tmin,
      serve_temp_max: tmax,
      temp_source: tmin !== null || tmax !== null ? src(['serve_temp_min', 'serve_temp_max'], wine?.temp_source) : null,
      aeration: nul(f.aeration),
      aeration_source: f.aeration.trim() ? src(['aeration'], wine?.aeration_source) : null,
      pairings: nul(f.pairings),
      pairings_source: f.pairings.trim() ? src(['pairings'], wine?.pairings_source) : null,
      notes: nul(f.notes),
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    if (editing) {
      const res = await run(() => api.updateWine(wine!.id, winePayload()), { success: 'Fiche enregistrée' });
      setBusy(false);
      if (res.ok) {
        saved.current = true;
        const removed = [wine!.label_photo, wine!.bottle_photo].filter((p) => p && p !== f.label_photo && p !== f.bottle_photo) as string[];
        void api.removePhotos(removed).catch(() => undefined);
        onClose();
      }
      return;
    }
    const res = await run(
      async () => {
        let target = existing?.id;
        if (!reuse) {
          target = wineId.current;
          await api.saveNewWine({ id: target, ...winePayload() } as Wine);
        } else if (f.label_photo && !existing!.label_photo) {
          await api.updateWine(existing!.id, { label_photo: f.label_photo });
        }
        let loc: string | null = locationId || null;
        if (locationId === '__new' && newLocation.trim()) {
          const created = await api.addLocation({ cellar_id: cellarId, name: newLocation.trim(), kind: 'autre' });
          loc = created.id;
        } else if (locationId === '__new') loc = null;
        await api.createLot(
          {
            wine_id: target,
            cellar_id: cellarId || null,
            location_id: loc,
            volume_ml: volume,
            quantity,
            origin,
            purchase_price: parseNumber(price),
            currency: me.currency,
            purchase_date: purchaseDate || null,
            purchase_place: nul(place),
            visibility,
            hide_price: hidePrice,
            hide_quantity: hideQuantity,
            hide_notes: hideNotes,
            notes: nul(lotNotes),
          },
          requestId.current,
        );
        return target!;
      },
      { success: reuse ? 'Bouteilles ajoutées à la fiche existante' : 'Vin ajouté à votre cave' },
    );
    setBusy(false);
    if (res.ok) {
      saved.current = true;
      onClose();
      go(`/cave/vin/${res.value}`);
    }
  }

  const title = editing ? 'Modifier la fiche' : prefill?.wine ? 'Vérifier et ajouter' : 'Ajouter un vin';

  return (
    <Sheet
      open
      onClose={() => void close()}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()}>
            Annuler
          </Button>
          <Button type="submit" form="wine-form" loading={busy}>
            {editing ? 'Enregistrer' : 'Ajouter à ma cave'}
          </Button>
        </>
      }
    >
      <form id="wine-form" className="form" onSubmit={submit}>
        {prefill?.wine && !editing && (
          <Notice tone="gold">
            Informations proposées par l’assistant d’après la photo : vérifiez-les et corrigez si besoin. Les champs surlignés sont incertains ; ceux qui
            n’étaient pas lisibles sont restés vides.
            {prefill.aiNotes ? <span className="small" style={{ display: 'block', marginTop: 4 }}>Remarque : {prefill.aiNotes}</span> : null}
          </Notice>
        )}
        <Field label="Nom du vin" htmlFor="w-name" hint="Château, domaine ou nom de la cuvée, tel qu’il figure sur l’étiquette.">
          <Uncertain show={isUncertain('name')}>
            <input id="w-name" className={`input ${isUncertain('name') ? 'uncertain' : ''}`} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required data-autofocus={!prefill?.wine || undefined} />
          </Uncertain>
        </Field>
        <div className="field-row">
          <Field label="Millésime" htmlFor="w-vintage">
            <Uncertain show={isUncertain('vintage')}>
              <input
                id="w-vintage"
                className={`input ${isUncertain('vintage') ? 'uncertain' : ''}`}
                inputMode="numeric"
                placeholder="2018"
                value={f.non_vintage ? '' : f.vintage}
                disabled={f.non_vintage}
                onChange={(e) => set({ vintage: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              />
            </Uncertain>
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <Check checked={f.non_vintage} onChange={(v) => set({ non_vintage: v, vintage: v ? '' : f.vintage })} label="Sans millésime" />
          </div>
        </div>
        <Field label="Couleur">
          <ColorChips value={f.color} onChange={(color) => set({ color })} />
          {isUncertain('color') && <span className="small" style={{ color: 'var(--gold-ink)', fontWeight: 700 }}>À vérifier</span>}
        </Field>

        {existing && !editing && (
          <Notice tone="info">
            « {wineTitle(existing)} » est déjà dans votre cave ({lotsOf(existing.id).reduce((s, l) => s + l.quantity, 0)} bouteille(s)).{' '}
            {reuse ? 'Ces bouteilles seront ajoutées comme un nouveau lot de cette fiche.' : 'Une nouvelle fiche distincte sera créée.'}
            <Check checked={forceNew} onChange={setForceNew} label="Créer une fiche séparée" />
          </Notice>
        )}

        {!editing && (
          <>
            <div className="field-row">
              <Field label="Bouteilles">
                <Stepper value={quantity} onChange={setQuantity} min={1} label="Nombre de bouteilles" />
              </Field>
              <Field label="Contenance" htmlFor="w-vol">
                <select id="w-vol" className="input" value={volume} onChange={(e) => setVolume(Number(e.target.value))}>
                  {VOLUMES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Prix d’achat par bouteille (facultatif)" htmlFor="w-price" hint="Visible par vous seul, sauf si vous décidez de le montrer.">
              <input id="w-price" className="input" inputMode="decimal" placeholder="Ex. 18,50" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Rangement">
              <div className="grid-2-always">
                {snapshot.cellars.length > 1 ? (
                  <select className="input" aria-label="Cave" value={cellarId} onChange={(e) => (setCellarId(e.target.value), setLocationId(''))}>
                    {snapshot.cellars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>
                    {snapshot.cellars[0]?.name}
                  </span>
                )}
                <select className="input" aria-label="Emplacement" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Sans emplacement</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value="__new">+ Nouvel emplacement…</option>
                </select>
              </div>
              {locationId === '__new' && (
                <input className="input" placeholder={`Ex. ${LOCATION_KINDS[0].label} B, étagère du bas…`} aria-label="Nom du nouvel emplacement" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} />
              )}
            </Field>
            <Field label="Qui peut voir ces bouteilles ?">
              <VisibilityField value={visibility} onChange={setVisibility} />
            </Field>
          </>
        )}

        <PhotoField
          label="Photo de l’étiquette"
          path={f.label_photo}
          onChange={(p) => set({ label_photo: p })}
          onUploaded={(p) => uploaded.current.push(p)}
        />

        <Advanced title="Plus de détails (facultatif)" open={editing || Boolean(prefill?.wine) || Boolean(me.preferences.advanced)}>
          <div className="field-row">
            <Field label="Domaine" htmlFor="w-dom">
              <Uncertain show={isUncertain('domaine')}>
                <input id="w-dom" className={`input ${isUncertain('domaine') ? 'uncertain' : ''}`} value={f.domaine} onChange={(e) => set({ domaine: e.target.value })} />
              </Uncertain>
            </Field>
            <Field label="Producteur" htmlFor="w-prod">
              <Uncertain show={isUncertain('producer')}>
                <input id="w-prod" className={`input ${isUncertain('producer') ? 'uncertain' : ''}`} value={f.producer} onChange={(e) => set({ producer: e.target.value })} />
              </Uncertain>
            </Field>
          </div>
          <Field label="Cuvée" htmlFor="w-cuvee">
            <Uncertain show={isUncertain('cuvee')}>
              <input id="w-cuvee" className={`input ${isUncertain('cuvee') ? 'uncertain' : ''}`} value={f.cuvee} onChange={(e) => set({ cuvee: e.target.value })} />
            </Uncertain>
          </Field>
          <div className="field-row">
            <Field label="Pays" htmlFor="w-country">
              <Uncertain show={isUncertain('country')}>
                <input id="w-country" className={`input ${isUncertain('country') ? 'uncertain' : ''}`} value={f.country} onChange={(e) => set({ country: e.target.value })} />
              </Uncertain>
            </Field>
            <Field label="Région" htmlFor="w-region">
              <Uncertain show={isUncertain('region')}>
                <input id="w-region" className={`input ${isUncertain('region') ? 'uncertain' : ''}`} value={f.region} onChange={(e) => set({ region: e.target.value })} />
              </Uncertain>
            </Field>
          </div>
          <Field label="Appellation" htmlFor="w-app">
            <Uncertain show={isUncertain('appellation')}>
              <input id="w-app" className={`input ${isUncertain('appellation') ? 'uncertain' : ''}`} value={f.appellation} onChange={(e) => set({ appellation: e.target.value })} />
            </Uncertain>
          </Field>
          <div className="field-row">
            <Field label="Type de vin" htmlFor="w-type">
              <select id="w-type" className={`input ${isUncertain('wine_type') ? 'uncertain' : ''}`} value={f.wine_type} onChange={(e) => set({ wine_type: e.target.value as WineType })}>
                <option value="">Non précisé</option>
                {WINE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cépages" htmlFor="w-grapes" hint="Séparés par des virgules">
              <input id="w-grapes" className={`input ${isUncertain('grapes') ? 'uncertain' : ''}`} value={f.grapes} onChange={(e) => set({ grapes: e.target.value })} />
            </Field>
          </div>
          <PhotoField label="Photo de la bouteille" path={f.bottle_photo} onChange={(p) => set({ bottle_photo: p })} onUploaded={(p) => uploaded.current.push(p)} />
          {!editing && (
            <>
              <Field label="Origine de ces bouteilles">
                <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>
                  <option value="achat">Achat</option>
                  <option value="cadeau_recu">Cadeau reçu</option>
                  <option value="entree">Déjà dans ma cave (inventaire)</option>
                </select>
              </Field>
              <div className="field-row">
                <Field label="Date d’achat" htmlFor="w-date">
                  <input id="w-date" className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                </Field>
                <Field label="Lieu d’achat" htmlFor="w-place">
                  <input id="w-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Caviste, salon…" />
                </Field>
              </div>
              {visibility !== 'private' && (
                <div className="card soft">
                  <p className="strong small">Ce que vos amis ne verront pas :</p>
                  <Check checked={hidePrice} onChange={setHidePrice} label="Masquer mon prix d’achat" />
                  <Check checked={hideQuantity} onChange={setHideQuantity} label="Masquer la quantité exacte" hint="Ils verront seulement si la bouteille est en stock." />
                  <Check checked={hideNotes} onChange={setHideNotes} label="Masquer mes notes personnelles" />
                </div>
              )}
              <Field label="Note sur ce lot" htmlFor="w-lotnotes">
                <input id="w-lotnotes" className="input" value={lotNotes} onChange={(e) => setLotNotes(e.target.value)} placeholder="Cadeau de Paul, caisse bois…" />
              </Field>
            </>
          )}
          <p className="strong" style={{ marginTop: 6 }}>
            Conseils {fromAi && <Origin kind="ai" />}
          </p>
          <div className="field-row">
            <Field label="À boire à partir de" htmlFor="w-from">
              <input id="w-from" className="input" inputMode="numeric" placeholder="2025" value={f.drink_from} onChange={(e) => set({ drink_from: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
            <Field label="jusqu’en" htmlFor="w-until">
              <input id="w-until" className="input" inputMode="numeric" placeholder="2032" value={f.drink_until} onChange={(e) => set({ drink_until: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
          </div>
          <Field label="Source de cette période (facultatif)" htmlFor="w-wnote" hint="Ex. contre-étiquette, conseil du caviste, guide…">
            <input id="w-wnote" className="input" value={f.window_note} onChange={(e) => set({ window_note: e.target.value })} maxLength={200} />
          </Field>
          <div className="field-row">
            <Field label="Servir entre (°C)" htmlFor="w-tmin">
              <input id="w-tmin" className="input" inputMode="numeric" value={f.serve_temp_min} onChange={(e) => set({ serve_temp_min: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Field>
            <Field label="et (°C)" htmlFor="w-tmax">
              <input id="w-tmax" className="input" inputMode="numeric" value={f.serve_temp_max} onChange={(e) => set({ serve_temp_max: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Field>
          </div>
          <Field label="Aération, carafage" htmlFor="w-aer">
            <input id="w-aer" className="input" value={f.aeration} onChange={(e) => set({ aeration: e.target.value })} maxLength={300} />
          </Field>
          <Field label="Accords mets et vins" htmlFor="w-pair">
            <textarea id="w-pair" className="input" value={f.pairings} onChange={(e) => set({ pairings: e.target.value })} maxLength={500} />
          </Field>
          <Field label="Notes personnelles" htmlFor="w-notes">
            <textarea id="w-notes" className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} />
          </Field>
          {editing && (
            <Button
              variant="danger-ghost"
              onClick={async () => {
                const stock = lotsOf(wine!.id).reduce((s, l) => s + l.quantity, 0);
                const ok = await confirm({
                  title: 'Supprimer cette fiche ?',
                  message: `La fiche, ses lots (${stock} bouteille(s)) et leur historique seront supprimés. Vos dégustations et les souvenirs d’événements sont conservés.`,
                  confirmLabel: 'Supprimer',
                  danger: true,
                });
                if (!ok) return;
                const res = await run(() => api.deleteWine(wine!.id), { success: 'Fiche supprimée' });
                if (res.ok) {
                  saved.current = true;
                  void api.removePhotos([wine!.label_photo, wine!.bottle_photo].filter(Boolean) as string[]).catch(() => undefined);
                  onClose();
                  go('/cave', { replace: true });
                }
              }}
            >
              Supprimer cette fiche
            </Button>
          )}
        </Advanced>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
