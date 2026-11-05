/**
 * Documents à accepter ou à lire après la connexion (modèle commun avec Cocon) :
 *  - conditions d'utilisation à accepter : fenêtre bloquante ; un refus ne supprime rien (compte et données gardés),
 *    mais l'application reste fermée, sauf télécharger ses données, supprimer son compte ou se déconnecter. Le silence ne
 *    vaut jamais acceptation : la fenêtre revient à chaque connexion ;
 *  - documents à lire (politique de confidentialité, mentions légales, cookies, changement mineur des conditions) :
 *    écran bloquant « À lire avant de continuer », un document après l'autre, depuis le 05/11/2026.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import type { Api } from '../../data/api';
import { useStore } from '../../data/store';
import { MIN_AGE, type LegalDoc, type LegalPending } from '../../domain/legal';
import { toMessage } from '../../domain/errors';
import { Button, Check, InlineLoading, Notice, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { DeleteAccountSheet } from '../settings/DeleteAccountSheet';
import { LegalDocView, LegalSheet, useLegalDocs } from './LegalViews';
import { ExportButton } from './PrivacyPage';

type LegalState = { pending: LegalPending[]; refresh: () => Promise<void> };

const LegalContext = createContext<LegalState>({ pending: [], refresh: async () => {} });

export function LegalProvider({ value, children }: { value: LegalState; children: ReactNode }) {
  return <LegalContext.Provider value={value}>{children}</LegalContext.Provider>;
}

export function useLegal() {
  return useContext(LegalContext);
}

/** Documents en attente ; sans réponse du serveur, rien ne bloque l'application (on réessaie à la connexion suivante). */
export async function loadPending(api: Api): Promise<LegalPending[]> {
  try {
    return await api.legalPending();
  } catch {
    return [];
  }
}

