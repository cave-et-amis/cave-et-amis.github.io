/** Composants d'interface réutilisables : boutons, fenêtres, confirmations, notifications, champs. */
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Info, Star, TriangleAlert, Wine as WineIcon, X } from 'lucide-react';
import { registerSheet } from './router';

// ───────────── Boutons ─────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-ghost' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', size = 'md', block, loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

// ───────────── Fenêtres ─────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModalBehavior(ref: React.RefObject<HTMLElement | null>, onClose: () => void, history = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const auto = el?.querySelector<HTMLElement>('[data-autofocus]');
    (auto ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el?.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const unregister = history ? registerSheet(() => closeRef.current()) : () => {};
    return () => {
      el?.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      unregister();
      previous?.focus?.({ preventScroll: true });
    };
  }, [ref, history]);
}

type SheetProps = { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; label?: string };

/** Fenêtre qui monte du bas de l'écran (centrée sur ordinateur). */
export function Sheet(props: SheetProps) {
  if (!props.open) return null;
  return createPortal(<SheetInner {...props} />, document.body);
}

function SheetInner({ onClose, title, children, footer, label }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(ref, onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={label ? undefined : titleId} aria-label={label} ref={ref} tabIndex={-1}>
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Fermer" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────── Confirmation ─────────────

type ConfirmOptions = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type ConfirmState = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && createPortal(<ConfirmDialog state={state} onClose={close} />, document.body)}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(ref, () => onClose(false), false);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <h2 id={titleId}>{state.title}</h2>
        {state.message && <div className="muted">{state.message}</div>}
        <div className="dialog-actions">
          <Button variant="secondary" block onClick={() => onClose(false)} data-autofocus>
            {state.cancelLabel ?? 'Annuler'}
          </Button>
          <Button variant={state.danger ? 'danger' : 'primary'} block onClick={() => onClose(true)}>
            {state.confirmLabel ?? 'Confirmer'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────── Notifications ─────────────

type Toast = { id: number; message: string; tone: 'info' | 'error'; action?: { label: string; onClick: () => void } };
type ToastFn = (message: string, opts?: { tone?: 'info' | 'error'; action?: Toast['action'] }) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? 'info', action: opts.action }]);
      setTimeout(() => dismiss(id), opts.action ? 7000 : opts.tone === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              <span className="msg">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id);
                    t.action!.onClick();
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

// ───────────── Champs ─────────────

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const autoId = useId();
  const labelId = useId();
  let control = children;
  let forId = htmlFor;
  // Champ simple (input, select, textarea) sans identifiant : il est relié automatiquement à son libellé.
  if (!forId && isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)) {
    const props = children.props as { id?: string };
    forId = props.id ?? autoId;
    control = cloneElement(children as ReactElement<{ id?: string }>, { id: forId });
  }
  return (
    <div className="field" role={forId ? undefined : 'group'} aria-labelledby={forId ? undefined : labelId}>
      {forId ? (
        <label htmlFor={forId}>{label}</label>
      ) : (
        <span className="label" id={labelId}>
          {label}
        </span>
      )}
      {control}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  wrap,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Beaucoup d'options : sur plusieurs lignes plutôt que trop serrées. */
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? 'segmented wrap' : 'segmented'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'success' | 'gold' | 'danger' | 'warn' | 'info' | 'primary'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

const AVATAR_COLORS = ['#7b1e34', '#8a5a14', '#2f5d8a', '#6b4a8f', '#2e6b3f', '#a3433a', '#5d4a4c'];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, seed, size, onClick, label }: { name: string; seed: string; size?: 'sm'; onClick?: () => void; label?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const style = { background: avatarColor(seed) };
  if (onClick) {
    return (
      <button type="button" className={`avatar ${size ?? ''}`} style={style} onClick={onClick} aria-label={label ?? name}>
        {initial}
      </button>
    );
  }
  return (
    <span className={`avatar ${size ?? ''}`} style={style} aria-hidden>
      {initial}
    </span>
  );
}

/** Petite vibration de confirmation (si l'appareil le permet). */
export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* sans effet */
  }
}

/** Copie un texte ; renvoie false si le navigateur refuse. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ───────────── Éléments propres au vin ─────────────

export function Stars({ value, onChange, label = 'Note sur 5' }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  return (
    <div className="stars" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value !== null && n <= value}
          aria-label={`${n} sur 5`}
          onClick={() => onChange(value === n ? null : n)}
        >
          <Star fill={value !== null && n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

export function StarsView({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="stars-view" role="img" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= value ? '' : 'off'} fill={n <= value ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

const ORIGIN_LABELS = { source: 'Source', general: 'Repère général', ai: 'Estimation IA', personal: 'Votre choix' } as const;

/** Origine d'une information : source citée, repère général, estimation de l'IA ou choix personnel. */
export function Origin({ kind }: { kind: keyof typeof ORIGIN_LABELS | null | undefined }) {
  if (!kind) return null;
  return <span className={`origin ${kind}`}>{ORIGIN_LABELS[kind]}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'gold' | 'danger' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {tone === 'warn' || tone === 'danger' ? <TriangleAlert aria-hidden /> : <Info aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

export function InlineLoading({ text = 'Chargement…' }: { text?: string }) {
  return (
    <div className="inline-loading" role="status">
      <span className="spinner" aria-hidden />
      {text}
    </div>
  );
}

export function WineDot({ color }: { color: string | null | undefined }) {
  return <span className="dot" style={{ background: `var(--wine-${color ?? 'autre'})` }} aria-hidden />;
}

/** Vignette d'une photo privée (lien signé) ou pictogramme de bouteille. */
export function Thumb({ url, color, alt = '' }: { url: string | null; color?: string | null; alt?: string }) {
  if (url) return <img className="bottle-thumb" src={url} alt={alt} loading="lazy" />;
  return (
    <span className="bottle-thumb" aria-hidden style={{ color: `var(--wine-${color ?? 'autre'})` }}>
      <WineIcon />
    </span>
  );
}

export function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/** Champs facultatifs repliés pour ne pas surcharger les débutants. */
export function Advanced({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="advanced" open={open}>
      <summary>{title}</summary>
      <div className="form">{children}</div>
    </details>
  );
}
