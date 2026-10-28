/**
 * Nouveau lot d'un vin existant, ou modification d'un lot (rangement, prix, partage et masques). Dans une cave gérée à
 * plusieurs, la personne associée range et complète l'achat ; le partage et les masques restent au propriétaire.
 */
import { useRef, useState, type FormEvent } from 'react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { parseNumber, todayIso } from '../../domain/format';
import { fold, VOLUMES } from '../../domain/wine';
import type { Lot, Visibility, Wine } from '../../domain/types';
import { Advanced, Button, Check, Field, Notice, Sheet, useConfirm } from '../../ui/kit';
import { Stepper, VisibilityField } from './fields';
import { DocumentPhotoButton } from './WineAssist';

export function LotSheet({ wine, lot, onClose }: { wine: Wine; lot?: Lot; onClose: () => void }) {
  const { snapshot, api, run, me, userId, cellarLabel, profileName } = useStore();
  const confirm = useConfirm();
  const editing = Boolean(lot);
  const isOwner = wine.owner_id === userId;
  // Un lot reste dans une cave du propriétaire du vin.
  const cellars = snapshot.cellars.filter((c) => c.owner_id === wine.owner_id);
  const [quantity, setQuantity] = useState(1);
  const [volume, setVolume] = useState(lot?.volume_ml ?? 750);
  const [cellarId, setCellarId] = useState(lot?.cellar_id ?? cellars[0]?.id ?? '');
  const [locationId, setLocationId] = useState(lot?.location_id ?? '');
  const [newLocation, setNewLocation] = useState('');
  const [price, setPrice] = useState(lot?.purchase_price !== null && lot?.purchase_price !== undefined ? String(lot.purchase_price).replace('.', ',') : '');
  const [date, setDate] = useState(lot?.purchase_date ?? (editing ? '' : todayIso()));
  const [docWarning, setDocWarning] = useState<string | null>(null);
  const [place, setPlace] = useState(lot?.purchase_place ?? '');
  const [origin, setOrigin] = useState<'achat' | 'cadeau_recu' | 'entree'>('achat');
  const [visibility, setVisibility] = useState<Visibility>(lot?.visibility ?? me.preferences.default_visibility ?? 'private');
  const [hidePrice, setHidePrice] = useState(lot?.hide_price ?? true);
  const [hideQuantity, setHideQuantity] = useState(lot?.hide_quantity ?? false);
  const [hideNotes, setHideNotes] = useState(lot?.hide_notes ?? true);
  const [notes, setNotes] = useState(lot?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newId());
  const locations = snapshot.locations.filter((l) => l.cellar_id === cellarId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (price && parseNumber(price) === null) return setError('Le prix doit être un nombre.');
    setError(null);
    setBusy(true);
    const res = await run(
      async () => {
        let loc: string | null = locationId || null;
        if (locationId === '__new') loc = newLocation.trim() ? (await api.addLocation({ cellar_id: cellarId, name: newLocation.trim(), kind: 'autre' })).id : null;
        const common = {
          cellar_id: cellarId,
          location_id: loc,
          volume_ml: volume,
          purchase_price: parseNumber(price),
          purchase_date: date || null,
          purchase_place: place.trim() || null,
          notes: notes.trim() || null,
          ...(isOwner ? { visibility, hide_price: hidePrice, hide_quantity: hideQuantity, hide_notes: hideNotes } : {}),
        };
        if (editing) await api.updateLot(lot!.id, common);
        else await api.createLot({ ...common, wine_id: wine.id, quantity, origin, currency: me.currency }, requestId.current);
      },
      { success: editing ? 'Lot enregistré' : 'Bouteilles ajoutées' },
    );
    setBusy(false);
    if (res.ok) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Modifier ce lot' : 'Ajouter des bouteilles'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="lot-form" loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="lot-form" className="form" onSubmit={submit}>
        {!editing && (
          <div className="field-row">
            <Field label="Bouteilles">
              <Stepper value={quantity} onChange={setQuantity} min={1} label="Nombre de bouteilles" />
            </Field>
            <Field label="Origine">
              <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>
                <option value="achat">Achat</option>
                <option value="cadeau_recu">Cadeau reçu</option>
                <option value="entree">Déjà en cave</option>
              </select>
            </Field>
          </div>
        )}
        {(editing || origin === 'achat') && (
          <DocumentPhotoButton
            kind="receipt"
            hint="Lia lit le prix, puis la date et le magasin (dans « Achat et notes »). La photo entière est lue par Claude puis effacée : cachez votre nom ou votre numéro de carte si vous le pouvez."
            onResult={(r) => {
              // Plusieurs vins sur le ticket : celui dont le nom ressemble le plus à ce vin, sinon le premier.
              const line = r.lines.find((l) => fold(l.wine_name).includes(fold(wine.name)) || fold(wine.name).includes(fold(l.wine_name))) ?? r.lines[0];
              if (line.unit_price != null) setPrice(String(line.unit_price).replace('.', ','));
              if (line.volume_ml && VOLUMES.some((v) => v.value === line.volume_ml)) setVolume(line.volume_ml);
              if (!editing && line.quantity) setQuantity(line.quantity);
              if (r.purchase_date) setDate(r.purchase_date);
              if (r.seller) setPlace(r.seller);
              setDocWarning(r.currency && r.currency !== me.currency ? `Ticket en ${r.currency}, mais vos prix sont en ${me.currency} : vérifiez le prix.` : null);
            }}
          />
        )}
        {docWarning && <Notice tone="warn">{docWarning}</Notice>}
        <div className="field-row">
          <Field label="Contenance">
            <select className="input" value={volume} onChange={(e) => setVolume(Number(e.target.value))}>
              {VOLUMES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prix d’achat / bouteille" htmlFor="l-price">
            <input id="l-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Rangement">
          <div className="grid-2-always">
            <select className="input" aria-label="Cave" value={cellarId} onChange={(e) => (setCellarId(e.target.value), setLocationId(''))}>
              {cellars.map((c) => (
                <option key={c.id} value={c.id}>
                  {cellarLabel(c)}
                </option>
              ))}
            </select>
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
          {locationId === '__new' && <input className="input" aria-label="Nom du nouvel emplacement" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Casier B…" />}
        </Field>
        {isOwner ? (
          <Field label="Qui peut voir ce lot ?">
            <VisibilityField value={visibility} onChange={setVisibility} />
          </Field>
        ) : (
          <p className="small muted">Le partage de ce lot avec les amis reste choisi par {profileName(wine.owner_id)}.</p>
        )}
        {isOwner && visibility !== 'private' && (
          <div className="card soft">
            <p className="strong small">Ce que vos amis ne verront pas :</p>
            <Check checked={hidePrice} onChange={setHidePrice} label="Masquer mon prix d’achat" />
            <Check checked={hideQuantity} onChange={setHideQuantity} label="Masquer la quantité exacte" hint="Ils verront seulement si la bouteille est en stock." />
            <Check checked={hideNotes} onChange={setHideNotes} label="Masquer mes notes personnelles" />
            <p className="small faint">Une bouteille visible n’est pas pour autant disponible : vous confirmez toujours celles que vous apportez.</p>
          </div>
        )}
        <Advanced title="Achat et notes" open={Boolean(me.preferences.advanced) || (editing && Boolean(lot?.purchase_place || lot?.notes))}>
          <div className="field-row">
            <Field label="Date d’achat" htmlFor="l-date">
              <input id="l-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Lieu d’achat" htmlFor="l-place">
              <input id="l-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} />
            </Field>
          </div>
          <Field label="Note sur ce lot" htmlFor="l-notes">
            <input id="l-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Advanced>
        {editing && isOwner && lot!.quantity === 0 && (
          <Button
            variant="danger-ghost"
            onClick={async () => {
              if (!(await confirm({ title: 'Supprimer ce lot vide ?', message: 'Son historique sera supprimé avec lui.', confirmLabel: 'Supprimer', danger: true }))) return;
              const res = await run(() => api.deleteLot(lot!.id), { success: 'Lot supprimé' });
              if (res.ok) onClose();
            }}
          >
            Supprimer ce lot vide
          </Button>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
