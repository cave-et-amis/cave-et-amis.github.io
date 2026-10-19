/** Entrée ou sortie de bouteilles, et correction d'inventaire. Clé d'idempotence : un double clic ne compte qu'une fois. */
import { useRef, useState, type FormEvent } from 'react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { todayIso } from '../../domain/format';
import type { Lot, MovementKind, Wine } from '../../domain/types';
import { volumeLabel, wineTitle } from '../../domain/wine';
import { Button, Field, Notice, Segmented, Sheet } from '../../ui/kit';
import { Stepper } from './fields';

type Mode = 'out' | 'in' | 'fix';

export function MovementSheet({ wine, lots, initialLot, mode: initialMode = 'out', onClose }: { wine: Wine; lots: Lot[]; initialLot?: Lot; mode?: Mode; onClose: () => void }) {
  const { api, run, location } = useStore();
  const choices = lots.filter((l) => initialMode !== 'out' || l.quantity > 0);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [lotId, setLotId] = useState(initialLot?.id ?? choices.find((l) => l.quantity - l.reserved > 0)?.id ?? choices[0]?.id ?? '');
  const lot = lots.find((l) => l.id === lotId);
  const [kind, setKind] = useState<MovementKind>(initialMode === 'in' ? 'achat' : 'consommation');
  const [quantity, setQuantity] = useState(1);
  const [target, setTarget] = useState(lot?.quantity ?? 0);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newId());
  const available = lot ? lot.quantity - lot.reserved : 0;

  const lotLabel = (l: Lot) =>
    [location(l.location_id)?.name ?? 'Sans emplacement', volumeLabel(l.volume_ml), `${l.quantity} en stock${l.reserved ? `, ${l.reserved} réservée(s)` : ''}`].join(' · ');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!lot) return;
    setBusy(true);
    const res = await run(
      () =>
        mode === 'fix'
          ? api.setLotQuantity(lot.id, target, note.trim() || 'Correction d’inventaire', requestId.current)
          : api.recordMovement(lot.id, kind, quantity, date, note.trim() || null, requestId.current),
      {
        success:
          mode === 'fix'
            ? 'Quantité corrigée'
            : kind === 'consommation'
              ? `Sortie enregistrée : ${quantity} bouteille${quantity > 1 ? 's' : ''}`
              : 'Mouvement enregistré',
      },
    );
    setBusy(false);
    if (res.ok) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'fix' ? 'Corriger la quantité' : mode === 'in' ? 'Entrée en cave' : 'Sortie de cave'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="mv-form" loading={busy} disabled={!lot || (mode === 'out' && available < 1) || (mode === 'fix' && target === lot?.quantity)}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="mv-form" className="form" onSubmit={submit}>
        <p className="muted">{wineTitle(wine)}</p>
        <Segmented<Mode>
          label="Type de mouvement"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setKind(m === 'in' ? 'achat' : 'consommation');
          }}
          options={[
            { value: 'out', label: 'Sortie' },
            { value: 'in', label: 'Entrée' },
            { value: 'fix', label: 'Correction' },
          ]}
        />
        {lots.length > 1 && (
          <Field label="Lot concerné">
            <select className="input" value={lotId} onChange={(e) => (setLotId(e.target.value), setTarget(lots.find((l) => l.id === e.target.value)?.quantity ?? 0))}>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {lotLabel(l)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {mode !== 'fix' && (
          <>
            <Field label="Motif">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as MovementKind)}>
                {mode === 'out' ? (
                  <>
                    <option value="consommation">Bouteille bue</option>
                    <option value="cadeau_offert">Cadeau offert</option>
                  </>
                ) : (
                  <>
                    <option value="achat">Achat</option>
                    <option value="cadeau_recu">Cadeau reçu</option>
                    <option value="entree">Retrouvée / oubliée dans l’inventaire</option>
                  </>
                )}
              </select>
            </Field>
            <div className="field-row">
              <Field label="Bouteilles">
                <Stepper value={quantity} onChange={setQuantity} min={1} max={mode === 'out' ? Math.max(available, 1) : 999} label="Nombre de bouteilles" />
              </Field>
              <Field label="Date" htmlFor="mv-date">
                <input id="mv-date" className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {mode === 'out' && lot && lot.reserved > 0 && (
              <Notice tone="warn">
                {lot.reserved} bouteille{lot.reserved > 1 ? 's de ce lot sont réservées' : ' de ce lot est réservée'} pour un événement : seules {available} peuvent sortir ici.
              </Notice>
            )}
            {mode === 'out' && available < 1 && <Notice tone="warn">Plus aucune bouteille disponible dans ce lot.</Notice>}
          </>
        )}
        {mode === 'fix' && lot && (
          <>
            <p className="muted">
              Stock enregistré : <strong>{lot.quantity}</strong>. Indiquez le nombre réel de bouteilles ; l’écart sera noté dans l’historique.
            </p>
            <Field label="Quantité réelle">
              <Stepper value={target} onChange={setTarget} min={lot.reserved} label="Quantité réelle" />
            </Field>
            {lot.reserved > 0 && <p className="small faint">Au moins {lot.reserved} : des bouteilles sont réservées pour un événement.</p>}
          </>
        )}
        <Field label="Note (facultatif)" htmlFor="mv-note">
          <input id="mv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={mode === 'out' ? 'Avec qui, pour quelle occasion…' : ''} />
        </Field>
        {mode === 'out' && kind === 'consommation' && <p className="small faint">Pour garder un souvenir de la bouteille, notez-la ensuite dans votre carnet.</p>}
      </form>
    </Sheet>
  );
}
