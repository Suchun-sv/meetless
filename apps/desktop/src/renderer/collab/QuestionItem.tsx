import { clip, currentOrLatestRound, nextRound, SEP, type Id, type Need, type WorkItem } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Btn, NeedChip, RulesMark, SourceTag } from '../ui/primitives';
import { SRC_LABEL_KEY } from '../ui/tone';
import { useAnswer } from './answer';
import { ignoreWorkCommand, linkCommand, linkTargets, newHypCommands, staleCommands, staleOptions, unlinkedSuggestion, type ConfirmItem, type StaleOption } from './confirm';

type QuestionEntry = Extract<ConfirmItem, { kind: 'question' }>;
type Answer = ReturnType<typeof useAnswer>;
type Ctx = ReturnType<typeof useApp>;

const STALE_KEY = { park: 'ask.park', drop: 'ask.drop', next: 'ask.next' } as const;

/**
 * An unlinked work item (data-paper.js Q2): what it is (`ask.q.unlinked`), where and when it
 * came from, and the ways to answer: link it to the need the rule suggests, link it to another
 * open need, make it a new hypothesis (created first, linked only once the create went
 * through), or ignore it. A plain render helper (no hooks), so the item's own tree holds every
 * button.
 */
function unlinked({ t, live, me, fmtDay }: Ctx, w: WorkItem, projectId: Id, a: Answer) {
  const suggestion = unlinkedSuggestion(live, w);
  const others = linkTargets(live, w).filter((n) => n.id !== suggestion?.id);
  const link = (n: Need) => a.run([linkCommand(w, n.id)], t('ask.link', { need: n.code }));
  const newHyp = () => a.run(newHypCommands(w, newId('n'), currentOrLatestRound(live, projectId), me, t(SRC_LABEL_KEY[w.src])), t('ask.newHyp'));
  return (
    <>
      <div className="q-t">{t('ask.q.unlinked', { work: w.text })}</div>
      <div className="row gap6 wrap small muted">
        <SourceTag src={w.src} />
        <span className="mono">{clip(w.text, 80)}</span>
        <span>{fmtDay(w.date)}</span>
      </div>
      {w.why && <div className="small muted">{w.why}</div>}
      <div className="q-opts">
        {suggestion && (
          <Btn testId="q-link" data-need={suggestion.id} disabled={a.busy} onClick={() => link(suggestion)}>
            {t('ask.link', { need: suggestion.code })}
          </Btn>
        )}
        {others.length > 0 && (
          <select
            className="inp"
            data-testid="q-link-other"
            value=""
            disabled={a.busy}
            onChange={(e) => {
              const n = others.find((o) => o.id === e.target.value);
              if (n) return link(n);
            }}
          >
            <option value="">{t('ask.linkOther')}</option>
            {others.map((n) => (
              <option key={n.id} value={n.id}>
                {`${n.code} ${clip(n.title, 60)}`}
              </option>
            ))}
          </select>
        )}
        <Btn testId="q-new" disabled={a.busy} onClick={newHyp}>
          {t('ask.newHyp')}
        </Btn>
        <Btn testId="q-ignore" disabled={a.busy} onClick={() => a.run([ignoreWorkCommand(w)], t('ask.skip'))}>
          {t('ask.skip')}
        </Btn>
      </div>
    </>
  );
}

/**
 * A stale need (data-paper.js Q3): idle for days with its round ending soon. The options come
 * from `staleOptions`: drop an external need or park a hypothesis, and move it to the next
 * round when there is one. A plain render helper, like `unlinked`.
 */
function stale({ t, live }: Ctx, n: Need, projectId: Id, idle: number, left: number, a: Answer) {
  const next = nextRound(live, projectId);
  const label = (o: StaleOption) => (o === 'next' ? t(STALE_KEY.next, { n: next?.n ?? 0 }) : t(STALE_KEY[o]));
  return (
    <>
      <div className="q-t">{t('ask.q.stale', { need: n.code, idle, left })}</div>
      <div className="row gap6">
        <NeedChip projectId={projectId} needId={n.id} />
      </div>
      <div className="q-opts">
        {staleOptions(n, next).map((o) => (
          <Btn key={o} testId={`q-${o}`} disabled={a.busy} onClick={() => a.run(staleCommands(o, n, next), n.code + SEP + label(o))}>
            {label(o)}
          </Btn>
        ))}
      </div>
    </>
  );
}

/** A question (unlinked work or a stale need), rule output, so it carries `RulesMark`. */
export function QuestionItem({ item, projectId, onDone }: { item: QuestionEntry; projectId: Id; onDone(label: string): void }) {
  const ctx = useApp();
  const { t, live } = ctx;
  const a = useAnswer(onDone);
  const q = item.question;
  const w = q.kind === 'unlinked' ? live.work[q.workId] : undefined;
  const n = q.kind === 'stale' ? live.needs[q.needId] : undefined;
  return (
    <div className="q" data-testid="ask-item" data-kind="question" data-id={item.id}>
      <div className="row gap6">
        <span className="grow" />
        <RulesMark />
      </div>
      {w ? (
        unlinked(ctx, w, projectId, a)
      ) : n && q.kind === 'stale' ? (
        stale(ctx, n, projectId, q.idleDays, q.daysLeft, a)
      ) : (
        <div className="faint small">{t('common.missingText')}</div>
      )}
    </div>
  );
}
