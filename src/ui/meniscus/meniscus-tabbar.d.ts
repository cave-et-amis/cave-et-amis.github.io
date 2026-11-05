/** Types du composant <meniscus-tabbar> (meniscus-tabbar.js, Web Component sans dépendance). */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

export type MeniscusTab = {
  id: string;
  label: string;
  /** Nom d'une icône du composant (bottle, users, group, glass, user, home, calendar, settings) ou un <path> SVG. */
  icon: string;
  /** Image de l'icône 3D (bouton et goutte) ; `icon` sert de secours si elle ne se charge pas. */
  image?: string;
  /** Couleur de la goutte et du libellé. */
  color: string;
  /** Couleur de l'icône dans la goutte. */
  ink: string;
  /** Pastille de compteur (0 : aucune). */
  badge?: number;
  /** Repère de la visite guidée (attribut data-tour du bouton). */
  tour?: string;
};

export type MeniscusTabChange = { index: number; id: string; tab: MeniscusTab; previousIndex: number; dragging: boolean };

export interface MeniscusTabbarElement extends HTMLElement {
  tabs: MeniscusTab[];
  readonly activeIndex: number;
  readonly activeId: string;
  select(key: string | number, opts?: { silent?: boolean }): boolean;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'meniscus-tabbar': DetailedHTMLProps<HTMLAttributes<MeniscusTabbarElement>, MeniscusTabbarElement> & { active?: string };
    }
  }
}
