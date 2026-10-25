/**
 * Assistant sommelier : conversation avec Claude (via le serveur). Il lit vos données avec vos droits,
 * propose des actions que vous confirmez vous-même, et cite ses sources pour les prix.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, MessageSquarePlus, ScanSearch, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { AiMessage, Conversation } from '../../data/api';
import { useStore } from '../../data/store';
import { dateShort, todayIso } from '../../domain/format';
import { wineTitle } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Markdown } from '../../ui/markdown';
import { Button, EmptyState, InlineLoading, Notice, useConfirm } from '../../ui/kit';
import { go, routeQuery } from '../../ui/router';
import { useAiStatus } from '../cellar/LabelScan';

type Action =
  | { id: string; type: 'consume'; label: string; lot_id: string; wine_id: string; quantity: number; note: string | null }
  | { id: string; type: 'wishlist'; label: string; item: { wine_name: string; producer: string | null; vintage: number | null; color: string | null; region: string | null; note: string | null } }
  | { id: string; type: 'wine_advice'; label: string; wine_id: string; patch: Record<string, unknown> }
  | { id: string; type: 'event_wine'; label: string; event_id: string; lot_id: string; quantity: number; own: boolean }
  | { id: string; type: 'tasting_draft'; label: string; draft: { wine_name: string; vintage: number | null; wine_id: string | null; rating: number | null; comment: string | null; robe: string | null; nez: string | null; bouche: string | null } }
  | { id: string; type: 'save_price'; label: string; check_id: string; wine_id: string };

type Meta = { actions?: Action[]; sources?: { title: string; url: string; note?: string }[]; prices?: { status: string; reason: string | null }[] };

const DONE_KEY = 'cave-amis-actions';
function doneActions(): Record<string, 'done' | 'ignored'> {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function markAction(id: string, state: 'done' | 'ignored') {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify({ ...doneActions(), [id]: state }));
  } catch {
    /* préférence non mémorisée */
  }
}

const SUGGESTIONS = [
  'Quel vin de ma cave ouvrir avec un magret de canard ?',
  'Quelles bouteilles devrais-je boire prochainement ?',
  'Quels styles de vin correspondent aux dégustations que j’ai appréciées ?',
  'Aide-moi à décrire ce que je ressens pendant la dégustation.',
];

