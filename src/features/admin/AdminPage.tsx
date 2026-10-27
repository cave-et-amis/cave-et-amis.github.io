/**
 * Administration de l'assistant : état de la clé (jamais affichée), modèle, activation, quotas, budget,
 * consommation globale et par personne, erreurs techniques (sans contenu des conversations).
 */
import { useCallback, useEffect, useState } from 'react';
import { PlugZap, RefreshCw, Save } from 'lucide-react';
import type { AdminOverview } from '../../data/api';
import { useStore } from '../../data/store';
import { dateShort } from '../../domain/format';
import { parseNumber } from '../../domain/format';
import { Button, Check, Field, InlineLoading, Notice, Sheet } from '../../ui/kit';

type Settings = AdminOverview['settings'];
type TestResult = {
  key_present: boolean;
  key_status: string;
  models?: { id: string; display_name: string }[];
  error?: string;
  test?: { ok: boolean; latency_ms?: number; model?: string; text?: string; input_tokens?: number; output_tokens?: number; error?: string };
};

const usd = (n: number) => `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
const KEY_TEXT: Record<string, string> = {
  ok: 'Clé valide (dernier test réussi)',
  missing: 'Aucune clé configurée sur le serveur',
  invalid: 'Clé refusée par Anthropic',
  unknown: 'Pas encore testée',
};

export function AdminPage() {
  const { api, run } = useStore();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [prices, setPrices] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [userSheet, setUserSheet] = useState<AdminOverview['users'][number] | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.adminOverview();
      setData(d);
      setDraft({});
      setPrices(JSON.stringify(d.settings.prices, null, 2));
      setError(null);
    } catch {
      setError('Impossible de charger l’administration.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <InlineLoading />;
  const s = { ...data.settings, ...draft } as Settings;
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (k: keyof Settings) => ({
    value: String(s[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: parseNumber(e.target.value) ?? 0 } as Partial<Settings>),
    inputMode: 'decimal' as const,
    className: 'input',
  });
  const spent = Number(data.month.cost_usd) + Number(data.month.reserved_usd);
  const pct = data.budget_pct;
  const models = (test?.models?.length ? test.models : s.available_models) ?? [];
  const priceKnown = Boolean(s.prices?.[s.model]);

  async function save() {
    let parsedPrices: unknown;
    try {
      parsedPrices = JSON.parse(prices);
    } catch {
      setError('Le tableau des tarifs n’est pas un JSON valable.');
      return;
    }
    const res = await run(() => api.adminUpdateSettings({ ...draft, prices: parsedPrices }), { success: 'Réglages enregistrés', reload: false });
    if (res.ok) await load();
  }

  return (
    <>
      <section className="card stack-sm" aria-labelledby="h-key">
        <h2 id="h-key" className="section">
          Clé Anthropic
        </h2>
        <p>
          <strong>{KEY_TEXT[data.settings.key_status] ?? data.settings.key_status}</strong>
          {data.settings.key_checked_at ? <span className="small muted"> — vérifié le {dateShort(data.settings.key_checked_at)}</span> : null}
        </p>
        <p className="small muted">
          La clé n’est jamais affichée ni envoyée au navigateur. Elle se règle uniquement côté serveur : tableau de bord Supabase › Edge Functions › Secrets ›
          variable <code>ANTHROPIC_API_KEY</code> (voir docs/INSTALLATION.md).
        </p>
        <Button
          icon={<PlugZap />}
          loading={testing}
          onClick={async () => {
            setTesting(true);
            const res = await api.ai('admin_test');
            setTesting(false);
            setTest(res.ok ? (res as unknown as TestResult) : { key_present: false, key_status: 'unknown', error: res.message });
            void load();
          }}
        >
          Tester la connexion
        </Button>
        {test && (
          <Notice tone={test.key_status === 'ok' && test.test?.ok !== false ? 'success' : 'warn'}>
            {!test.key_present
              ? 'Aucune clé ANTHROPIC_API_KEY n’est configurée sur le serveur : l’assistant est désactivé, le reste de l’application fonctionne.'
              : test.error
                ? `Échec : ${test.error}`
                : test.test?.ok
                  ? `Connexion réussie : ${test.models?.length ?? 0} modèle(s) disponible(s). Appel de test sur ${test.test.model} en ${test.test.latency_ms} ms (${test.test.input_tokens} jetons envoyés, ${test.test.output_tokens} reçus).`
                  : `Clé valide, mais l’appel de test a échoué : ${test.test?.error ?? 'erreur inconnue'}`}
          </Notice>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="h-usage">
        <div className="between">
          <h2 id="h-usage" className="section">
            Consommation du mois
          </h2>
          <button type="button" className="icon-btn" aria-label="Actualiser" onClick={() => void load()}>
            <RefreshCw />
          </button>
        </div>
        <div className={`meter ${pct >= 100 ? 'danger' : pct >= data.settings.alert_pct ? 'warn' : ''}`} role="img" aria-label={`${pct} % du budget`}>
          <span style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p>
          <strong>{usd(spent)}</strong> sur {usd(data.settings.monthly_budget_usd)} ({pct} %)
          {Number(data.month.reserved_usd) > 0 ? <span className="small muted"> — dont {usd(Number(data.month.reserved_usd))} réservés par {data.month.in_flight} demande(s) en cours</span> : null}
        </p>
        {pct >= 100 ? (
          <Notice tone="danger">Budget atteint : les nouveaux appels sont bloqués jusqu’au mois prochain ou jusqu’à une hausse du budget.</Notice>
        ) : pct >= data.settings.alert_pct ? (
          <Notice tone="warn">Alerte : plus de {data.settings.alert_pct} % du budget mensuel est consommé.</Notice>
        ) : null}
        <div className="tiles">
          <div className="tile">
            <span className="value">{data.month.requests}</span>
            <span className="label">demandes</span>
          </div>
          <div className="tile">
            <span className="value">{data.month.failed}</span>
            <span className="label">en échec</span>
          </div>
          <div className="tile">
            <span className="value">{Math.round((data.month.input_tokens + data.month.output_tokens) / 1000)} k</span>
            <span className="label">jetons (entrée + sortie)</span>
          </div>
          <div className="tile">
            <span className="value">{data.month.web_searches}</span>
            <span className="label">recherches web</span>
          </div>
        </div>
        <p className="small faint">
          Estimation d’après les tarifs ci-dessous et l’usage renvoyé par l’API ; la facture Anthropic fait foi. Avant chaque appel, l’enveloppe maximale est
          réservée (jetons envoyés estimés largement, réponse au maximum autorisé, recherches web plafonnées), puis remplacée par le coût réel. Limite connue :
          le volume des pages lues par la recherche web n’est pas bornable exactement ; une provision par recherche est réservée, ce n’est pas un plafond strict.
        </p>
        {data.days.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Jour</th>
                  <th>Demandes</th>
                  <th>Coût estimé</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td>{dateShort(d.day)}</td>
                    <td>{d.requests}</td>
                    <td>{usd(d.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card form" aria-labelledby="h-settings">
        <h2 id="h-settings" className="section">
          Réglages de l’assistant
        </h2>
        <Check checked={s.enabled} onChange={(enabled) => set({ enabled })} label="Assistant activé" hint="Désactivé : aucun appel à Claude ; tout le reste fonctionne." />
        <Field label="Modèle" hint={models.length ? 'Liste fournie par Anthropic lors du dernier test de connexion.' : 'Testez la connexion pour obtenir la liste des modèles disponibles.'}>
          {models.length ? (
            <select className="input" value={s.model} onChange={(e) => set({ model: e.target.value })}>
              {!models.some((m) => m.id === s.model) && <option value={s.model}>{s.model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} ({m.id})
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={s.model} onChange={(e) => set({ model: e.target.value.trim() })} />
          )}
        </Field>
        {!priceKnown && <Notice tone="danger">Aucun tarif n’est renseigné pour {s.model} : les appels seront refusés tant qu’il manque (coût impossible à borner).</Notice>}
        <Field label="Effort de réflexion" hint="Plus d’effort : réponses plus soignées, plus lentes et plus coûteuses.">
          <select className="input" value={s.effort} onChange={(e) => set({ effort: e.target.value as Settings['effort'] })}>
            <option value="low">Faible</option>
            <option value="medium">Moyen (conseillé)</option>
            <option value="high">Élevé</option>
          </select>
        </Field>
        <div className="field-row">
          <Field label="Budget mensuel ($)">
            <input {...num('monthly_budget_usd')} />
          </Field>
          <Field label="Alerte à (% du budget)">
            <input {...num('alert_pct')} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Demandes par jour et par personne">
            <input {...num('default_daily_requests')} />
          </Field>
          <Field label="Budget mensuel par personne ($)">
            <input {...num('default_monthly_user_usd')} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Demandes par minute (par personne)">
            <input {...num('rate_per_minute')} />
          </Field>
          <Field label="Demandes simultanées (par personne)">
            <input {...num('max_concurrent_per_user')} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Longueur max. d’un message (caractères)">
            <input {...num('max_input_chars')} />
          </Field>
          <Field label="Taille max. d’une photo (octets)">
            <input {...num('max_image_bytes')} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Longueur max. d’une réponse (jetons)">
            <input {...num('max_output_tokens')} />
          </Field>
          <Field label="Appels à Claude par demande">
            <input {...num('max_api_calls')} />
          </Field>
        </div>
        <Field label="Messages d’historique renvoyés à chaque question">
          <input {...num('history_messages')} />
        </Field>
        <Check checked={s.web_search_enabled} onChange={(web_search_enabled) => set({ web_search_enabled })} label="Recherche web des prix activée" hint="Nécessaire pour des prix de marché sourcés ; sinon « prix non vérifié »." />
        <div className="field-row">
          <Field label="Recherches web par demande">
            <input {...num('max_web_searches')} />
          </Field>
          <Field label="Provision de jetons par recherche">
            <input {...num('web_search_token_allowance')} />
          </Field>
        </div>
        <Field label="Prix de la recherche web ($ pour 1 000)">
          <input {...num('web_search_price_per_1000')} />
        </Field>
        <h3 className="section">Scanner avant d’acheter</h3>
        <Field
          label="Modèle du scanner et de la lecture d’étiquette"
          hint="Sert aussi à lire une étiquette et à chercher le prix depuis une fiche (la conversation avec Lia garde le modèle de l’assistant). Vide : le même modèle que l’assistant. Sonnet 5.5 coûte environ deux fois moins qu’Opus 5.5."
        >
          <input className="input" value={s.scan_model ?? ''} onChange={(e) => set({ scan_model: e.target.value.trim() || null })} placeholder={s.model} />
        </Field>
        {s.scan_model && !s.prices?.[s.scan_model] && !prices.includes(`"${s.scan_model}"`) && (
          <Notice tone="danger">Aucun tarif n’est renseigné pour {s.scan_model} : les analyses seront refusées tant qu’il manque.</Notice>
        )}
        <div className="field-row">
          <Field label="Analyses par jour et par personne" hint="Une lecture reprise du cache (mêmes photos) n’est pas comptée.">
            <input {...num('scan_daily_limit')} />
          </Field>
          <Field label="Conservation des analyses (jours)" hint="Ensuite, analyses et photos sont supprimées.">
            <input {...num('scan_retention_days')} />
          </Field>
        </div>
        <Field label="Tarifs des modèles ($ par million de jetons)" hint="input, output, cache_write, cache_read — d’après la page Pricing d’Anthropic. À mettre à jour si les tarifs changent.">
          <textarea className="input" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.85rem', minHeight: 180 }} value={prices} onChange={(e) => setPrices(e.target.value)} />
        </Field>
        <Button icon={<Save />} onClick={() => void save()}>
          Enregistrer les réglages
        </Button>
      </section>

      <section aria-labelledby="h-users">
        <div className="section-title">
          <h2 id="h-users">Utilisateurs et quotas</h2>
        </div>
        <div className="list">
          {data.users.map((u) => (
            <button key={u.user_id} type="button" className="row" onClick={() => setUserSheet(u)}>
              <span className="row-main">
                <span className="row-title">
                  {u.display_name}
                  {u.is_admin ? ' (admin)' : ''}
                </span>
                <span className="row-sub">{u.email}</span>
                <span className="small muted">
                  Aujourd’hui {u.requests_today}/{u.daily_limit} · mois {usd(u.month_cost_usd)} / {usd(u.monthly_limit_usd)} ({u.month_requests} demandes)
                  {u.custom ? ' · quota personnalisé' : ''}
                </span>
              </span>
              {u.blocked && <span className="pill danger">Bloqué</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="h-errors">
        <h2 id="h-errors" className="section">
          Erreurs techniques récentes
        </h2>
        <p className="small faint">Sans secret ni contenu de conversation.</p>
        {data.errors.length === 0 ? (
          <p className="muted small">Aucune erreur.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Code</th>
                  <th>Détail</th>
                  <th>Action</th>
                  <th>Personne</th>
                </tr>
              </thead>
              <tbody>
                {data.errors.map((e, i) => (
                  <tr key={i}>
                    <td>{new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{e.code}</td>
                    <td>{e.detail}</td>
                    <td>{e.action}</td>
                    <td>{e.user_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {userSheet && (
        <LimitsSheet
          user={userSheet}
          onClose={() => setUserSheet(null)}
          onSaved={async () => {
            setUserSheet(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function LimitsSheet({ user, onClose, onSaved }: { user: AdminOverview['users'][number]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api, run } = useStore();
  const [daily, setDaily] = useState(String(user.daily_limit));
  const [monthly, setMonthly] = useState(String(user.monthly_limit_usd));
  const [blocked, setBlocked] = useState(user.blocked);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Quota de ${user.display_name}`}
      footer={
        <>
          {user.custom && (
            <Button
              variant="secondary"
              onClick={async () => {
                const r = await run(() => api.adminSetLimits(user.user_id, null, null, false, true), { success: 'Quota par défaut rétabli', reload: false });
                if (r.ok) await onSaved();
              }}
            >
              Revenir au défaut
            </Button>
          )}
          <Button
            onClick={async () => {
              const r = await run(() => api.adminSetLimits(user.user_id, parseNumber(daily), parseNumber(monthly), blocked), { success: 'Quota enregistré', reload: false });
              if (r.ok) await onSaved();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="form">
        <Field label="Demandes par jour" htmlFor="q-daily">
          <input id="q-daily" className="input" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </Field>
        <Field label="Budget mensuel ($)" htmlFor="q-monthly">
          <input id="q-monthly" className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Check checked={blocked} onChange={setBlocked} label="Bloquer l’accès à l’assistant" hint="La personne continue d’utiliser tout le reste de l’application." />
      </div>
    </Sheet>
  );
}
