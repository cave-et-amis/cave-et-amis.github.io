/** Bouteille partagée par un ami : seulement ce que son propriétaire a choisi de montrer. */
import type { ReactNode } from 'react';
import { CalendarPlus } from 'lucide-react';
import type { SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { money } from '../../domain/format';
import { MATURITY_LABELS, maturityOf, windowOf } from '../../domain/maturity';
import { currentYear } from '../../domain/format';
import { vintageLabel, volumeLabel, wineSubtitle } from '../../domain/wine';
import { Thumb } from '../../ui/kit';

/**
 * « allocated » (cave d'un groupe) : bouteilles mises à la disposition du groupe, sinon la bouteille y est seulement visible.
 * « children » : actions affichées sous la bouteille.
 */
export function SharedItem({ lot, showOwner, allocated, children }: { lot: SharedLot; showOwner?: boolean; allocated?: number; children?: ReactNode }) {
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
          {allocated !== undefined &&
            (allocated > 0 ? (
              <span className="pill gold" title="Réservées par leur propriétaire pour le groupe">
                {allocated} disponible{allocated > 1 ? 's' : ''} pour le groupe
              </span>
            ) : (
              <span className="pill" title="Visible seulement : rien n’est réservé pour le groupe">
                Visible
              </span>
            ))}
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
        {children}
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