export function AssistantPage({ conversationId }: { conversationId: string | null }) {
  const { api, snapshot, run } = useStore();
  const confirm = useConfirm();
  const ai = useAiStatus();
  const query = routeQuery();
  const contextWine = query.get('vin');
  const contextEvent = query.get('evenement');
  const contextGroup = query.get('groupe');
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [input, setInput] = useState(query.get('q') ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => {
    if (contextWine) {
      const w = snapshot.wines.find((x) => x.id === contextWine);
      return w ? { kind: 'wine' as const, id: w.id, label: `Fiche : ${wineTitle(w)}` } : null;
    }
    if (contextEvent) {
      const e = snapshot.events.find((x) => x.id === contextEvent);
      return e ? { kind: 'event' as const, id: e.id, label: `Événement : ${e.title}` } : null;
    }
    if (contextGroup) {
      const g = snapshot.groups.find((x) => x.id === contextGroup && x.my_status === 'active');
      return g ? { kind: 'group' as const, id: g.id, label: `Groupe : ${g.name}` } : null;
    }
    return null;
  }, [contextWine, contextEvent, contextGroup, snapshot.wines, snapshot.events, snapshot.groups]);

  useEffect(() => {
    void api
      .conversations()
      .then(setConversations)
      .catch(() => setConversations([]));
  }, [api, conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoadingConv(true);
    void api
      .conversationMessages(conversationId)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoadingConv(false));
  }, [api, conversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const maxChars = ai.status?.max_input_chars ?? 2000;

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    if (message.length > maxChars) return setError(`Message trop long (${message.length} caractères, ${maxChars} au maximum).`);
    setError(null);
    setSending(true);
    const optimistic: AiMessage = { id: `tmp-${Date.now()}`, conversation_id: conversationId ?? '', role: 'user', content: message, meta: {}, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setInput('');
    const res = await api.ai('chat', { message, conversation_id: conversationId, context: conversationId ? null : context ? { kind: context.kind, id: context.id } : null });
    setSending(false);
    if (!res.ok) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(message);
      setError(res.message);
      return;
    }
    const conv = res.conversation_id as string;
    const reply = res.message as AiMessage;
    if (!conversationId) {
      go(`/assistant/${conv}`, { replace: true });
      setMessages([{ ...optimistic, conversation_id: conv }, reply]);
    } else setMessages((m) => [...m, reply]);
  }

  if (!conversationId && conversations === null) return <InlineLoading />;

  const unavailable = ai.unavailable;
  const remaining = ai.status ? ai.status.daily_limit - ai.status.requests_today : null;

  return (
    <>
      {unavailable && (
        <Notice tone="warn">
          {unavailable} Vous pouvez continuer à gérer vos caves, vos amis et vos événements normalement.
        </Notice>
      )}
      {!unavailable && remaining !== null && remaining <= 5 && (
        <Notice tone="gold">
          Il vous reste {remaining} demande{remaining > 1 ? 's' : ''} à l’assistant aujourd’hui.
        </Notice>
      )}
      {!unavailable && ai.status && ai.status.month_pct >= 80 && <Notice tone="gold">Vous approchez de votre limite mensuelle d’utilisation de l’assistant.</Notice>}

      {!conversationId && (
        <>
          <div className="card gold stack-sm">
            <div className="inline">
              <Sparkles aria-hidden />
              <strong>Votre sommelier personnel</strong>
            </div>
            <p className="small">
              Il connaît votre cave, votre carnet et vos événements (avec vos droits), mais ne modifie rien sans votre confirmation. Il distingue vos données,
              les repères généraux et ses propres estimations. Les prix de marché ne sont donnés qu’avec des sources.
            </p>
          </div>
          {!context && (
            <Button variant="secondary" icon={<ScanSearch />} onClick={() => go('/scanner')}>
              Scanner avant d’acheter
            </Button>
          )}
          {context && <span className="pill primary">{context.label}</span>}
          <div className="suggestions">
            {(context?.kind === 'wine'
              ? ['Dois-je carafer ce vin ?', 'À quelle température servir cette bouteille ?', 'Quand l’ouvrir, et avec quels plats ?', 'Quel est le prix actuel de ce millésime ?']
              : context?.kind === 'event'
                ? ['Propose des vins pour notre dîner à partir des bouteilles que les participants acceptent de partager.', 'Dans quel ordre servir les vins prévus ?']
                : context?.kind === 'group'
                  ? [
                      'Propose une sélection de vins pour notre prochaine soirée, d’après nos goûts et les bouteilles du groupe.',
                      'Quels vins de nos envies communes iraient avec une raclette ?',
                    ]
                  : SUGGESTIONS
            ).map((s) => (
              <button key={s} type="button" disabled={Boolean(unavailable) || sending} onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
          {conversations && conversations.length > 0 && (
            <section>
              <div className="section-title">
                <h2>Conversations précédentes</h2>
              </div>
              <div className="list">
                {conversations.map((c) => (
                  <div key={c.id} className="row static">
                    <a className="row-main" href={`#/assistant/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <span className="row-title">{c.title}</span>
                      <span className="row-sub">{dateShort(c.updated_at)}</span>
                    </a>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Supprimer la conversation « ${c.title} »`}
                      onClick={async () => {
                        if (!(await confirm({ title: 'Supprimer cette conversation ?', confirmLabel: 'Supprimer', danger: true }))) return;
                        const r = await run(() => api.deleteConversation(c.id), { success: 'Conversation supprimée', reload: false });
                        if (r.ok) setConversations((x) => (x ?? []).filter((y) => y.id !== c.id));
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {conversationId && (
        <div className="between">
          <Button variant="ghost" size="sm" icon={<MessageSquarePlus />} onClick={() => go('/assistant')}>
            Nouvelle conversation
          </Button>
        </div>
      )}

      {(conversationId || messages.length > 0) && (
        <div className="chat" aria-live="polite">
          {loadingConv && <InlineLoading />}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="bubble user">
                {m.content}
              </div>
            ) : (
              <AssistantBubble key={m.id} message={m} onChange={() => force((n) => n + 1)} />
            ),
          )}
          {sending && (
            <div className="bubble assistant">
              <InlineLoading text="L’assistant réfléchit… (quelques secondes)" />
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
      {conversationId && !loadingConv && messages.length === 0 && !sending && <EmptyState icon="💬" title="Conversation vide" />}

      {error && <Notice tone="warn">{error}</Notice>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="input"
          aria-label="Votre question à l’assistant"
          placeholder={unavailable ? 'Assistant indisponible' : 'Posez votre question…'}
          value={input}
          disabled={Boolean(unavailable)}
          maxLength={maxChars + 200}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <Button type="submit" aria-label="Envoyer" icon={<Send />} loading={sending} disabled={Boolean(unavailable) || !input.trim()}>
          <span className="sr-only">Envoyer</span>
        </Button>
      </form>
      <p className="small faint center" style={{ marginTop: -8 }}>
        L’assistant peut se tromper : vérifiez les informations importantes. Il ne modifie rien sans votre confirmation.
        {input.length > maxChars * 0.8 ? ` (${input.length}/${maxChars})` : ''}
      </p>
    </>
  );
}

function AssistantBubble({ message, onChange }: { message: AiMessage; onChange: () => void }) {
  const meta = message.meta as Meta;
  const sources = meta.sources ?? [];
  const actionsList = meta.actions ?? [];
  return (
    <div className="bubble assistant">
      <Markdown text={message.content} />
      {sources.length > 0 && (
        <div className="sources">
          <span className="strong">Sources consultées :</span>
          {sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
              {s.note ? ` — ${s.note}` : ''} <ExternalLink aria-hidden style={{ width: 13, height: 13, verticalAlign: -1 }} />
            </a>
          ))}
        </div>
      )}
      {actionsList.map((a) => (
        <ActionCard key={a.id} action={a} onChange={onChange} />
      ))}
    </div>
  );
}

function ActionCard({ action, onChange }: { action: Action; onChange: () => void }) {
  const { api, run, snapshot } = useStore();
  const actions = useActions();
  const state = doneActions()[action.id];
  const [busy, setBusy] = useState(false);
  if (state === 'ignored') return null;

  async function execute() {
    setBusy(true);
    let ok = true;
    switch (action.type) {
      case 'consume':
        ok = (await run(() => api.recordMovement(action.lot_id, 'consommation', action.quantity, todayIso(), action.note ?? 'Proposé par l’assistant', action.id), { success: 'Sortie enregistrée' })).ok;
        break;
      case 'wishlist':
        ok = (await run(() => api.addWish({ ...action.item, color: (action.item.color as never) ?? null }), { success: 'Ajouté à votre liste d’envies' })).ok;
        break;
      case 'wine_advice': {
        const p = action.patch as Record<string, unknown>;
        const patch: Record<string, unknown> = { ...p };
        if ('drink_from' in p) patch.window_source = 'ai';
        if ('serve_temp_min' in p) patch.temp_source = 'ai';
        if ('aeration' in p) patch.aeration_source = 'ai';
        if ('pairings' in p) patch.pairings_source = 'ai';
        ok = (await run(() => api.updateWine(action.wine_id, patch), { success: 'Conseils enregistrés (estimation de l’IA)' })).ok;
        break;
      }
      case 'event_wine':
        ok = (
          await run(() => api.proposeEventWine(action.event_id, action.lot_id, action.quantity, 'Proposé avec l’assistant', action.own, action.id), {
            success: action.own ? 'Bouteille confirmée et réservée' : 'Suggestion envoyée',
          })
        ).ok;
        break;
      case 'tasting_draft': {
        const w = action.draft.wine_id ? snapshot.wines.find((x) => x.id === action.draft.wine_id) : undefined;
        actions.newTasting({
          wine_id: w?.id ?? null,
          wine_name: action.draft.wine_name,
          vintage: action.draft.vintage,
          color: w?.color ?? null,
          producer: w?.domaine ?? w?.producer ?? null,
          region: w?.region ?? null,
          appellation: w?.appellation ?? null,
          rating: action.draft.rating,
          comment: action.draft.comment,
          robe: action.draft.robe,
          nez: action.draft.nez,
          bouche: action.draft.bouche,
          lots: w ? snapshot.lots.filter((l) => l.wine_id === w.id) : [],
        });
        setBusy(false);
        return;
      }
      case 'save_price':
        ok = (await run(() => api.savePriceCheck(action.check_id), { success: 'Prix de marché enregistré' })).ok;
        break;
    }
    setBusy(false);
    if (ok) {
      markAction(action.id, 'done');
      onChange();
    }
  }

  return (
    <div className="action-card">
      <span className="small strong">{action.type === 'tasting_draft' ? 'Proposition' : 'Action proposée — rien n’est fait sans votre accord'}</span>
      <span>{action.label}</span>
      {state === 'done' ? (
        <span className="pill success">
          <Check aria-hidden /> Fait
        </span>
      ) : (
        <div className="inline">
          <Button size="sm" icon={<Check />} loading={busy} onClick={() => void execute()}>
            {action.type === 'tasting_draft' ? 'Ouvrir la note' : 'Confirmer'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            onClick={() => {
              markAction(action.id, 'ignored');
              onChange();
            }}
          >
            Ignorer
          </Button>
        </div>
      )}
    </div>
  );
}
