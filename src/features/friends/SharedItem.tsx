/** Bouteille partagée par un ami : seulement ce que son propriétaire a choisi de montrer. */
import { CalendarPlus } from 'lucide-react';
import type { SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { money } from '../../domain/format';
import { MATURITY_LABELS, maturityOf, windowOf } from '../../domain/maturity';
import { currentYear } from '../../domain/format';
import { vintageLabel, volumeLabel, wineSubtitle } from '../../domain/wine';
import { Thumb } from '../../ui/kit';

export function SharedItem({ lot, showOwner }: { lot: SharedLot; showOwner?: boolean }) {
  const { api } = useStore();
  const url = usePhotoUrl(api, lot.label_photo ?? lot.bottle_photo);
  const win = windowOf(lot);
  const m = maturityOf(win, currentYear());
  const vintage = vintageLabel(lot);
  return (
    <div className="row static" style={{ alignItems: 'flex-start' }}>
      <Thumb url={url} color={lot.color} />
      <span className="row-main">
        <span className="row-title" style={{ whiteSpace: 'normal' }}>
          {lot.name}
          {vintage && <span className="muted"> · {vintage}</span>}
        </span>
        <span className="row-sub" style={{ whiteSpace: 'normal' }}>
          {[showOwner ? `Chez ${lot.owner_name}` : null, wineSubtitle(lot), lot.volume_ml !== 750 ? volumeLabel(lot.volume_ml) : null].filter(Boolean).join(' · ')}
        </span>
        <span className="inline" style={{ gap: 6, marginTop: 4 }}>
          {m !== 'unknown' && (
            <span className="pill" title={win?.origin === 'general' ? 'Repère général très approximatif' : undefined}>
              {win?.origin === 'general' ? '≈ ' : ''}
              {MATURITY_LABELS[m]}
            </span>
          )}
          {lot.visibility === 'event' && (
            <span className="pill gold" title="Le propriétaire accepte qu’on la suggère pour un événement">
              <CalendarPlus aria-hidden /> Proposable
            </span>
          )}
          {lot.purchase_price !== null && <span className="pill">{money(lot.purchase_price, lot.currency ?? 'EUR')}</span>}
        </span>
        {lot.notes && <span className="small muted" style={{ marginTop: 4 }}>« {lot.notes} »</span>}
      </span>
      <span className="row-side">
        {lot.quantity !== null ? (
          <span className="qty">
            {lot.quantity}
            <small>{lot.quantity > 1 ? 'bouteilles' : 'bouteille'}</small>
          </span>
        ) : (
          <span className="pill">{lot.in_stock ? 'En stock' : 'Réservée'}</span>
        )}
      </span>
    </div>
  );
}
