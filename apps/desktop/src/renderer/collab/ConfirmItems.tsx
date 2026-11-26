/**
 * The four kinds of "To confirm" item (contract §2 "What to submit"). Each root is `.q` with
 * `data-testid="ask-item"`, `data-kind` and `data-id`; each keeps a `busy` flag while its submit
 * is pending and calls `onDone(label)` once the answer was accepted or queued. Conflicts and
 * questions live in their own files (ConflictItem.tsx, QuestionItem.tsx); detected extracts and
 * agent proposals are here.
 */
import { useState } from 'react';
import { clip, currentOrLatestRound, SEP, userName, type Id, type IsoDate } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Btn, NeedChip, Pill, RulesMark } from '../ui/primitives';
import { useAnswer } from './answer';
import { acceptCommands, extractCommand, proposalCommand, type ConfirmItem } from './confirm';

export { ConflictItem, decisionHandoff, HandoffPick } from './ConflictItem';
export { QuestionItem } from './QuestionItem';

type ExtractEntry = Extract<ConfirmItem, { kind: 'extract' }>;
type ProposalEntry = Extract<ConfirmItem, { kind: 'proposal' }>;

/**
 * A detected extract (needs/inputs.jsx extract card): its type, the input it came from, the
 * text, and for a revision the need it revises. Accept (with a new need id, which core uses only
 * for `new` and `hyp`) or ignore. Accepting may be refused with a share-first code; the item
 * then stays and is released (submit shows the notice).
 */
export function ExtractItem({ item, projectId, onDone }: { item: ExtractEntry; projectId: Id; onDone(label: string): void }) {
  const { t, live, today } = useApp();
  const { busy, run } = useAnswer(onDone);
  const { input, extract: x } = item;
  const what = clip(x.text, 60);
  // The due date the text gave, changeable or clearable before accepting.
  const [due, setDue] = useState<IsoDate | ''>(x.due ?? '');
  const datable = x.type === 'new' || x.type === 'hyp';
  return (
    <div className="q" data-testid="ask-item" data-kind="extract" data-id={item.id}>
      <div className="row gap6">
        <Pill tone="neutral">{t(`ask.xt.${x.type}` as MessageKey)}</Pill>
        <span className="grow" />
        {input.detector.startsWith('deepseek') ? <Pill tone="ai">{t('ai.deepseek')}</Pill> : <RulesMark />}
      </div>
      <div className="small faint">{t('ask.from', { title: input.title })}</div>
      <div className="q-t">{x.text}</div>
      {x.met && (
        <div className="small tone-success" data-testid="x-met">
          {t('ask.alreadyDone')}
        </div>
      )}
      {x.type === 'rev' && x.needId && (
        <div className="row gap6">
          <NeedChip projectId={projectId} needId={x.needId} />
        </div>
      )}
      {datable && (
        <label className="row gap6 small faint" data-testid="x-due">
          {t('ask.due')}
          <input className="inp inp-sm" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t('ask.due')} />
          {due && (
            <button type="button" className="link small" onClick={() => setDue('')}>
              {t('ask.dueClear')}
            </button>
          )}
        </label>
      )}
      <div className="row gap6">
        <Btn kind="primary" testId="x-accept" disabled={busy} onClick={() => run(acceptCommands(live, input, x, newId('n'), today, due || null), t('ask.accept') + SEP + what)}>
          {t('ask.accept')}
        </Btn>
        <Btn testId="x-ignore" disabled={busy} onClick={() => run([extractCommand('ignore', input, x, '')], t('ask.ignore') + SEP + what)}>
          {t('ask.ignore')}
        </Btn>
      </div>
    </div>
  );
}

/**
 * An agent proposal: who proposed it and through which client (not rule output, so no
 * `RulesMark`), the title and why. Accepting makes it a need in the current (or latest) round.
 */
export function ProposalItem({ item, projectId, onDone }: { item: ProposalEntry; projectId: Id; onDone(label: string): void }) {
  const { t, live } = useApp();
  const { busy, run } = useAnswer(onDone);
  const p = item.proposal;
  const what = clip(p.title, 60);
  const accept = () => run([proposalCommand('accept', p, newId('n'), currentOrLatestRound(live, projectId)?.id ?? null)], t('pr.accept') + SEP + what);
  return (
    <div className="q" data-testid="ask-item" data-kind="proposal" data-id={item.id}>
      <div className="row gap6">
        <Pill tone="ai">{t('pr.title')}</Pill>
        <span className="grow" />
        <span className="small faint">{t('pr.by', { who: userName(live, p.by), client: p.via?.client ?? t('src.agent') })}</span>
      </div>
      <div className="q-t">{p.title}</div>
      {p.why && <div className="small muted">{p.why}</div>}
      <div className="row gap6">
        <Btn kind="primary" testId="pr-accept" disabled={busy} onClick={accept}>
          {t('pr.accept')}
        </Btn>
        <Btn testId="pr-reject" disabled={busy} onClick={() => run([proposalCommand('reject', p, '', null)], t('pr.reject') + SEP + what)}>
          {t('pr.reject')}
        </Btn>
      </div>
    </div>
  );
}