/** Fenêtre bloquante : conditions d'utilisation à accepter (case jamais cochée d'avance). */
export function TermsGate({ item }: { item: LegalPending }) {
  const { api } = useStore();
  const { refresh } = useLegal();
  const toast = useToast();
  const { docs, byKind } = useLegalDocs(api);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const doc = docs?.find((d) => d.id === item.document_id) ?? byKind('cgu');
  const policy = byKind('confidentialite');

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>{refused ? 'Conditions refusées' : item.version > 1 ? 'Nouvelles conditions d’utilisation' : 'Conditions d’utilisation'}</h1>
        </div>
        {refused ? (
          <section className="card stack">
            <Notice tone="warn">
              Sans votre accord, vous ne pouvez pas utiliser Cave &amp; Amis. Rien n’est supprimé : votre compte et vos données sont gardés, et vous pouvez
              changer d’avis à tout moment.
            </Notice>
            <Button onClick={() => setRefused(false)}>Relire les conditions</Button>
            <ExportButton variant="secondary" />
            <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
              Supprimer mon compte
            </Button>
            <Button variant="ghost" icon={<LogOut />} onClick={() => void api.signOut()}>
              Se déconnecter
            </Button>
          </section>
        ) : (
          <section className="card stack">
            <p className="small">
              {item.version > 1
                ? 'Les conditions d’utilisation ont changé. Pour continuer à utiliser Cave & Amis, lisez-les et acceptez-les.'
                : 'Pour continuer à utiliser Cave & Amis, lisez les conditions d’utilisation et acceptez-les.'}
            </p>
            {item.summary && (
              <p className="small">
                <strong>Ce qui change :</strong> {item.summary}
              </p>
            )}
            <div className="legal-scroll" tabIndex={0} aria-label="Texte des conditions d’utilisation">
              {!docs ? <InlineLoading /> : doc ? <LegalDocView doc={doc} /> : <Notice tone="warn">Le texte n’a pas pu être chargé. Réessayez plus tard.</Notice>}
            </div>
            {policy && (
              <Button variant="ghost" onClick={() => setReading(policy)}>
                Lire aussi la politique de confidentialité
              </Button>
            )}
            <Check checked={checked} onChange={setChecked} label={`J’ai ${MIN_AGE} ans ou plus et j’accepte les conditions d’utilisation`} />
            <Button
              size="lg"
              block
              loading={busy}
              disabled={!checked || !doc}
              onClick={async () => {
                if (!doc) return;
                setBusy(true);
                try {
                  await api.legalAccept(doc.id, 'acceptation', 'connexion');
                  await refresh();
                } catch (e) {
                  toast(toMessage(e), { tone: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Accepter et continuer
            </Button>
            <Button variant="ghost" block onClick={() => setRefused(true)}>
              Refuser
            </Button>
          </section>
        )}
      </div>
      {reading && <LegalSheet doc={reading} onClose={() => setReading(null)} />}
      {deleting && (
        <DeleteAccountSheet
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            toast('Compte supprimé. À bientôt !');
            await api.signOut();
            go('/', { replace: true });
          }}
        />
      )}
    </main>
  );
}

const READ_ORDER: LegalPending['kind'][] = ['cgu', 'confidentialite', 'mentions', 'cookies'];

/** Ordre de lecture : conditions, politique de confidentialité, mentions légales, cookies. */
export function sortForReading(items: LegalPending[]) {
  return [...items].sort((a, b) => READ_ORDER.indexOf(a.kind) - READ_ORDER.indexOf(b.kind));
}

const READ_LABEL: Record<LegalPending['kind'], string> = {
  cgu: 'les conditions d’utilisation',
  confidentialite: 'la politique de confidentialité',
  mentions: 'les mentions légales',
  cookies: 'la page « Cookies et stockage sur votre appareil »',
};

/**
 * Fenêtre bloquante : un document à lire avant de continuer (décision de l'éditeur du 05/11/2026). « J'ai lu » ne
 * s'active qu'une fois le texte parcouru jusqu'au bout ; c'est une lecture, jamais un consentement. Comme pour les
 * conditions, on peut toujours télécharger ses données, supprimer son compte ou se déconnecter.
 */
export function ReadGate({ item, left }: { item: LegalPending; left: number }) {
  const { api } = useStore();
  const { refresh } = useLegal();
  const toast = useToast();
  const { docs } = useLegalDocs(api);
  const [busy, setBusy] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const doc = docs?.find((d) => d.id === item.document_id) ?? null;
  // Fin du texte atteinte (ou texte assez court pour tenir sans défiler).
  const watch = (el: HTMLDivElement | null) => {
    if (!el || atEnd) return;
    const check = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 24 && setAtEnd(true);
    el.onscroll = check;
    requestAnimationFrame(check);
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>À lire avant de continuer</h1>
        </div>
        <section className="card stack">
          <p className="small">
            Pour utiliser Cave &amp; Amis, lisez {READ_LABEL[item.kind]}
            {item.version > 1 ? ` (version ${item.version})` : ''}.{left > 1 ? ` Encore ${left - 1} document${left > 2 ? 's' : ''} après celui-ci.` : ''}
          </p>
          {item.summary && (
            <p className="small">
              <strong>Ce qui change :</strong> {item.summary}
            </p>
          )}
          <div className="legal-scroll" tabIndex={0} aria-label={`Texte : ${item.title}`} ref={doc ? watch : undefined}>
            {!docs ? <InlineLoading /> : doc ? <LegalDocView doc={doc} /> : <Notice tone="warn">Le texte n’a pas pu être chargé. Réessayez plus tard.</Notice>}
          </div>
          {!atEnd && doc && <p className="small faint">Faites défiler le texte jusqu’au bout pour continuer.</p>}
          <Button
            size="lg"
            block
            loading={busy}
            disabled={!doc || !atEnd}
            onClick={async () => {
              if (!doc) return;
              setBusy(true);
              try {
                await api.legalAccept(doc.id, 'prise_de_connaissance', 'connexion');
                await refresh();
              } catch (e) {
                toast(toMessage(e), { tone: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            J’ai lu
          </Button>
          <div className="stack-sm">
            <ExportButton variant="secondary" />
            <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
              Supprimer mon compte
            </Button>
            <Button variant="ghost" icon={<LogOut />} onClick={() => void api.signOut()}>
              Se déconnecter
            </Button>
          </div>
        </section>
      </div>
      {deleting && (
        <DeleteAccountSheet
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            toast('Compte supprimé. À bientôt !');
            await api.signOut();
            go('/', { replace: true });
          }}
        />
      )}
    </main>
  );
}

/** Bandeau : nouvelle version d'un document à lire (ancien mode « information », avant la lecture obligatoire). */
export function LegalNotice() {
  const { api } = useStore();
  const { pending, refresh } = useLegal();
  const toast = useToast();
  const { docs } = useLegalDocs(api);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const items = pending.filter((p) => p.mode === 'information');
  if (!items.length || !docs) return null;
  return (
    <>
      {items.map((p) => {
        const doc = docs.find((d) => d.id === p.document_id);
        if (!doc) return null;
        return (
          <Notice key={p.document_id} tone="info">
            <span>
              {p.kind === 'confidentialite' ? 'La politique de confidentialité a été mise à jour' : 'Les conditions d’utilisation ont été mises à jour'} (version{' '}
              {p.version}).{' '}
            </span>
            <button type="button" className="link-btn" onClick={() => setReading(doc)}>
              Lire
            </button>
          </Notice>
        );
      })}
      {reading && (
        <LegalSheet
          doc={reading}
          onClose={() => setReading(null)}
          footer={
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.legalAccept(reading.id, 'prise_de_connaissance', 'connexion');
                  setReading(null);
                  await refresh();
                } catch (e) {
                  toast(toMessage(e), { tone: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              J’ai lu
            </Button>
          }
        />
      )}
    </>
  );
}
