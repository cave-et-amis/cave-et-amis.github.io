/**
 * Aide de la page (bouton « ? ») : les fiches de la base d'aide qui concernent la page, selon les droits de la personne,
 * avec un accès direct ; une recherche dans toutes les fiches ; Lia avec le contexte de la page ; la visite guidée.
 * Réponses documentées : aucune n'appelle l'assistant (donc aucun coût).
 */
import { useState, type ReactNode } from 'react';
import { ArrowRight, Compass, Search, Sparkles } from 'lucide-react';
import { useStore } from '../../data/store';
import { availability, HELP_PAGES, searchHelp, topicsForPage, type HelpPage, type HelpPerms, type HelpTopic } from '../../domain/help';
import { Button, Pill, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';
import { useAiStatus } from '../cellar/LabelScan';
import { useTour } from '../tour/Tour';

/** Ce que la personne peut faire, d'après ses données (l'assistant est vérifié à part). */
export function useHelpPerms(assistant = true): HelpPerms {
  const { me, snapshot, userId } = useStore();
  return {
    admin: me.is_admin,
    groupManager: snapshot.groups.some((g) => g.my_status === 'active' && (g.my_role === 'admin' || g.my_role === 'manager')),
    eventOrganizer: snapshot.events.some((e) => e.organizer_id === userId && e.status === 'planned'),
    assistant,
  };
}

/** Une fiche dépliable : les étapes et l'accès direct, ou pourquoi ce n'est pas possible. */
export function HelpTopicItem({ topic, perms, onOpen, extra }: { topic: HelpTopic; perms: HelpPerms; onOpen?: () => void; extra?: ReactNode }) {
  const a = availability(topic, perms);
  return (
    <details className="help-topic">
      <summary>
        <span>{topic.question}</span>
        {!a.available && <Pill>Non disponible</Pill>}
      </summary>
      {a.available ? (
        <>
          <ol className="help-steps">
            {topic.steps.map((s) => (
              <li key={s} className="small">
                {s}
              </li>
            ))}
          </ol>
          <div className="inline" style={{ marginBottom: 8 }}>
            {topic.link && (
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowRight />}
                onClick={() => {
                  onOpen?.();
                  go(topic.link!.path);
                }}
              >
                {topic.link.label}
              </Button>
            )}
            {extra}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ marginBottom: 8 }}>
          {a.reason}
        </p>
      )}
    </details>
  );
}

export function HelpSheet({ page, onClose }: { page: HelpPage; onClose: () => void }) {
  const ai = useAiStatus();
  const tour = useTour();
  const perms = useHelpPerms(!ai.unavailable);
  const [q, setQ] = useState('');
  const searching = q.trim().length >= 3;
  const topics = searching ? searchHelp(q, 6).filter((t) => t.needs !== 'admin' || perms.admin) : topicsForPage(page, perms);
  return (
    <Sheet open onClose={onClose} title={`Aide · ${HELP_PAGES[page]}`}>
      <div className="stack">
        <div className="search">
          <Search aria-hidden />
          <input className="input" type="search" aria-label="Chercher dans l’aide" placeholder="Chercher dans l’aide (inviter, partager…)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {topics.length === 0 ? (
            <p className="small muted" style={{ padding: '10px 0' }}>
              Aucune fiche ne correspond : cette fonction n’existe peut-être pas. Reformulez, ou posez la question à Lia.
            </p>
          ) : (
            topics.map((t) => <HelpTopicItem key={t.id} topic={t} perms={perms} onOpen={onClose} />)
          )}
        </div>
        <div className="inline">
          {!ai.unavailable && (
            <Button
              icon={<Sparkles />}
              onClick={() => {
                onClose();
                go(`/assistant?aide=${page}${searching ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
              }}
            >
              Demander à Lia
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<Compass />}
            onClick={() => {
              onClose();
              tour.start(0);
            }}
          >
            Revoir la visite guidée
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
