/**
 * Barre du bas « meniscus » (téléphone et tablette) : enveloppe React du Web Component <meniscus-tabbar>.
 * Le composant ne connaît pas le routeur : l'appli lui donne les onglets et l'onglet actif (attribut `active`, sans
 * événement), et change d'écran quand la personne choisit un onglet (événement tab-change). Pendant que la goutte est
 * glissée, l'écran ne change qu'au lâcher. Toucher l'onglet déjà actif depuis une sous-page revient à son écran.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import './meniscus-tabbar.js';
import type { MeniscusTab, MeniscusTabbarElement, MeniscusTabChange } from './meniscus-tabbar';

export type { MeniscusTab };

export function MeniscusNav({ tabs, active, onSelect }: { tabs: MeniscusTab[]; active: string | null; onSelect: (id: string) => void }) {
  const ref = useRef<MeniscusTabbarElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  // Les onglets ne sont redonnés au composant que s'ils changent vraiment (un badge, par exemple) : sinon il se
  // redessinerait à chaque rendu de l'appli.
  const key = JSON.stringify(tabs);
  // Avant l'affichage : jamais d'onglets par défaut du composant à l'écran, même une image.
  useLayoutEffect(() => {
    if (ref.current) ref.current.tabs = JSON.parse(key) as MeniscusTab[];
  }, [key]);

  // Onglet actif suivi par l'adresse : sans événement (pas de navigation en retour). Une page hors des onglets
  // (Réglages, Explorer…) laisse la goutte où elle est.
  useLayoutEffect(() => {
    if (active && ref.current) ref.current.setAttribute('active', active);
  }, [active, key]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pending: string | null = null;
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<MeniscusTabChange>).detail;
      if (d.dragging) pending = d.id;
      else select.current(d.id);
    };
    // Lâcher de la goutte : l'onglet final seulement. Toucher la goutte ou l'onglet actif : retour à son écran.
    const onRelease = () => {
      if (pending) select.current(pending);
      pending = null;
    };
    const onClick = (e: MouseEvent) => {
      const hit = e.composedPath().find((n) => n instanceof HTMLElement && (n.classList.contains('bead') || n.dataset.id === el.activeId));
      if (hit) select.current(el.activeId);
    };
    el.addEventListener('tab-change', onChange);
    el.addEventListener('pointerup', onRelease);
    el.addEventListener('pointercancel', onRelease);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('tab-change', onChange);
      el.removeEventListener('pointerup', onRelease);
      el.removeEventListener('pointercancel', onRelease);
      el.removeEventListener('click', onClick);
    };
  }, []);

  return <meniscus-tabbar ref={ref} />;
}
