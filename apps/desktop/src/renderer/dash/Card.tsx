import type { ReactNode } from 'react';
import { cardsFor, SEP, WIDE_CARDS, type CardId, type Id, type IsoTime } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { refreshCardPayload, removeCardPayload } from './model';
import { Pill } from '../ui/primitives';

/*
 * The dashboard card shell and its grid (contract §8, Task 6). Reused by Task 7's Home
 * dashboard (`CardGrid`'s `home` prop): a project dashboard passes nothing for it, Home passes
 * `home`, which only changes the "built from" wording in `Card`'s header.
 */

/**
 * One dashboard card: `section.surface-card[data-card=<id>]`, wide when `WIDE_CARDS` has it. The
 * header carries the title, who it is built from, when it was last refreshed, the rule-based
 * mark, and the refresh/remove buttons. `stamp` and `children` are the caller's: the page fixes
 * `openedAt` once (so a card with no stamp of its own reads as "updated when the page opened")
 * and renders the card body itself (`ProjectCard` for a project dashboard).
 */
export function Card({ id, scope, home, stamp, children }: { id: CardId; scope: Id; home?: boolean; stamp: IsoTime; children: ReactNode }) {
  const { live, me, t, fmtClock, submit } = useApp();
  const refresh = () => {
    const cur = cardsFor(live, me, scope);
    void submit('dashboard.set', refreshCardPayload(cur, scope, id, new Date().toISOString()));
  };
  const remove = () => {
    const cur = cardsFor(live, me, scope);
    void submit('dashboard.set', removeCardPayload(cur, scope, id));
  };
  return (
    <section className={`surface-card wg${WIDE_CARDS.has(id) ? ' wide' : ''}`} data-card={id}>
      <div className="wg-h">
        <h3>{t(`w.${id}` as MessageKey)}</h3>
        <span className="grow" />
        <span className="wg-meta">
          {t(home ? 'db.byHome' : 'db.by')}
          {SEP}
          {t('db.updated', { t: fmtClock(stamp) })}
        </span>
        {SEP}
        <Pill tone="ai" title={t('app.rulesTip')}>
          {t('app.rules')}
        </Pill>
        {/*
          The remove button's "×" is a glyph character (Unicode Sm): the shared guard
          `marksBeforeCodes` (test/support/guards.ts) flags any glyph that precedes a need code
          anywhere later in the page's flattened text, with nothing but tags between them. A
          risk row's text (`rk.<code>`) starts with the need's own code, so "×" right before a
          card's body would false-positive that check. Putting "×" last, with the refresh
          button's plain-text label after it, keeps a glyph from ever being the last visible
          character before a card's content.
        */}
        <button type="button" className="wg-act" aria-label={t('db.remove')} data-testid="card-remove" onClick={remove}>
          ×
        </button>
        <button type="button" className="wg-act" data-testid="card-refresh" onClick={refresh}>
          {t('db.refresh')}
        </button>
      </div>
      <div className="wg-b">{children}</div>
    </section>
  );
}

/**
 * The grid of cards for a scope (a project id, or 'home'): `cardsFor(live, me, scope)` in order,
 * each produced by `render(id)`, or `db.empty` when the set is empty. `home` is reserved for
 * Task 7's Home dashboard: it carries no grid-level behaviour here, since each card's own "built
 * from" wording is the caller's concern (see `Card`), not the grid's.
 */
export function CardGrid({ scope, home, render }: { scope: Id; home?: boolean; render: (id: CardId) => ReactNode }) {
  const { live, me, t } = useApp();
  void home;
  const { cards } = cardsFor(live, me, scope);
  if (cards.length === 0) return <p className="muted small">{t('db.empty')}</p>;
  return <div className="dash-grid">{cards.map((id) => render(id))}</div>;
}
