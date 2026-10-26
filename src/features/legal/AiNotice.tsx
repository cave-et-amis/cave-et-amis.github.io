/**
 * Première utilisation de Lia (assistant, scanner, lecture d'étiquette) : qui reçoit ce qui lui est confié. Affiché une
 * fois par compte ; « J'ai compris » est noté dans les préférences.
 */
import { useState } from 'react';
import { useStore } from '../../data/store';
import { Button, Notice } from '../../ui/kit';

export function AiNotice() {
  const { me, api, run } = useStore();
  const [hidden, setHidden] = useState(false);
  if (hidden || me.preferences?.ai_notice) return null;
  return (
    <Notice tone="gold">
      <span className="stack-sm" style={{ display: 'grid' }}>
        <span>
          <strong>Comment fonctionne Lia.</strong> Lia s’appuie sur Claude, l’intelligence artificielle de la société Anthropic (États-Unis). Ce que vous lui
          confiez (vos messages, vos photos d’étiquette ou de rayon, et les extraits de votre cave, de votre carnet ou de vos événements utiles à la réponse)
          lui est transmis pour produire la réponse. Évitez d’y mettre des informations personnelles sur d’autres personnes. Détails dans la{' '}
          <a href="#/legal/confidentialite">politique de confidentialité</a>.
        </span>
        <span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setHidden(true);
              void run(() => api.mergePreferences({ ai_notice: new Date().toISOString().slice(0, 10) }), { silent: true });
            }}
          >
            J’ai compris
          </Button>
        </span>
      </span>
    </Notice>
  );
}
