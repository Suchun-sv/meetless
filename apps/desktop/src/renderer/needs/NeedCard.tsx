import type { KeyboardEvent } from 'react';
import { SEP, userName, type Handoff, type Id, type Need } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { Avatar, Status } from '../ui/primitives';
import type { CardFacts } from './model';

/**
 * A handoff as a line of text: who it is from/to (or, for a third person reading it,
 * `ho.fromTo`), SEP, then its state. A handoff sent to `me` and still `sent` is `hot`: the
 * info tone (needs.css `.hoff.hot`), never violet (that colour is reserved for AI and rule
 * output). Reused by Task 6 (`compact` fits a card footer; the full form fits the drawer's
 * handoff block).
 */
export function HandoffLine({ h, me, compact }: { h: Handoff; me: Id; compact?: boolean }) {
  const { live, t } = useApp();
  const toMe = h.toId === me;
  const fromMe = h.fromId === me;
  const who = toMe
    ? t('ho.from', { who: userName(live, h.fromId) })
    : fromMe
      ? t('ho.to', { who: userName(live, h.toId) })
      : t('ho.fromTo', { from: userName(live, h.fromId), to: userName(live, h.toId) });
  const hot = toMe && h.state === 'sent';
  return <span className={`hoff${compact ? ' sm' : ''}${hot ? ' hot' : ''}`}>{who + SEP + t(`ho.st.${h.state}` as MessageKey)}</span>;
}

/**
 * A need's board card (needs3/board.jsx `NeedCard`, no kind mark: external needs and
 * hypotheses differ by the N / H code prefix, column and the hypothesis card's dashed
 * border). The footer shows the handoff in play, else the "To confirm" mark when a
 * question or conflict is waiting on this need, and the owner's avatar either way; the
 * footer is omitted entirely when none of the three apply. The card is a keyboard target too:
 * Enter or Space opens it, like a click.
 */
export function NeedCard({ need, facts, selected }: { need: Need; facts: CardFacts; selected: boolean }) {
  const { t, me, openNeed } = useApp();
  const priv = need.privateTo !== null;
  const cls = ['card', `c-${need.kind}`, `s-${need.status}`, selected ? 'on' : null, priv ? 'priv' : null].filter(Boolean).join(' ');
  const who = facts.requester.self ? t('card.self') : facts.requester.name;
  const meta = facts.evidence > 0 ? who + SEP + t('card.evidence', { n: facts.evidence }) : who;
  const showFooter = facts.handoff !== null || need.ownerId !== null || facts.pending;
  const open = () => openNeed(need.projectId, need.id);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  };
  return (
    <div className={cls} data-testid="need-card" data-need={need.id} role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown}>
      <div className="card-h">
        <span className="mono faint">{need.code}</span>
        {priv && <span className="lock">{t('pv.mine')}</span>}
        <span className="grow" />
        <Status s={need.status} />
      </div>
      <div className="card-t">{need.title}</div>
      <div className="card-m">{meta}</div>
      {showFooter && (
        <div className="card-f">
          {facts.handoff ? (
            <HandoffLine h={facts.handoff} me={me} compact />
          ) : facts.pending ? (
            <span className="card-ai ask">{t('ask.btn')}</span>
          ) : (
            <span />
          )}
          <span className="grow" />
          {need.ownerId && <Avatar userId={need.ownerId} size="sm" />}
        </div>
      )}
    </div>
  );
}
