import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, ExternalLink, Link2, Unlink } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateLong, todayIso } from '../../domain/format';
import { Button, Check, Notice, useConfirm, useToast } from '../../ui/kit';

/** allow_jump : « Voir dans Cave & Amis » depuis Nous connecte sans mot de passe (désactivé par défaut). */
type NousLink = { nous_display_name: string | null; sync_enabled: boolean; allow_jump: boolean; linked_at: string };
type NousState = { loaded: boolean; enabled: boolean; link: NousLink | null; failure: string | null };

/** État de la liaison avec l'agenda Nous (lu par la fonction serveur). */
export function useNousStatus() {
  const { api } = useStore();
  const [state, setState] = useState<NousState>({ loaded: false, enabled: false, link: null, failure: null });
  const refresh = useCallback(async () => {
    const r = await api.ai('nous_status');
    if (r.ok) setState({ loaded: true, enabled: Boolean(r.enabled), link: (r.link as NousLink | null) ?? null, failure: null });
    else setState({ loaded: true, enabled: false, link: null, failure: r.code === 'ai_not_configured' ? null : r.message });
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { ...state, refresh };
}

/** Ouvre l'agenda Nous déjà connecté (lien à usage unique), ou simplement le site en cas d'échec. */
export async function openNous(api: ReturnType<typeof useStore>['api'], next?: string, fallback = 'https://cocon-famille.netlify.app/') {
  const r = await api.ai('nous_jump', next ? { next } : {});
  window.location.assign(r.ok ? String(r.url) : fallback);
}

/** Sur la fiche d'un événement : accès à l'agenda Nous, ou proposition discrète de l'activer. */
export function NousEventLink({ startsAt }: { startsAt: string }) {
  const { api } = useStore();
  const nous = useNousStatus();
  const [busy, setBusy] = useState(false);
  if (!nous.loaded || !nous.enabled) return null;
  if (!nous.link)
    return (
      <p className="small faint">
        Retrouvez vos événements dans votre agenda : <a href="#/reglages">activer l’agenda Nous gratuitement</a>.
      </p>
    );
  if (!nous.link.sync_enabled) return null;
  return (
    <div className="inline">
      <Button
        size="sm"
        variant="ghost"
        icon={<CalendarCheck />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await openNous(api, `#/agenda?date=${todayIso(new Date(startsAt))}`).finally(() => setBusy(false));
        }}
      >
        Voir dans mon agenda Nous
      </Button>
    </div>
  );
}

export function NousSection() {
  const { api, me } = useStore();
  const nous = useNousStatus();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(name: string, work: () => Promise<{ ok: boolean; message?: string } & Record<string, unknown>>, done?: (r: Record<string, unknown>) => void) {
    setBusy(name);
    setError(null);
    try {
      const r = await work();
      if (!r.ok) setError(String(r.message ?? 'Une erreur est survenue.'));
      else done?.(r);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack-sm" aria-labelledby="h-nous">
      <div className="inline">
        <CalendarCheck aria-hidden style={{ color: 'var(--primary)' }} />
        <h2 id="h-nous" className="section">
          Agenda Nous
        </h2>
      </div>
      {!nous.loaded ? (
        <span className="muted small">Vérification…</span>
      ) : nous.failure ? (
        <Notice tone="warn">{nous.failure}</Notice>
      ) : !nous.enabled ? (
        <p className="small muted">La connexion avec l’agenda Nous n’est pas encore activée sur ce serveur.</p>
      ) : nous.link ? (
        <>
          <p className="small">
            Relié à l’agenda Nous{nous.link.nous_display_name ? ` de ${nous.link.nous_display_name}` : ''} depuis le {dateLong(nous.link.linked_at)}. Vos dîners
            et dégustations y apparaissent automatiquement, avec votre réponse, le lieu et les bouteilles prévues ; vous pouvez y répondre aux invitations.
          </p>
          <Check
            checked={nous.link.sync_enabled}
            onChange={(enabled) =>
              void act(
                'sync',
                () => api.ai('nous_set_sync', { enabled }),
                () => {
                  toast(enabled ? 'Synchronisation reprise' : 'Synchronisation suspendue');
                  void nous.refresh();
                },
              )
            }
            label="Envoyer mes événements vers mon agenda Nous"
            hint="Décocher suspend les envois ; les événements déjà dans Nous y restent."
          />
          {/* Jamais proposé à l'administrateur (la base et le serveur le refusent aussi). */}
          {me.is_admin ? (
            <p className="small faint">Compte administrateur : par sécurité, Cave &amp; Amis ne s’ouvre jamais depuis Nous sans mot de passe.</p>
          ) : (
            <Check
              checked={nous.link.allow_jump === true}
              onChange={async (enabled) => {
                // Activer : le risque est expliqué et confirmé d'abord.
                if (
                  enabled &&
                  !(await confirm({
                    title: 'Ouvrir Cave & Amis depuis Nous sans mot de passe ?',
                    message:
                      'Quiconque accède à votre compte Nous (téléphone prêté, mot de passe deviné…) pourra alors ouvrir votre compte Cave & Amis. Vous pourrez désactiver cette option à tout moment.',
                    confirmLabel: 'Activer',
                  }))
                )
                  return;
                void act(
                  'jump',
                  () => api.ai('nous_set_jump', { enabled }),
                  () => {
                    toast(enabled ? 'Ouverture depuis Nous sans mot de passe activée' : 'Ouverture depuis Nous sans mot de passe désactivée');
                    void nous.refresh();
                  },
                );
              }}
              label="Ouvrir Cave & Amis depuis Nous sans mot de passe"
              hint="Désactivé par défaut : depuis Nous, vous vous connectez à Cave & Amis comme d’habitude. Si vous l’activez, quiconque accède à votre compte Nous pourrait aussi ouvrir votre compte Cave & Amis."
            />
          )}
          <div className="inline">
            <Button variant="secondary" icon={<ExternalLink />} loading={busy === 'open'} onClick={() => void act('open', async () => (await openNous(api, '#/agenda'), { ok: true }))}>
              Ouvrir mon agenda Nous
            </Button>
            <Button
              variant="danger-ghost"
              icon={<Unlink />}
              loading={busy === 'unlink'}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Délier l’agenda Nous ?',
                  message: 'Vos événements Cave & Amis seront retirés de votre agenda Nous (mis à sa corbeille). Rien ne change dans Cave & Amis ; vous pourrez relier les comptes plus tard.',
                  confirmLabel: 'Délier',
                  danger: true,
                });
                if (ok)
                  void act(
                    'unlink',
                    () => api.ai('nous_unlink'),
                    () => {
                      toast('Agenda Nous délié');
                      void nous.refresh();
                    },
                  );
              }}
            >
              Délier
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="small">
            Retrouvez automatiquement vos dîners et dégustations dans <strong>Nous</strong>, l’agenda partagé gratuit : date, lieu, invités, bouteilles prévues, et
            mises à jour en cas de changement ou d’annulation. Vous avez déjà un compte Nous ? Vous pourrez le relier ; sinon, l’inscription est pré-remplie.
          </p>
          <p className="small faint">
            Seuls vos événements partent vers votre agenda, jamais votre cave ni vos prix. Vous pouvez délier les comptes à tout moment, depuis l’une ou l’autre
            application.
          </p>
          <Button
            variant="gold"
            icon={<Link2 />}
            loading={busy === 'link'}
            onClick={() => void act('link', () => api.ai('nous_link_start'), (r) => window.location.assign(String(r.url)))}
          >
            Activer mon agenda Nous gratuitement
          </Button>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
