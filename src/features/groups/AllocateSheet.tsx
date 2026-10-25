/**
 * Mettre des bouteilles d'un lot à disposition d'un groupe, ou les reprendre. Elles restent à leur propriétaire mais
 * sont réservées : plus libres pour lui, ni pour un autre groupe, ni pour un événement (la base y veille).
 */
import { useState, type FormEvent } from 'react';
import { useStore } from '../../data/store';
import { lotSplit, splitText } from '../../domain/cellar';
import { bottles } from '../../domain/format';
import type { Lot } from '../../domain/types';
import { volumeLabel, wineTitle } from '../../domain/wine';
import { Button, EmptyState, Field, Notice, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';
import { Stepper } from '../cellar/fields';

export function AllocateSheet({ lotIds, initialLot, groupId, onClose }: { lotIds?: string[]; initialLot?: string; groupId?: string; onClose: () => void }) {
  const { snapshot, api, run, wine, location } = useStore();
  const groups = snapshot.groups.filter((g) => g.my_status === 'active' && (!groupId || g.id === groupId));
  const lots = snapshot.lots.filter((l) => l.quantity > 0 && (!lotIds || lotIds.includes(l.id)));
  const allocated = (lot: string, group: string) => snapshot.groupShares.find((s) => s.lot_id === lot && s.group_id === group)?.allocated ?? 0;
  const [lotId, setLotId] = useState(initialLot && lots.some((l) => l.id === initialLot) ? initialLot : (lots[0]?.id ?? ''));
  const [gid, setGid] = useState(groupId ?? groups[0]?.id ?? '');
  const [value, setValue] = useState(() => allocated(lotId, gid));
  const [busy, setBusy] = useState(false);
  const lot = lots.find((l) => l.id === lotId);
  const group = groups.find((g) => g.id === gid);
  const current = allocated(lotId, gid);
  const severalWines = new Set(lots.map((l) => l.wine_id)).size > 1;

  const lotLabel = (l: Lot) => {
    const w = wine(l.wine_id);
    const s = lotSplit(l, snapshot.groupShares);
    return [severalWines && w ? wineTitle(w) : null, location(l.location_id)?.name ?? (severalWines ? null : 'Sans emplacement'), volumeLabel(l.volume_ml), `${s.free} libre${s.free > 1 ? 's' : ''}`]
      .filter(Boolean)
      .join(' · ');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!lot || !group || value === current) return;
    setBusy(true);
    const res = await run(() => api.allocateToGroup(lot.id, group.id, value), {
      success: value === 0 ? 'Bouteilles reprises : elles sont de nouveau libres' : `${bottles(value)} à disposition de « ${group.name} »`,
    });
    setBusy(false);
    if (res.ok) onClose();
  }

  const empty =
    groups.length === 0 ? (
      <EmptyState icon="👥" title="Vous n’êtes membre d’aucun groupe" action={<Button onClick={() => (onClose(), go('/amis?onglet=groupes'))}>Voir les groupes</Button>}>
        Créez un groupe ou rejoignez-en un pour y mettre des bouteilles à disposition.
      </EmptyState>
    ) : lots.length === 0 ? (
      <EmptyState icon="🍷" title="Aucune bouteille en stock" />
    ) : null;

  const split = lot ? lotSplit(lot, snapshot.groupShares) : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={group && groupId ? `Mettre à disposition de « ${group.name} »` : 'Mettre à disposition d’un groupe'}
      footer={
        empty ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" form="alloc-form" loading={busy} disabled={!lot || !group || value === current}>
              {value < current && value === 0 ? 'Tout reprendre' : 'Enregistrer'}
            </Button>
          </>
        )
      }
    >
      {empty ?? (
        <form id="alloc-form" className="form" onSubmit={submit}>
          {!severalWines && lot && <p className="muted">{wine(lot.wine_id) ? wineTitle(wine(lot.wine_id)!) : ''}</p>}
          {lots.length > 1 && (
            <Field label={severalWines ? 'Bouteille' : 'Lot concerné'}>
              <select
                className="input"
                value={lotId}
                onChange={(e) => {
                  setLotId(e.target.value);
                  setValue(allocated(e.target.value, gid));
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
          {groups.length > 1 && !groupId && (
            <Field label="Groupe">
              <select
                className="input"
                value={gid}
                onChange={(e) => {
                  setGid(e.target.value);
                  setValue(allocated(lotId, e.target.value));
                }}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {`${g.emoji} ${g.name}${allocated(lotId, g.id) ? ` (${allocated(lotId, g.id)} déjà)` : ''}`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {lot && split && group && (
            <>
              <Field
                label={`Bouteilles pour « ${group.name} »`}
                hint={`Au plus ${current + split.free} (les bouteilles libres de ce lot${current ? ', plus celles déjà mises à disposition' : ''}). 0 pour toutes les reprendre.`}
              >
                <Stepper value={value} onChange={setValue} min={0} max={current + split.free} label="Bouteilles mises à disposition" />
              </Field>
              <p className="strong" aria-live="polite">
                Après : {splitText(lot.quantity, split.forGroups - current + value, split.forEvents)}
              </p>
              {current + split.free === 0 && <Notice tone="warn">Plus aucune bouteille libre dans ce lot : elles sont toutes réservées pour un événement ou un autre groupe.</Notice>}
              <Notice>
                Elles restent à vous, et personne d’autre ne peut les ouvrir. Les membres du groupe voient combien sont à leur disposition, même si vous masquez la quantité exacte.
              </Notice>
            </>
          )}
        </form>
      )}
    </Sheet>
  );
}
