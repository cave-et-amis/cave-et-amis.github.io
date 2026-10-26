import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadTurnstile, type Turnstile } from '../../data/turnstile';
import { Notice } from '../../ui/kit';

type Problem = { kind: 'unavailable' } | { kind: 'failed'; code: string };

export type Captcha = {
  /** Jeton à joindre à l'envoi (null tant que le contrôle n'a pas réussi). Le contrôle repart aussitôt : un jeton ne sert qu'une fois. */
  take: () => string | null;
  /** Le contrôle et ses messages, à placer dans le formulaire (rien sans clé). */
  view: ReactNode;
};

/**
 * Contrôle anti-robots (Cloudflare Turnstile) d'un formulaire, seulement si une clé de site est configurée : sans clé,
 * rien n'est affiché ni chargé.
 */
export function useCaptcha(siteKey: string | null): Captcha {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [round, setRound] = useState(0);
  const widget = useRef<{ ts: Turnstile; id: string } | null>(null);

  useEffect(() => {
    if (!siteKey || !box) return;
    let alive = true;
    loadTurnstile().then(
      (ts) => {
        if (!alive) return;
        try {
          const id = ts.render(box, {
            sitekey: siteKey,
            language: 'fr',
            'response-field': false,
            callback: (t) => {
              setToken(t);
              setProblem(null);
            },
            'expired-callback': () => setToken(null),
            'error-callback': (code) => {
              setToken(null);
              setProblem({ kind: 'failed', code: String(code ?? '') });
              return true;
            },
          });
          if (id) widget.current = { ts, id };
          else setProblem({ kind: 'failed', code: '' });
        } catch {
          setProblem({ kind: 'failed', code: '' });
        }
      },
      () => alive && setProblem({ kind: 'unavailable' }),
    );
    return () => {
      alive = false;
      const w = widget.current;
      widget.current = null;
      setToken(null);
      try {
        w?.ts.remove(w.id);
      } catch {
        /* déjà retiré */
      }
    };
  }, [siteKey, box, round]);

  const reset = useCallback(() => {
    setToken(null);
    const w = widget.current;
    if (w) w.ts.reset(w.id);
  }, []);

  const take = () => {
    if (token) reset();
    return token;
  };

  const retry = () => {
    setProblem(null);
    if (problem?.kind === 'unavailable') setRound((n) => n + 1);
    else reset();
  };

  const view = siteKey ? (
    <div className="stack-sm" aria-live="polite">
      <div ref={setBox} style={{ display: 'flex', justifyContent: 'center', minHeight: problem?.kind === 'unavailable' ? 0 : 65 }} />
      {problem && (
        <Notice tone="warn">
          {problem.kind === 'unavailable'
            ? 'Le contrôle anti-robots de Cloudflare n’a pas pu se charger. Vérifiez votre connexion ; si un bloqueur de publicités est actif, autorisez ce contrôle sur ce site.'
            : `Le contrôle anti-robots a échoué${problem.code ? ` (code ${problem.code})` : ''}. Réessayez ; si cela continue, rechargez la page.`}{' '}
          <button type="button" className="link-btn" onClick={retry}>
            Réessayer
          </button>
        </Notice>
      )}
    </div>
  ) : null;

  return { take, view };
}
