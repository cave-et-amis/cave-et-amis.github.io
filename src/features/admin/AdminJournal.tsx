/**
 * Journal des actions de l'administrateur (publication d'un document légal, réglages de l'assistant, limites d'un
 * compte) : écrit par la base, impossible à modifier, effacé après 12 mois. Lecture seule ici.
 */
import { useEffect, useState } from 'react';
import type { AdminJournalEntry } from '../../data/api';
import { useStore } from '../../data/store';
import { errorCode, toMessage } from '../../domain/errors';
import { dateShort } from '../../domain/format';
import { isLegalKind, LEGAL_TITLES } from '../../domain/legal';
import { InlineLoading, Notice } from '../../ui/kit';

function describe(e: AdminJournalEntry) {
  const d = e.details;
  switch (e.action) {
    case 'publication_document': {
      const kind = String(d.document ?? '');
      return `Publication : ${isLegalKind(kind) ? LEGAL_TITLES[kind] : kind}, version ${String(d.version ?? '?')}`;
    }
    case 'reglages_assistant':
      return `Réglages de l’assistant : ${Object.keys(d).join(', ')}`;
    case 'limites_compte':
      return d.reinitialisees ? `Limites de ${e.target_name || 'un compte supprimé'} : réinitialisées` : `Limites de ${e.target_name || 'un compte supprimé'}${d.bloque ? ' (bloqué)' : ''}`;
  }
}

export function AdminJournal() {
  const { api } = useStore();
  const [rows, setRows] = useState<AdminJournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.adminJournal(50).then(
      (r) => alive && setRows(r),
      (e) => {
        if (!alive) return;
        // Sans code activé, la page l'explique déjà plus haut.
        setError(errorCode(e) === 'admin_mfa_required' ? null : toMessage(e));
        setRows([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [api]);

  return (
    <section className="card stack-sm" aria-labelledby="h-journal">
      <h2 id="h-journal" className="section">
        Journal de l’administration
      </h2>
      <p className="small muted">Chaque publication et chaque changement de réglage y est noté. Il ne se modifie pas et s’efface après 12 mois.</p>
      {error && <Notice tone="warn">{error}</Notice>}
      {!rows ? (
        <InlineLoading />
      ) : rows.length === 0 ? (
        <p className="small muted">Aucune action notée.</p>
      ) : (
        <div className="list">
          {rows.map((r, i) => (
            <div key={i} className="row static">
              <span className="row-main">
                <span className="row-title">{describe(r)}</span>
                <span className="row-sub">{dateShort(r.at)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
