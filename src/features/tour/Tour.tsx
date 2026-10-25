/**
 * Visite guidée : écran de bienvenue à la première connexion, visite qui met en évidence les vrais boutons (le reste de
 * l'écran est assombri), progression enregistrée dans le profil (reprise là où l'on s'était arrêté), astuces à la
 * première visite d'une page. Jamais imposée : « Passer » à tout moment, et on la revoit depuis les Réglages.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Compass, Lightbulb } from 'lucide-react';
import { useStore } from '../../data/store';
import type { Preferences, TourState } from '../../domain/types';
import { Button, Sheet, useToast } from '../../ui/kit';
import { go, useRoute } from '../../ui/router';
import { useAiStatus } from '../cellar/LabelScan';
import { tourSteps, tourTarget, type TourStep } from './steps';

type TourApi = {
  running: boolean;
  /** Visite interrompue (application fermée en cours de route) : étape atteinte. */
  resumable: { step: number; total: number } | null;
  start: (step?: number) => void;
  later: () => void;
  stop: () => void;
  /** Une astuce de première visite est à montrer (ni visite ni bienvenue en cours, pas encore vue). */
  tipVisible: (id: string) => boolean;
  dismissTip: (id: string) => void;
  resetTips: () => void;
};

const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const t = useContext(TourContext);
  if (!t) throw new Error('useTour hors du TourProvider');
  return t;
}

const LATER_KEY = 'cave-amis-visite-plus-tard';

export function TourProvider({ children }: { children: ReactNode }) {
  const { me, api, run, snapshot } = useStore();
  const toast = useToast();
  const route = useRoute();
  const prefs = me.preferences ?? {};
  // État connu tout de suite à l'écran, enregistré en arrière-plan (fusion côté base).
  const [local, setLocal] = useState<TourState | null>(null);
  const [localTips, setLocalTips] = useState<string[] | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(LATER_KEY) === '1';
    } catch {
      return false;
    }
  });
  const tour = local ?? prefs.tour ?? null;
  const tips = localTips ?? prefs.tips ?? [];
  const running = index !== null;
  const hasGroups = snapshot.groups.some((g) => g.my_status === 'active');
  const total = tourSteps({ admin: me.is_admin, assistant: true, hasGroups }).length;

  const save = useCallback((patch: Partial<Preferences>) => void run(() => api.mergePreferences(patch), { silent: true, reload: false }), [api, run]);

  const setTour = useCallback(
    (next: TourState) => {
      setLocal(next);
      save({ tour: next });
    },
    [save],
  );

  const start = useCallback(
    (step = 0) => {
      const s = Math.min(Math.max(step, 0), total - 1);
      setIndex(s);
      setTour({ status: 'active', step: s });
    },
    [setTour, total],
  );

  const end = useCallback(
    (status: 'done' | 'skipped') => {
      setTour({ status, step: index ?? 0 });
      setIndex(null);
      go('/', { replace: true });
      if (status === 'done') toast('Visite terminée. Elle se revoit à tout moment dans les Réglages.');
    },
    [index, setTour, toast],
  );

  const value = useMemo<TourApi>(
    () => ({
      running,
      resumable: !running && !later && tour?.status === 'active' ? { step: Math.min(tour.step, total - 1), total } : null,
      start,
      later: () => {
        setLater(true);
        try {
          sessionStorage.setItem(LATER_KEY, '1');
        } catch {
          /* rappel seulement pour cette fois */
        }
      },
      stop: () => setTour({ status: 'skipped', step: tour?.step ?? 0 }),
      tipVisible: (id) => !running && tour !== null && !tips.includes(id),
      dismissTip: (id) => {
        const next = [...new Set([...tips, id])];
        setLocalTips(next);
        save({ tips: next });
      },
      resetTips: () => {
        setLocalTips([]);
        save({ tips: [] });
      },
    }),
    [running, later, tour, total, start, setTour, tips, save],
  );

  // Première connexion : la bienvenue, sauf pendant la réponse à une invitation (elle viendra juste après).
  const welcome = tour === null && !running && !route.startsWith('/ami/');

  return (
    <TourContext.Provider value={value}>
      {children}
      {welcome && (
        <WelcomeSheet
          onDiscover={() => {
            go('/', { replace: true });
            start(0);
          }}
          onSkip={() => setTour({ status: 'skipped', step: 0 })}
        />
      )}
      {index !== null && (
        <TourRunner
          admin={me.is_admin}
          hasGroups={hasGroups}
          index={index}
          onIndex={(i) => {
            setIndex(i);
            setTour({ status: 'active', step: i });
          }}
          onEnd={end}
        />
      )}
    </TourContext.Provider>
  );
}

function WelcomeSheet({ onDiscover, onSkip }: { onDiscover: () => void; onSkip: () => void }) {
  return (
    <Sheet open onClose={onSkip} title="Bienvenue sur Cave & Amis ! 🍷">
      <div className="stack">
        <p>Découvrez une nouvelle façon de gérer vos bouteilles, de les partager avec vos amis et d’organiser vos moments de dégustation.</p>
        <p className="small muted">La visite guidée montre les principaux boutons en une minute. Vous pourrez la revoir dans les Réglages.</p>
        <Button size="lg" block icon={<Compass />} onClick={onDiscover} data-autofocus>
          Découvrir l’application
        </Button>
        <Button variant="secondary" block onClick={onSkip}>
          Commencer directement
        </Button>
      </div>
    </Sheet>
  );
}

