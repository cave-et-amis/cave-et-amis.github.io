/**
 * Documents à accepter ou à lire après la connexion (modèle commun avec Cocon) :
 *  - conditions d'utilisation à accepter : fenêtre bloquante ; un refus ne supprime rien (compte et données gardés),
 *    mais l'application reste fermée, sauf télécharger ses données, supprimer son compte ou se déconnecter. Le silence ne
 *    vaut jamais acceptation : la fenêtre revient à chaque connexion ;
 *  - nouvelle version à lire (politique de confidentialité, changement mineur des conditions) : simple bandeau.
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

/** Bandeau : nouvelle version d'un document à lire (simple information, jamais un consentement). */
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
