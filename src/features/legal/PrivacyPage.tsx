/**
 * Réglages › « Confidentialité et mes données » : télécharger toutes ses données (archive ZIP avec les photos), ses choix
 * et leur historique, les documents acceptés, les durées de conservation, et ce que devient chaque donnée à la
 * suppression du compte.
 */
import { useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateLong } from '../../domain/format';
import { ACTION_LABELS, CONSENT_LABELS, CONTEXT_LABELS, LEGAL_TITLES, RETENTION, type LegalHistory } from '../../domain/legal';
import { toMessage } from '../../domain/errors';
import { Button, Check, InlineLoading, Notice, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { DeleteAccountSheet } from '../settings/DeleteAccountSheet';
import { buildExport, exportFileName, saveBlob } from './exportData';
import { LegalRow } from './LegalViews';

/** Bouton « Télécharger mes données », avec l'avancement des photos (aussi dans la fenêtre des conditions refusées). */
export function ExportButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { api } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  return (
    <div className="stack-sm">
      <Button
        variant={variant}
        icon={<Download />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setProgress(null);
          try {
            const res = await buildExport(api, (done, total) => setProgress({ done, total }));
            saveBlob(res.blob, exportFileName());
            toast(
              res.missing
                ? `Archive prête. ${res.missing} photo${res.missing > 1 ? 's n’ont' : ' n’a'} pas pu être ajoutée${res.missing > 1 ? 's' : ''} : la liste est dans LISEZMOI.txt.`
                : 'Archive prête : elle est dans vos téléchargements.',
            );
          } catch (e) {
            toast(toMessage(e), { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      >
        Télécharger toutes mes données
      </Button>
      {busy && progress && progress.total > 0 && (
        <p className="small muted" role="status">
          Photos : {progress.done} sur {progress.total}
        </p>
      )}
    </div>
  );
}

function useHistory() {
  const { api } = useStore();
  const [history, setHistory] = useState<LegalHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .myLegalHistory()
      .then((h) => {
        if (!alive) return;
        setHistory(h);
        setError(null);
      })
      .catch((e) => alive && setError(toMessage(e)));
    return () => {
      alive = false;
    };
  }, [api, version]);
  return { history, error, reload: () => setVersion((v) => v + 1) };
}

export function PrivacyPage() {
  const { me, api, run, snapshot } = useStore();
  const toast = useToast();
  const { history, error, reload } = useHistory();
  const [deleting, setDeleting] = useState(false);
  const [discoverable, setDiscoverable] = useState(me.discoverable);
  useEffect(() => setDiscoverable(me.discoverable), [me.discoverable]);
  const openTo = snapshot.relations.filter((r) => r.they_see_mine).length;

  return (
    <>
      <section className="card stack-sm" aria-labelledby="h-data">
        <h2 id="h-data" className="section">
          Vos données
        </h2>
        <p className="small">
          Cave &amp; Amis garde ce qu’il faut pour faire fonctionner l’application : votre compte, vos caves, votre carnet, vos contacts, vos groupes et vos
          événements. Tout est privé par défaut : vous choisissez ce que vous partagez, et avec qui. Le détail (à quoi servent vos données, qui les reçoit,
          vos droits) est dans la politique de confidentialité.
        </p>
        <div className="list">
          <LegalRow kind="confidentialite" />
          <LegalRow kind="cgu" />
          <LegalRow kind="cookies" />
          <LegalRow kind="mentions" />
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="h-export">
        <h2 id="h-export" className="section">
          Télécharger toutes mes données
        </h2>
        <p className="small">
          Une archive ZIP avec tout ce que la base garde sur vous (fichier « donnees.json », lisible par d’autres logiciels) et vos photos. Elle est préparée
          sur cet appareil et n’est envoyée nulle part.
        </p>
        <ExportButton />
        <p className="small faint">Pour un tableur : boutons « Exporter » en bas de Ma cave et de Mon carnet.</p>
      </section>

      <section className="card stack-sm" aria-labelledby="h-choices">
        <h2 id="h-choices" className="section">
          Mes choix
        </h2>
        <Check
          checked={discoverable}
          onChange={async (v) => {
            setDiscoverable(v);
            const res = await run(() => api.setDiscoverable(me.id, v), { success: v ? 'Vous apparaissez dans la recherche' : 'Vous n’apparaissez plus dans la recherche' });
            if (!res.ok) setDiscoverable(!v);
            else reload();
          }}
          label="Apparaître dans la recherche d’amis"
          hint="Désactivé au départ. Les autres membres pourraient trouver votre prénom et vous envoyer une demande, rien d’autre."
        />
        <a className="row" href="#/reglages/acces">
          <span className="row-main">
            <span className="row-title">Qui voit ma cave</span>
            <span className="row-sub">{openTo === 0 ? 'Personne' : `${openTo} personne${openTo > 1 ? 's' : ''}`}</span>
          </span>
        </a>
        <p className="small muted">
          Agenda Nous et notifications sur vos appareils : dans les <a href="#/reglages">Réglages</a>. Chaque changement de ces choix est noté ci-dessous.
        </p>
        {error && <Notice tone="warn">{error}</Notice>}
        {history === null && !error ? (
          <InlineLoading />
        ) : history && history.consents.length > 0 ? (
          <ul className="small">
            {history.consents.map((c, i) => (
              <li key={i}>
                {CONSENT_LABELS[c.purpose] ?? c.purpose} : {c.granted ? 'oui' : 'non'}, le {dateLong(c.at)} ({CONTEXT_LABELS[c.context] ?? c.context})
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card stack-sm" aria-labelledby="h-docs">
        <h2 id="h-docs" className="section">
          Documents acceptés ou lus
        </h2>
        {history === null && !error ? (
          <InlineLoading />
        ) : history && history.acceptances.length > 0 ? (
          <ul className="small">
            {history.acceptances.map((a, i) => (
              <li key={i}>
                {LEGAL_TITLES[a.kind] ?? a.title}, version {a.version} : {ACTION_LABELS[a.action].toLowerCase()} le {dateLong(a.at)} ({CONTEXT_LABELS[a.context] ?? a.context})
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Aucun pour l’instant.</p>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="h-retention">
        <h2 id="h-retention" className="section">
          Combien de temps vos données sont gardées
        </h2>
        <ul className="small">
          {RETENTION.map((r) => (
            <li key={r.data}>
              <strong>{r.data}</strong> : {r.duration}.
            </li>
          ))}
        </ul>
        <p className="small faint">Ces durées sont appliquées automatiquement : chaque nuit, et chaque mois pour les photos.</p>
      </section>

      <section className="card stack-sm" aria-labelledby="h-rights">
        <h2 id="h-rights" className="section">
          Corriger ou effacer
        </h2>
        <p className="small">
          Vous pouvez corriger ou supprimer à tout moment vos fiches, lots, dégustations, envies, événements, conversations et analyses, et changer votre prénom
          dans les Réglages. Votre adresse e-mail ne se modifie pas encore dans l’application : écrivez à l’adresse de contact indiquée dans la politique de
          confidentialité.
        </p>
        <p className="small">
          <strong>Supprimer votre compte</strong> efface votre profil, vos caves, vins, dégustations, envies, photos, conversations, analyses, contacts, accès et
          invitations, ainsi que les événements que vous organisez (pour tous leurs participants). Restent chez les autres : votre prénom dans leurs
          notifications et dans l’activité de leurs groupes, et les envies que vous avez proposées dans un groupe (sans votre nom). Les journaux d’usage de
          l’assistant sont gardés sans votre identifiant jusqu’à la fin de leur durée. La preuve que vous aviez accepté les conditions d’utilisation est
          gardée 5 ans, puis effacée. Si votre agenda Nous est relié, vos événements y sont mis à la corbeille.
        </p>
        <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
          Supprimer mon compte
        </Button>
      </section>

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
    </>
  );
}
