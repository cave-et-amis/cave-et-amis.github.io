/** Suppression du compte : confirmation par « SUPPRIMER » et par le mot de passe, vérifié par le serveur. */
import { useState } from 'react';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import { Button, Field, Notice, Sheet } from '../../ui/kit';

export function DeleteAccountSheet({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => Promise<void> }) {
  const { api } = useStore();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
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
          disabled={typed !== 'SUPPRIMER' || !password}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api.ai('delete_account', { confirm: 'SUPPRIMER', password });
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
        <p className="small muted">
          Restent chez les autres : votre prénom dans leurs notifications et dans l’activité de leurs groupes, et les envies que vous avez proposées dans un
          groupe (sans votre nom). La preuve que vous aviez accepté les conditions d’utilisation est gardée 5 ans, puis effacée. Pensez à télécharger vos
          données avant (Réglages › Confidentialité et mes données).
        </p>
        <Field label="Tapez SUPPRIMER pour confirmer" htmlFor="del-confirm">
          <input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Votre mot de passe" htmlFor="del-password" hint="Redemandé pour vérifier que c’est bien vous.">
          <input id="del-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}
