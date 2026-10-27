/**
 * Animations communes (bibliothèque Motion) : réglages globaux, lignes de liste, retour au toucher.
 * Sobres et courtes (150 à 300 ms) ; seules la transparence et la position (transform) sont animées, pour rester fluide
 * sur un téléphone d'entrée de gamme. « Réduire les animations » du téléphone est respecté (MotionConfig).
 */
import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig, type Transition } from 'motion/react';

const loadFeatures = () => import('./motionFeatures').then((mod) => mod.default);

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const QUICK: Transition = { duration: 0.2, ease: EASE_OUT };
export const EXIT: Transition = { duration: 0.15, ease: 'easeIn' };

/**
 * Composant `m` et moteur d'animation chargé à part après le démarrage (motionFeatures) : l'application s'affiche aussi
 * vite qu'avant, les animations suivent.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={QUICK}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/** Léger enfoncement au toucher (boutons, cartes, lignes). */
export const TAP = { scale: 0.97 };
export const ROW_TAP = { scale: 0.985 };

/** Au-delà, les lignes apparaissent sans animation : une longue cave reste fluide. */
const ANIMATED_ROWS = 20;

/**
 * Ligne d'une liste : apparition en cascade (30 ms d'écart, plafonné), glissement des autres lignes quand une ligne est
 * ajoutée ou retirée, léger enfoncement au toucher si la ligne est cliquable.
 */
export function rowMotion(index: number, tap = true) {
  return {
    layout: 'position' as const,
    initial: index < ANIMATED_ROWS ? { opacity: 0, y: 8 } : false,
    animate: { opacity: 1, y: 0, transition: { ...QUICK, delay: Math.min(index, 10) * 0.03 } },
    whileTap: tap ? ROW_TAP : undefined,
  };
}
