import { useState } from 'react';
import { currentOrLatestRound, projectRounds, SEP, userName, type Conflict, type Id, type IsoDate, type State } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { displayName } from '../model/state';
import { Avatar, Btn, Pill, RulesMark } from '../ui/primitives';
import { useAnswer } from './answer';
import { conflictCommand, type ConfirmItem } from './confirm';
import { handoffPeople, roundDue, type Cmd } from './model';

type ConflictEntry = Extract<ConfirmItem, { kind: 'conflict' }>;

/**
 * The `handoff` resolution of a conflict: a new decision handoff to `toId`, due on the current
 * (or latest) round's deadline while that round is open and the date has not passed
 * (`roundDue`, the rule `dueChoices` uses), else with no due date.
 */
export function decisionHandoff(s: State, projectId: Id, c: Conflict, toId: Id, ask: string, today: IsoDate): Cmd<'conflict.resolved'> {
  const due = roundDue(currentOrLatestRound(s, projectId), today);
  return conflictCommand(c, { kind: 'handoff', handoffId: newId('h'), toId, ask, due });
}

/**
 * Who the decision goes to (`handoffPeople`, never me), each with their role, and `cf.send`.
 * The first listed person is picked to start with. Nobody to pick shows `ho.nobody` and no send.
 */
export function HandoffPick({ projectId, busy, onSend }: { projectId: Id; busy: boolean; onSend: (toId: Id) => void }) {
  const { t, live, me } = useApp();
  const groups = handoffPeople(live, projectId, me);
  const first = groups[0]?.memberIds[0] ?? null;
  const [to, setTo] = useState<Id | null>(first);
  if (first === null) return <p className="faint small">{t('ho.nobody')}</p>;
  return (
    <div className="q-pick">
      <div className="small faint">{t('cf.pick')}</div>
      <div className="people">
        {groups.flatMap((g) =>
          g.memberIds.map((id) => (
            <button key={id} type="button" className={`person${to === id ? ' on' : ''}`} data-testid="cf-person" data-person={id} disabled={busy} onClick={() => setTo(id)}>
              <Avatar userId={id} />
              <span className="grow">
                <span className="person-n">{displayName(live, id)}</span>
                <span className="person-r">{g.roleName ?? t('ho.noRole')}</span>
              </span>
              {to === id && <span>{'✓'}</span>}
            </button>
          )),
        )}
      </div>
      <Btn kind="primary" testId="cf-send" disabled={busy || to === null} onClick={() => to !== null && onSend(to)}>
        {t('cf.send')}
      </Btn>
    </div>
  );
}

/**
 * A conflict (needs3/collab.jsx `AskPanel`, QC1): the current need and the new input side by
 * side, why it is mine to decide (I imported it, I own the need, or who handed it to me), and the
 * three ways to decide, as three equal options: revise
 * the need, keep it and park the new request in a round that is not delivered (or no round), or
 * hand the decision to someone.
 */
export function ConflictItem({ item, projectId, onDone }: { item: ConflictEntry; projectId: Id; onDone(label: string): void }) {
  const { t, live, me, today } = useApp();
  const { busy, run } = useAnswer(onDone);
  const [picking, setPicking] = useState(false);
  const c = item.conflict;
  const code = live.needs[c.needId]?.code ?? t('common.missingText');
  const rounds = projectRounds(live, projectId).filter((r) => r.status !== 'delivered');
  const park = (roundId: Id | null) => run([conflictCommand(c, { kind: 'park', needId: newId('n'), roundId })], t('cf.resolved.park', { need: code }));
  const send = (toId: Id) => run([decisionHandoff(live, projectId, c, toId, t('cf.handoffAsk', { need: code }), today)], t('ask.waiting', { who: userName(live, toId) }));

  return (
    <div className="q qc" data-testid="ask-item" data-kind="conflict" data-id={item.id}>
      <div className="row gap6">
        <Pill tone="warning">{t('cf.title')}</Pill>
        <span className="grow" />
        <RulesMark />
      </div>
      <div className="q-t">{t('cf.q', { need: code })}</div>
      <div className="cf">
        <div className="cf-b">
          <div className="small faint">{t('cf.old', { need: code })}</div>
          <div>{c.old}</div>
        </div>
        <div className="cf-b neu">
          <div className="small faint">{t('cf.new') + SEP + c.src}</div>
          <div>{c.neu}</div>
        </div>
      </div>
      <div className="small muted">
        {item.delegatedBy ? t('cf.whyDelegated', { who: userName(live, item.delegatedBy) }) : t(c.deciderId === me ? 'cf.why' : 'cf.whyOwner')}
      </div>
      <div className="q-opts">
        <Btn testId="cf-revise" disabled={busy} onClick={() => run([conflictCommand(c, { kind: 'revise' })], t('cf.resolved.revise', { need: code }))}>
          {t('cf.revise', { need: code })}
        </Btn>
        <div className="q-park">
          <span>{t('cf.park', { need: code })}</span>
          {rounds.map((r) => (
            <button key={r.id} type="button" className="chip" data-testid="cf-park" data-round={r.id} disabled={busy} onClick={() => park(r.id)}>
              {(r.title || t('round', { n: r.n }))}
            </button>
          ))}
          <button type="button" className="chip" data-testid="cf-park" data-round="none" disabled={busy} onClick={() => park(null)}>
            {t('cf.parkNone')}
          </button>
        </div>
        <Btn testId="cf-handoff" disabled={busy} onClick={() => setPicking((p) => !p)}>
          {t('cf.handoff')}
        </Btn>
        {picking && <HandoffPick projectId={projectId} busy={busy} onSend={send} />}
      </div>
    </div>
  );
}
