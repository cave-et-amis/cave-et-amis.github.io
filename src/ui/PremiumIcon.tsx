/**
 * Icônes 3D photoréalistes de Cave & Amis 2.0 (menu, barre du bas) : une image WebP par icône, en deux tailles (64 et
 * 96 px). Les états (normal, survolé, actif, désactivé) sont rendus par le style de l'élément parent, sans autre image.
 * Toujours décorative : le libellé de l'entrée de menu reste son nom accessible. Si l'image ne se charge pas, le
 * pictogramme au trait passé en `fallback` s'affiche à la place.
 */
import { useState, type ReactNode } from 'react';

export type PremiumIconName =
  | 'accueil'
  | 'cave'
  | 'explorer'
  | 'lia'
  | 'evenements'
  | 'amis'
  | 'achats'
  | 'statistiques'
  | 'carnet'
  | 'parametres'
  | 'administration'
  | 'ajouter';

export function PremiumIcon({ name, size = 32, fallback }: { name: PremiumIconName; size?: number; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed && fallback) return <>{fallback}</>;
  return (
    <span className="premium-icon" style={{ width: size + 4, height: size + 4 }} aria-hidden>
      <img
        src={`/img/icones/icone-${name}-${size > 40 ? 96 : 64}.webp`}
        srcSet={`/img/icones/icone-${name}-64.webp 64w, /img/icones/icone-${name}-96.webp 96w`}
        sizes={`${size}px`}
        width={size}
        height={size}
        alt=""
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
