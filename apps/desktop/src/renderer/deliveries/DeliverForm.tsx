import { useState } from 'react';
import type { Round } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { draftItems } from './model';

/**
 * The current round's deliver form (task 10 brief): a textarea prefilled with the draft items,
 * one per line, and a confirm button that submits `round.delivered`. The core reducer fills
 * `account` itself from the round's shared external needs when the client sends none
 * (`reducer.ts` `round.delivered`), which is exactly the account the draft already previewed, so
 * this never sends `account`.
 */
export function DeliverForm({ round, items, onDone }: { round: Round; items: string[]; onDone?: () => void }) {
  const { t, submit, today } = useApp();
  const [text, setText] = useState(items.join('\n'));
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const result = await submit('round.delivered', { roundId: round.id, date: today, items: draftItems(text) });
    setBusy(false);
    if (result.kind !== 'rejected') onDone?.();
  };

  return (
    <div className="stack" data-testid="dl-form">
      <textarea className="inp ta" data-testid="dl-items" placeholder={t('dl.itemPh')} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn btn-primary" data-testid="dl-confirm" disabled={busy} onClick={confirm}>
        {t('dl.confirm')}
      </button>
    </div>
  );
}