/** Proposée quand une visite a été interrompue (application fermée, page rechargée). */
export function ResumeTour() {
  const tour = useTour();
  if (!tour.resumable) return null;
  const { step, total } = tour.resumable;
  return (
    <div className="card gold stack-sm" role="status">
      <div className="inline">
        <Compass aria-hidden />
        <strong>Reprendre la visite guidée ?</strong>
      </div>
      <p className="small">
        Vous vous étiez arrêté à l’étape {step + 1} sur {total}.
      </p>
      <div className="inline">
        <Button size="sm" onClick={() => tour.start(step)}>
          Reprendre
        </Button>
        <Button size="sm" variant="ghost" onClick={tour.later}>
          Plus tard
        </Button>
        <Button size="sm" variant="ghost" onClick={tour.stop}>
          Arrêter la visite
        </Button>
      </div>
    </div>
  );
}

/** Astuce montrée à la première visite d'une page ; « J'ai compris » ne la remontre plus. */
export function FirstTip({ id, title, onHelp, children }: { id: string; title: string; onHelp: () => void; children: ReactNode }) {
  const tour = useTour();
  if (!tour.tipVisible(id)) return null;
  return (
    <aside className="card soft stack-sm first-tip" aria-label={`Astuce : ${title}`}>
      <div className="inline">
        <Lightbulb aria-hidden style={{ color: 'var(--gold-ink)' }} />
        <strong>{title}</strong>
      </div>
      <p className="small">{children}</p>
      <div className="inline">
        <Button size="sm" variant="secondary" onClick={onHelp}>
          Voir l’aide
        </Button>
        <Button size="sm" variant="ghost" onClick={() => tour.dismissTip(id)}>
          J’ai compris
        </Button>
      </div>
    </aside>
  );
}

function TourRunner({
  admin,
  hasGroups,
  index,
  onIndex,
  onEnd,
}: {
  admin: boolean;
  hasGroups: boolean;
  index: number;
  onIndex: (i: number) => void;
  onEnd: (status: 'done' | 'skipped') => void;
}) {
  const ai = useAiStatus();
  const steps = useMemo(() => tourSteps({ admin, assistant: !ai.unavailable, hasGroups }), [admin, ai.unavailable, hasGroups]);
  const step: TourStep = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const route = useRoute();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Aller sur la bonne page, puis trouver l'élément à mettre en évidence (une seconde au plus).
  useEffect(() => {
    setReady(false);
    if (step.route && route !== step.route) {
      go(step.route, { replace: true });
      return;
    }
    let alive = true;
    let frame = 0;
    let tries = 0;
    const find = () => {
      if (!alive) return;
      const el = tourTarget(step.target);
      if (!el && tries++ < 60) {
        frame = requestAnimationFrame(find);
        return;
      }
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
      frame = requestAnimationFrame(() => {
        if (!alive) return;
        setRect(el ? el.getBoundingClientRect() : null);
        setReady(true);
      });
    };
    find();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [step, route]);

  // Suit l'élément si l'écran change de taille ou défile.
  useEffect(() => {
    if (!ready) return;
    const update = () => setRect(tourTarget(step.target)?.getBoundingClientRect() ?? null);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [ready, step]);

  // Le bouton principal reçoit le focus à chaque étape ; la page derrière ne défile plus.
  useEffect(() => {
    if (ready) cardRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus({ preventScroll: true });
  }, [ready, index]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const next = () => (last ? onEnd('done') : onIndex(index + 1));
  const prev = () => index > 0 && onIndex(index - 1);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onEnd('skipped');
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Tab' && cardRef.current) {
      const items = [...cardRef.current.querySelectorAll<HTMLButtonElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    }
  }

  // Position de la carte : en bas ou en haut de l'écran sur téléphone (jamais coupée), près de l'élément sur ordinateur.
  let place: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 640) {
      place = rect.top + rect.height / 2 > h / 2 ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
    } else {
      const left = Math.min(Math.max(rect.left + rect.width / 2 - 180, 16), w - 376);
      place = h - rect.bottom > 240 ? { left, top: rect.bottom + 14 } : { left, bottom: h - rect.top + 14 };
    }
  }

  return createPortal(
    <div className="tour" onKeyDown={onKey}>
      {rect ? (
        <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} aria-hidden />
      ) : (
        <div className="tour-dim" aria-hidden />
      )}
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-labelledby={titleId} style={place} hidden={!ready}>
        <div className="tour-progress" aria-hidden>
          <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="small muted">
          Étape {index + 1} sur {steps.length}
        </p>
        <h2 id={titleId}>{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-actions">
          <Button size="sm" variant="ghost" onClick={() => onEnd('skipped')}>
            Passer
          </Button>
          <span className="spacer" />
          {index > 0 && (
            <Button size="sm" variant="secondary" onClick={prev}>
              Précédent
            </Button>
          )}
          <Button size="sm" data-primary onClick={next}>
            {last ? 'Terminer' : 'Suivant'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
