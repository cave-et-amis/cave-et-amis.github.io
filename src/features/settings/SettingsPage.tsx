import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Compass, Eye, KeyRound, Lightbulb, LockKeyhole, LogOut, Mail, MonitorSmartphone, Shield, Smartphone, Trash2, Warehouse } from 'lucide-react';
import { squareAvatar } from '../../data/photos';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import { PASSWORD_HINT, passwordProblem } from '../../domain/password';
import type { Visibility } from '../../domain/types';
import { VISIBILITIES } from '../../domain/wine';
import { Avatar, Button, Check, Field, Notice, Segmented, Sheet, useConfirm, useToast } from '../../ui/kit';
import { applyTheme, DEFAULT_THEME, THEMES, type Theme } from '../../ui/theme';
import { go } from '../../ui/router';
import { useCaptcha } from '../auth/Captcha';
import { useAiStatus } from '../cellar/LabelScan';
import { LegalLinks } from '../legal/LegalViews';
import { useTour } from '../tour/Tour';
import { PushSettings } from '../push/PushSettings';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { MfaSection } from './MfaSection';
import { NousSection } from './NousSection';

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP', 'CAD'];

export function SettingsPage() {
  const { me, email, api, run, snapshot } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const ai = useAiStatus();
  const tour = useTour();
  const [name, setName] = useState(me.display_name);
  const [password, setPassword] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Affiché aussitôt coché ou décoché ; revient en arrière seulement si l'enregistrement échoue.
  const [discoverable, setDiscoverable] = useState(me.discoverable);
  useEffect(() => setDiscoverable(me.discoverable), [me.discoverable]);
  const [showShared, setShowShared] = useState(me.show_shared_wines);
  useEffect(() => setShowShared(me.show_shared_wines), [me.show_shared_wines]);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const prefs = me.preferences ?? {};
  // Photo recadrée en carré sur l'appareil (métadonnées retirées), puis envoyée ; l'ancienne est supprimée.
  const changePhoto = async (file: File | null) => {
    setPhotoBusy(true);
    await run(async () => api.setAvatar(me.id, file ? await squareAvatar(file) : null, me.avatar_photo), {
      success: file ? 'Photo de profil enregistrée' : 'Photo de profil retirée',
    });
    setPhotoBusy(false);
  };
  const openTo = snapshot.relations.filter((r) => r.they_see_mine).length;

  // Fusion côté base : n'écrase ni la visite guidée ni les astuces enregistrées entre-temps.
  const savePrefs = (patch: Partial<typeof prefs>) => run(() => api.mergePreferences(patch), { success: 'Préférence enregistrée' });

  return (
    <>
      <section className="card form" aria-labelledby="h-profile">
        <h2 id="h-profile" className="section">
          Mon profil
        </h2>
        <Field label="Photo de profil" hint="Facultative. Visible seulement par les personnes qui voient déjà votre prénom : vos contacts et les participants de vos événements, jamais une personne bloquée.">
          <div className="inline">
            <Avatar name={me.display_name} seed={me.id} size="lg" />
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              aria-label="Choisir une photo de profil"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (file) void changePhoto(file);
              }}
            />
            <Button variant="secondary" loading={photoBusy} onClick={() => photoInput.current?.click()}>
              {me.avatar_photo ? 'Changer la photo' : 'Ajouter une photo'}
            </Button>
            {me.avatar_photo && (
              <Button variant="ghost" disabled={photoBusy} onClick={() => void changePhoto(null)}>
                Retirer
              </Button>
            )}
          </div>
        </Field>
        <Field label="Prénom affiché" htmlFor="s-name" hint="Visible par vos contacts et les participants de vos événements.">
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
          {/* Adresse longue : raccourcie (« … ») pour ne jamais élargir la page sur un téléphone. */}
          <div className="inline" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
            <span
              className="input"
              title={email}
              style={{ display: 'block', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'var(--surface-2)' }}
            >
              {email}
            </span>
            <span style={{ flexShrink: 0 }}>
              <Button variant="secondary" icon={<Mail />} onClick={() => setChangingEmail(true)}>
                Changer
              </Button>
            </span>
          </div>
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

      <MfaSection admin={me.is_admin} />

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
        <Check
          checked={Boolean(prefs.maturity_alerts)}
          onChange={(maturity_alerts) => void savePrefs({ maturity_alerts })}
          label="M’alerter quand un vin de ma cave entre dans sa période de dégustation (et l’année où elle se termine)"
          hint="Seulement pour les vins dont la fiche indique une période (la vôtre, une source ou une estimation de Lia) ; l’alerte précise laquelle. Une fois par an et par vin, dans les notifications et sur vos appareils si vous les avez activés."
        />
        <Check checked={Boolean(prefs.advanced)} onChange={(advanced) => void savePrefs({ advanced })} label="Ouvrir d’emblée les champs avancés des formulaires" hint="Pour les amateurs qui renseignent tout (domaine, cépages, conseils…)." />
      </section>

      <section className="card form" aria-labelledby="h-display">
        <h2 id="h-display" className="section">
          Affichage
        </h2>
        <Segmented<Theme>
          label="Apparence"
          options={THEMES}
          value={prefs.theme ?? DEFAULT_THEME}
          onChange={(theme) => {
            applyTheme(theme, { remember: true, animate: true });
            void savePrefs({ theme });
          }}
        />
        <Check
          checked={showShared}
          onChange={async (v) => {
            setShowShared(v);
            const res = await run(() => api.setShowSharedWines(me.id, v), { success: 'Préférence enregistrée' });
            if (!res.ok) setShowShared(!v);
          }}
          label="Afficher « Bouteilles partagées par mes amis »"
          hint="Dans Amis & Groupes, la liste des bouteilles que vos amis vous montrent."
        />
      </section>

      <section className="card stack-sm" aria-labelledby="h-tour">
        <h2 id="h-tour" className="section">
          Visite guidée et aide
        </h2>
        <p className="small muted">
          La visite montre les principaux boutons en une minute. À tout moment, le bouton « ? » en haut de l’écran ouvre l’aide de la page.
        </p>
        <div className="inline">
          <Button
            icon={<Compass />}
            onClick={() => {
              go('/', { replace: true });
              tour.start(0);
            }}
          >
            Revoir la visite guidée
          </Button>
          <Button
            variant="secondary"
            icon={<Lightbulb />}
            onClick={() => {
              tour.resetTips();
              toast('Les astuces réapparaîtront à votre prochaine visite de chaque page.', { tone: 'info' });
            }}
          >
            Réafficher les astuces
          </Button>
        </div>
      </section>

      <NousSection />

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
        <a className="row" href="#/reglages/confidentialite">
          <LockKeyhole aria-hidden style={{ color: 'var(--primary)' }} />
          <span className="row-main">
            <span className="row-title">Confidentialité et mes données</span>
            <span className="row-sub">Télécharger toutes mes données, mes choix, documents acceptés, durées de conservation</span>
          </span>
          <ChevronRight aria-hidden />
        </a>
        {me.is_admin && (
          <a className="row" href="#/admin">
            <Shield aria-hidden style={{ color: 'var(--gold-ink)' }} />
            <span className="row-main">
              <span className="row-title">Administration</span>
              <span className="row-sub">Documents légaux ; assistant IA : clé, modèle, quotas, budget, consommation</span>
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
        <p className="small faint">
          Vos conversations avec l’assistant ne sont montrées ni à vos amis ni dans l’écran d’administration. Pour vous répondre, Lia les transmet à Claude,
          l’intelligence artificielle de la société Anthropic (États-Unis) ; elles sont effacées 12 mois après le dernier message.
        </p>
      </section>

      <PushSettings />

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
          prix, la quantité exacte et vos notes. Il n’existe pas de cave publique : seules les personnes à qui vous ouvrez votre cave voient ce que vous y
          partagez. Être en contact ne donne accès à aucune bouteille ; fermer votre cave à quelqu’un lui retire immédiatement cet accès.
        </p>
        <a className="row" href="#/reglages/acces" style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
          <Eye aria-hidden style={{ color: 'var(--primary)' }} />
          <span className="row-main">
            <span className="row-title">Qui voit ma cave</span>
            <span className="row-sub">
              {openTo === 0 ? 'Personne' : `${openTo} personne${openTo > 1 ? 's' : ''}`} sur {snapshot.relations.length} relation{snapshot.relations.length > 1 ? 's' : ''}
            </span>
          </span>
          <ChevronRight aria-hidden />
        </a>
        <Check
          checked={discoverable}
          onChange={async (v) => {
            setDiscoverable(v);
            const res = await run(() => api.setDiscoverable(me.id, v), { success: v ? 'Vous apparaissez dans la recherche' : 'Vous n’apparaissez plus dans la recherche' });
            if (!res.ok) setDiscoverable(!v);
          }}
          label="Apparaître dans la recherche d’amis"
          hint="Les autres membres pourront trouver votre nom et vous envoyer une demande d’ami. Ils ne voient rien d’autre, et vous acceptez ou refusez chaque demande."
        />
        {snapshot.blocks.length > 0 && (
          <>
            <p className="strong small" style={{ marginTop: 6 }}>
              Personnes bloquées
            </p>
            <div className="list">
              {snapshot.blocks.map((b) => (
                <div key={b.blocked_id} className="row static">
                  <span className="row-main">
                    <span className="row-title">{b.display_name}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void run(() => api.unblockUser(b.blocked_id), { success: `${b.display_name} est débloqué` })}>
                    Débloquer
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
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
      <Button
        variant="secondary"
        icon={<MonitorSmartphone />}
        onClick={async () => {
          const ok = await confirm({
            title: 'Déconnecter tous vos appareils ?',
            message:
              'Téléphone, tablette, ordinateur : vos sessions se ferment partout, celle-ci comprise, et plus aucun appareil ne reçoit vos notifications. Sur un autre appareil, la session se ferme dès que l’application y est rouverte (au plus tard au bout d’une heure).',
            confirmLabel: 'Tout déconnecter',
          });
          if (ok) await run(() => api.signOutEverywhere(), { success: 'Tous vos appareils sont déconnectés.', reload: false });
        }}
      >
        Déconnecter tous mes appareils
      </Button>
      <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
        Supprimer mon compte
      </Button>
      <p className="small faint center">Cave &amp; Amis — votre cave, vos amis, la bonne bouteille au bon moment.</p>
      <LegalLinks />

      {password && <PasswordSheet onClose={() => setPassword(false)} />}
      {changingEmail && <EmailSheet current={email} onClose={() => setChangingEmail(false)} />}
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

/**
 * Changer d'adresse e-mail : un lien part à l'adresse actuelle et un à la nouvelle ; le changement se fait quand les deux
 * sont ouverts (une session volée ne suffit pas, il faut aussi la boîte mail actuelle). Rien ne change d'ici là.
 */
function EmailSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const { api } = useStore();
  const [next, setNext] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.pendingEmail().then(setPending, () => undefined);
  }, [api]);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.trim()) && next.trim().toLowerCase() !== current.toLowerCase();
  return (
    <Sheet
      open
      onClose={onClose}
      title="Changer d’adresse e-mail"
      footer={
        sent ? (
          <Button onClick={onClose}>Fermer</Button>
        ) : (
          <Button
            disabled={!valid}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.changeEmail(next);
                setPending(next.trim());
                setSent(true);
              } catch (e) {
                setError(toMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Recevoir les liens
          </Button>
        )
      }
    >
      <div className="form">
        {sent ? (
          <Notice tone="success">
            Deux e-mails viennent de partir : l’un à {current}, l’autre à {pending}. Ouvrez le lien de chacun, sur n’importe quel appareil : votre adresse change
            quand les deux sont ouverts. Pensez à regarder dans les indésirables.
          </Notice>
        ) : (
          <>
            <p className="small">
              Adresse actuelle : <strong>{current}</strong>. Pour la changer, un lien est envoyé à cette adresse et un autre à la nouvelle : il faudra ouvrir les deux.
            </p>
            {pending && <Notice tone="info">Un changement vers {pending} attend encore vos confirmations. Une nouvelle demande le remplace.</Notice>}
            <Field label="Nouvelle adresse e-mail" htmlFor="new-email" error={error ?? undefined}>
              <input id="new-email" className="input" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} data-autofocus />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Changer de mot de passe : l'actuel est redemandé (une session restée ouverte ne suffit pas). */
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { api, run } = useStore();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const problem = pw ? passwordProblem(pw) : null;
  // La vérification de l'actuel est une connexion : avec une clé Turnstile, elle passe aussi le contrôle anti-robots.
  const captcha = useCaptcha(api.captchaSiteKey);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Nouveau mot de passe"
      footer={
        <Button
          disabled={!current || !pw || Boolean(problem)}
          onClick={async () => {
            const res = await run(
              async () => {
                await api.verifyPassword(current, captcha.take());
                await api.updatePassword(pw, current);
              },
              { success: 'Mot de passe changé', reload: false },
            );
            if (res.ok) onClose();
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <div className="form">
        <Field label="Mot de passe actuel" htmlFor="pw-current">
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-autofocus />
        </Field>
        <Field label="Nouveau mot de passe" htmlFor="pw-new" hint={PASSWORD_HINT} error={problem ?? undefined}>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {captcha.view}
      </div>
    </Sheet>
  );
}
