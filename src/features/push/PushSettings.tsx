/**
 * Notifications push : les activer sur cet appareil (Réglages, et proposition sur la page Notifications), envoyer un
 * essai, voir et retirer mes appareils. Sur iPhone et iPad, l'application doit d'abord être sur l'écran d'accueil.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Smartphone, Trash2 } from 'lucide-react';
import type { PushDevice } from '../../data/api';
import { useStore } from '../../data/store';
import { currentSubscription, deviceLabel, PushDenied, pushPermission, pushSupport, subscribeDevice, unsubscribeDevice } from '../../data/pushDevice';
import { toMessage } from '../../domain/errors';
import { dateLong } from '../../domain/format';
import { Button, Notice, useToast } from '../../ui/kit';

const IOS_HINT =
  'Sur iPhone et iPad : ajoutez d’abord Cave & Amis à l’écran d’accueil (bouton Partager, puis « Sur l’écran d’accueil »), ouvrez-la depuis son icône, puis revenez ici. Il faut iOS 16.4 ou plus récent.';
const DENIED_HINT =
  'Les notifications sont bloquées pour Cave & Amis sur cet appareil. Autorisez-les dans les réglages du navigateur (sur iPhone : Réglages › Notifications › Cave & Amis), puis revenez ici.';
const UNSUPPORTED = {
  'ios-install': IOS_HINT,
  insecure: 'Les notifications demandent une connexion sécurisée (https).',
  unsupported: 'Ce navigateur ne permet pas les notifications push. Sur Android, utilisez Chrome, Edge, Firefox ou Samsung Internet.',
};

/** Mes appareils, et l'abonnement de celui-ci : actif s'il est connu du serveur pour mon compte. */
function usePushState() {
  const { api } = useStore();
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const [list, sub] = await Promise.all([api.myPushDevices().catch(() => [] as PushDevice[]), currentSubscription().catch(() => null)]);
    setDevices(list);
    setEndpoint(sub?.endpoint ?? null);
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    devices,
    endpoint,
    refresh,
    loaded: devices !== null && endpoint !== undefined,
    active: Boolean(endpoint && devices?.some((d) => d.endpoint === endpoint)),
  };
}

/** Activation depuis un bouton : l'autorisation est demandée d'abord (exigé sur iPhone), puis l'appareil est abonné. */
function useEnable(refresh: () => Promise<void>) {
  const { api } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      const device = await subscribeDevice(api.pushKey());
      await api.pushSubscribe(device, deviceLabel());
      toast('Notifications activées sur cet appareil');
    } catch (e) {
      toast(e instanceof PushDenied ? DENIED_HINT : toMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
      await refresh();
    }
  }
  return { enable, busy };
}

export function PushSettings() {
  const { api, run } = useStore();
  const toast = useToast();
  const support = pushSupport();
  const state = usePushState();
  const { enable, busy } = useEnable(state.refresh);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    const res = await run(() => api.pushTest(), { reload: false });
    setTesting(false);
    if (res.ok) {
      const n = res.value.sent;
      toast(n ? `Notification d’essai envoyée (${n} appareil${n > 1 ? 's' : ''}).` : 'Aucun appareil n’a pu la recevoir.', { tone: n ? 'info' : 'error' });
    }
    await state.refresh();
  }

  async function remove(d: PushDevice) {
    if (d.endpoint === state.endpoint) await unsubscribeDevice();
    await run(() => api.removePushDevice(d.id), { success: 'Appareil retiré', reload: false });
    await state.refresh();
  }

  return (
    <section className="card stack-sm" aria-labelledby="h-push">
      <div className="inline">
        <BellRing aria-hidden style={{ color: 'var(--primary)' }} />
        <h2 id="h-push" className="section">
          Notifications sur cet appareil
        </h2>
      </div>
      <p className="small">
        Recevez ici, même application fermée, les demandes de contact, les invitations (événement, groupe, cave à plusieurs), l’arrivée d’une
        personne invitée et les caves qui vous sont ouvertes.
      </p>
      {!support.ok ? (
        <Notice tone="info">{UNSUPPORTED[support.reason]}</Notice>
      ) : pushPermission() === 'denied' ? (
        <Notice tone="warn">{DENIED_HINT}</Notice>
      ) : !state.loaded ? (
        <span className="muted small">Vérification…</span>
      ) : state.active ? (
        <>
          <p className="small strong">Activées sur cet appareil.</p>
          <div className="inline">
            <Button size="sm" variant="secondary" icon={<Bell />} loading={testing} onClick={() => void test()}>
              Envoyer une notification d’essai
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<BellOff />}
              onClick={async () => {
                const endpoint = await unsubscribeDevice();
                if (endpoint) await run(() => api.removePushEndpoint(endpoint), { success: 'Notifications désactivées sur cet appareil', reload: false });
                await state.refresh();
              }}
            >
              Désactiver sur cet appareil
            </Button>
          </div>
        </>
      ) : (
        <Button icon={<BellRing />} loading={busy} onClick={() => void enable()}>
          Activer les notifications sur cet appareil
        </Button>
      )}
      {state.devices && state.devices.length > 0 && (
        <div className="stack-sm">
          <h3 className="small strong">Vos appareils</h3>
          <div className="list">
            {state.devices.map((d) => (
              <div key={d.id} className="row static">
                <Smartphone aria-hidden style={{ flex: 'none' }} />
                <span className="row-main">
                  <span className="row-title" style={{ whiteSpace: 'normal' }}>
                    {d.label ?? 'Appareil'}
                    {d.endpoint === state.endpoint ? ' (cet appareil)' : ''}
                  </span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    Depuis le {dateLong(d.created_at)}
                    {d.last_success_at ? ` · dernière notification le ${dateLong(d.last_success_at)}` : ''}
                  </span>
                </span>
                <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Retirer ${d.label ?? 'cet appareil'}`} onClick={() => void remove(d)}>
                  Retirer
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="small faint">Le contenu est chiffré pour vos appareils : le service de notifications d’Apple, de Google, de Mozilla ou de Microsoft le transmet sans pouvoir le lire.</p>
    </section>
  );
}

/** Proposition sur la page Notifications : activer sur cet appareil (ou, sur iPhone, l'ajouter d'abord à l'écran d'accueil). */
export function PushOffer() {
  const support = pushSupport();
  const state = usePushState();
  const { enable, busy } = useEnable(state.refresh);
  if (!support.ok) {
    return support.reason === 'ios-install' ? (
      <p className="small muted">
        Pour recevoir ces notifications sur votre iPhone, ajoutez Cave & Amis à l’écran d’accueil (Partager › « Sur l’écran d’accueil »), puis activez-les dans
        les Réglages de l’application.
      </p>
    ) : null;
  }
  if (pushPermission() === 'denied' || !state.loaded || state.active) return null;
  return (
    <section className="card soft stack-sm" aria-labelledby="h-push-offer">
      <div className="inline">
        <BellRing aria-hidden style={{ color: 'var(--primary)' }} />
        <strong id="h-push-offer">Recevez-les aussi sur cet appareil</strong>
      </div>
      <p className="small">Même application fermée : demandes, invitations et caves qui vous sont ouvertes.</p>
      <Button size="sm" icon={<BellRing />} loading={busy} onClick={() => void enable()}>
        Activer les notifications
      </Button>
    </section>
  );
}
