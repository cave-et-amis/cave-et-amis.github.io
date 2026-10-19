import { useState } from 'react';
import { ChevronRight, Download, KeyRound, LogOut, Shield, Smartphone, Trash2, Warehouse } from 'lucide-react';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import type { Visibility } from '../../domain/types';
import { VISIBILITIES } from '../../domain/wine';
import { Button, Check, Field, Notice, Sheet, useConfirm, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { useAiStatus } from '../cellar/LabelScan';

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP', 'CAD'];

export function SettingsPage() {
  const { me, email, api, run, snapshot } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const ai = useAiStatus();
  const [name, setName] = useState(me.display_name);
  const [password, setPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const prefs = me.preferences ?? {};

  const savePrefs = (patch: Partial<typeof prefs>) => run(() => api.updateProfile(me.id, { preferences: { ...prefs, ...patch } }), { success: 'Préférence enregistrée' });

  return (
    <>
      <section className="card form" aria-labelledby="h-profile">
        <h2 id="h-profile" className="section">
          Mon profil
        </h2>
        <Field label="Prénom affiché" htmlFor="s-name" hint="Visible par vos amis et les participants de vos événements.">
          <div className="inline" style={{ flexWrap: 'nowrap' }}>
            <input id="s-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <Button
              variant="secondary"
              disabled={!name.trim() || name.trim() === me.display_name}
              onClick={() => void run(() => api.updateProfile(me.id, { display_name: name.trim() }), { success: 'Prénom enregistré' })}
            >
              Enregistrer
            </Button>
          </div>
        </Field>
        <Field label="Adresse e-mail">
          <span className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>
            {email}
          </span>
        </Field>
        <Field label="Devise de mes prix">
          <select className="input" value={me.currency} onChange={(e) => void run(() => api.updateProfile(me.id, { currency: e.target.value }), { success: 'Devise enregistrée' })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" icon={<KeyRound />} onClick={() => setPassword(true)}>
          Changer de mot de passe
        </Button>
      </section>

      <section className="card form" aria-labelledby="h-prefs">
        <h2 id="h-prefs" className="section">
          Préférences
        </h2>
        <Field label="Partage proposé pour les nouvelles bouteilles" hint="Vous pouvez toujours choisir bouteille par bouteille.">
          <select className="input" value={prefs.default_visibility ?? 'private'} onChange={(e) => void savePrefs({ default_visibility: e.target.value as Visibility })}>
            {VISIBILITIES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Check checked={Boolean(prefs.advanced)} onChange={(advanced) => void savePrefs({ advanced })} label="Ouvrir d’emblée les champs avancés des formulaires" hint="Pour les amateurs qui renseignent tout (domaine, cépages, conseils…)." />
      </section>

      <div className="list">
        <a className="row" href="#/reglages/caves">
          <Warehouse aria-hidden style={{ color: 'var(--primary)' }} />
          <span className="row-main">
            <span className="row-title">Caves et emplacements</span>
            <span className="row-sub">
              {snapshot.cellars.length} cave{snapshot.cellars.length > 1 ? 's' : ''}, {snapshot.locations.length} emplacement{snapshot.locations.length > 1 ? 's' : ''}
            </span>
          </span>
          <ChevronRight aria-hidden />
        </a>
        <a className="row" href="#/cave">
          <Download aria-hidden style={{ color: 'var(--primary)' }} />
          <span className="row-main">
            <span className="row-title">Exporter mes données</span>
            <span className="row-sub">Ma cave (inventaire) et mon carnet : boutons « Exporter » en bas de chaque liste</span>
          </span>
          <ChevronRight aria-hidden />
        </a>
        {me.is_admin && (
          <a className="row" href="#/admin">
            <Shield aria-hidden style={{ color: 'var(--gold-ink)' }} />
            <span className="row-main">
              <span className="row-title">Administration</span>
              <span className="row-sub">Assistant IA : clé, modèle, quotas, budget, consommation</span>
            </span>
            <ChevronRight aria-hidden />
          </a>
        )}
      </div>

      <section className="card stack-sm" aria-labelledby="h-ai">
        <h2 id="h-ai" className="section">
          Assistant
        </h2>
        {!ai.loaded ? (
          <span className="muted small">Vérification…</span>
        ) : ai.unavailable ? (
          <Notice tone="warn">{ai.unavailable}</Notice>
        ) : ai.status ? (
          <p className="small">
            Disponible. Aujourd’hui : {ai.status.requests_today} demande{ai.status.requests_today > 1 ? 's' : ''} sur {ai.status.daily_limit}. Ce mois-ci :{' '}
            {ai.status.month_pct} % de votre limite.{!ai.status.web_search ? ' Recherche web des prix désactivée.' : ''}
          </p>
        ) : (
          <Notice tone="warn">État de l’assistant inconnu (serveur injoignable).</Notice>
        )}
        <p className="small faint">Vos conversations avec l’assistant sont privées : ni vos amis ni l’administrateur ne peuvent les lire.</p>
      </section>

      <section className="card stack-sm" aria-labelledby="h-install">
        <div className="inline">
          <Smartphone aria-hidden style={{ color: 'var(--primary)' }} />
          <h2 id="h-install" className="section">
            Installer sur le téléphone
          </h2>
        </div>
        <p className="small">
          iPhone : bouton Partager › « Sur l’écran d’accueil ». Android : menu ⋮ › « Installer l’application » ou « Ajouter à l’écran d’accueil ».
        </p>
      </section>

      <section className="card stack-sm" aria-labelledby="h-privacy">
        <h2 id="h-privacy" className="section">
          Confidentialité
        </h2>
        <p className="small">
          Tout est privé par défaut. Pour chaque lot, vous choisissez : privé, partagé avec vos amis, ou proposable pour un événement — et vous pouvez masquer le
          prix, la quantité exacte et vos notes. Il n’existe pas de cave publique : seuls vos amis acceptés voient ce que vous partagez. Supprimer un ami lui
          retire immédiatement cet accès.
        </p>
      </section>

      <Button
        variant="secondary"
        icon={<LogOut />}
        onClick={async () => {
          if (await confirm({ title: 'Se déconnecter ?', confirmLabel: 'Se déconnecter' })) await api.signOut();
        }}
      >
        Se déconnecter
      </Button>
      <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
        Supprimer mon compte
      </Button>
      <p className="small faint center">Cave &amp; Amis — votre cave, vos amis, la bonne bouteille au bon moment.</p>

      {password && <PasswordSheet onClose={() => setPassword(false)} />}
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

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { api, run } = useStore();
  const [pw, setPw] = useState('');
  return (
    <Sheet
      open
      onClose={onClose}
      title="Nouveau mot de passe"
      footer={
        <Button
          disabled={pw.length < 8}
          onClick={async () => {
            const res = await run(() => api.updatePassword(pw), { success: 'Mot de passe changé', reload: false });
            if (res.ok) onClose();
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <Field label="Nouveau mot de passe" htmlFor="pw-new" hint="8 caractères au minimum.">
        <input id="pw-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus />
      </Field>
    </Sheet>
  );
}

function DeleteAccountSheet({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => Promise<void> }) {
  const { api } = useStore();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Supprimer mon compte"
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={typed !== 'SUPPRIMER'}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api.ai('delete_account', { confirm: 'SUPPRIMER' });
              if (!res.ok) throw new Error(res.message);
              await onDeleted();
            } catch (e) {
              setError((e as Error).message || toMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Supprimer définitivement
        </Button>
      }
    >
      <div className="form">
        <Notice tone="danger">
          Vos caves, vins, dégustations, photos et conversations seront supprimés définitivement. Les événements que vous organisez seront supprimés pour tous ;
          vos bouteilles réservées ailleurs seront libérées.
        </Notice>
        <Field label="Tapez SUPPRIMER pour confirmer" htmlFor="del-confirm">
          <input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}
