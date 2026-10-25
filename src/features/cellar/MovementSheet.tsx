/** Entrée ou sortie de bouteilles, et correction d'inventaire. Clé d'idempotence : un double clic ne compte qu'une fois. */
import { useRef, useState, type FormEvent } from 'react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { lotSplit } from '../../domain/cellar';
import { todayIso } from '../../domain/format';
import type { Lot, MovementKind, Wine } from '../../domain/types';
import { volumeLabel, wineTitle } from '../../domain/wine';
import { Button, Field, Notice, Segmented, Sheet } from '../../ui/kit';
import { Stepper } from './fields';

type Mode = 'out' | 'in' | 'fix';

/**
 * « initialGroup » : bouteille prise sur ce que j'ai mis à disposition de ce groupe (ouverture lors d'une soirée…).
 */
export function MovementSheet({
  wine,
  lots,
  initialLot,
  initialGroup,
  mode: initialMode = 'out',
  onClose,
}: {
  wine: Wine;
  lots: Lot[];
  initialLot?: Lot;
  initialGroup?: string;
  mode?: Mode;
  onClose: () => void;
}) {
  const { api, run, location, snapshot } = useStore();
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
  const split = lot ? lotSplit(lot, snapshot.groupShares) : null;
  // Origine d'une bouteille bue : les bouteilles libres (''), ou ce que j'ai mis à disposition d'un groupe
  // (proposé d'emblée quand il ne reste aucune bouteille libre dans le lot).
  const defaultSource = (l?: Lot) => (l && l.quantity - l.reserved < 1 ? (lotSplit(l, snapshot.groupShares).groups[0]?.group_id ?? '') : '');
  const [source, setSource] = useState(() => initialGroup ?? defaultSource(lot));
  const fromGroup = mode === 'out' && kind === 'consommation' ? split?.groups.find((g) => g.group_id === source) : undefined;
  const groupName = (id: string) => snapshot.groups.find((g) => g.id === id)?.name ?? 'un groupe';
  const available = fromGroup ? fromGroup.allocated : lot ? lot.quantity - lot.reserved : 0;

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
          : fromGroup
            ? api.consumeFromGroup(lot.id, fromGroup.group_id, quantity, date, note.trim() || null, requestId.current)
            : api.recordMovement(lot.id, kind, quantity, date, note.trim() || null, requestId.current),
      {
        success:
          mode === 'fix'
            ? 'Quantité corrigée'
            : kind === 'consommation'
              ? `Sortie enregistrée : ${quantity} bouteille${quantity > 1 ? 's' : ''}${fromGroup ? ` de « ${groupName(fromGroup.group_id)} »` : ''}`
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
            <select
              className="input"
              value={lotId}
              onChange={(e) => {
                const next = lots.find((l) => l.id === e.target.value);
                setLotId(e.target.value);
                setTarget(next?.quantity ?? 0);
                setSource(defaultSource(next));
              }}
            >
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
            {mode === 'out' && kind === 'consommation' && split && split.groups.length > 0 && (
              <Field label="Bouteille prise sur" hint="Une bouteille mise à disposition d’un groupe est retirée du groupe et de votre stock en même temps.">
                <select
                  className="input"
                  value={fromGroup ? source : ''}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setQuantity(1);
                  }}
                >
                  <option value="">{`Mes bouteilles libres (${split.free})`}</option>
                  {split.groups.map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      {`Mises à disposition de « ${groupName(g.group_id)} » (${g.allocated})`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="field-row">
              <Field label="Bouteilles">
                <Stepper value={quantity} onChange={setQuantity} min={1} max={mode === 'out' ? Math.max(available, 1) : 999} label="Nombre de bouteilles" />
              </Field>
              <Field label="Date" htmlFor="mv-date">
                <input id="mv-date" className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {mode === 'out' && !fromGroup && split && lot && lot.reserved > 0 && (
              <Notice tone="warn">
                {[
                  split.forEvents ? `${split.forEvents} bouteille${split.forEvents > 1 ? 's sont réservées' : ' est réservée'} pour un événement` : null,
                  split.forGroups ? `${split.forGroups} bouteille${split.forGroups > 1 ? 's sont mises' : ' est mise'} à disposition d’un groupe` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}{' '}
                : seules {available} peuvent sortir ici.
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
            {lot.reserved > 0 && <p className="small faint">Au moins {lot.reserved} : des bouteilles sont réservées pour un événement ou mises à disposition d’un groupe.</p>}
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
