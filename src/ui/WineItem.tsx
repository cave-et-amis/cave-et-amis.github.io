/** Ligne d'un vin dans une liste : vignette, nom, millésime, appellation, maturité, quantité. */
import { Heart, Users } from 'lucide-react';
import type { WineRow } from '../domain/cellar';
import { MATURITY_LABELS } from '../domain/maturity';
import { vintageLabel, wineSubtitle } from '../domain/wine';
import { useStore } from '../data/store';
import { usePhotoUrl } from '../data/photos';
import { Thumb } from './kit';

const MATURITY_TONE = { young: 'info', ready: 'success', soon: 'gold', past: 'warn', unknown: '' } as const;

export function WineItem({ row, onOpen }: { row: WineRow; onOpen?: () => void }) {
  const { api } = useStore();
  const w = row.wine;
  const url = usePhotoUrl(api, w.label_photo ?? w.bottle_photo);
  const vintage = vintageLabel(w);
  return (
    <a className="row" href={`#/cave/vin/${w.id}`} onClick={onOpen}>
      <Thumb url={url} color={w.color} />
      <span className="row-main">
        <span className="row-title">
          {w.name}
          {vintage && <span className="muted"> · {vintage}</span>}
        </span>
        <span className="row-sub">{wineSubtitle(w) || 'Détails à compléter'}</span>
        <span className="inline" style={{ gap: 6, marginTop: 2 }}>
          {row.stock > 0 && row.maturity !== 'unknown' && (
            <span className={`pill ${MATURITY_TONE[row.maturity]}`}>
              {row.window?.origin === 'general' ? '≈ ' : ''}
              {MATURITY_LABELS[row.maturity]}
            </span>
          )}
          {row.shared && (
            <span className="pill" title="Partagé avec vos amis">
              <Users aria-hidden /> Partagé
            </span>
          )}
          {w.favorite && (
            <span className="pill primary" title="Favori">
              <Heart aria-hidden fill="currentColor" /> Favori
            </span>
          )}
        </span>
      </span>
      <span className="row-side">
        <span className="qty" aria-label={`${row.stock} bouteille${row.stock > 1 ? 's' : ''}`}>
          {row.stock}
          <small>{row.reserved > 0 ? `dont ${row.reserved} réservée${row.reserved > 1 ? 's' : ''}` : row.stock > 1 ? 'bouteilles' : 'bouteille'}</small>
        </span>
      </span>
    </a>
  );
}
