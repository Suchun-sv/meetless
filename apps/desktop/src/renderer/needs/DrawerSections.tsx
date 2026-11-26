import { useEffect, useState, type ReactNode } from 'react';
import { projectRounds, type Artifact, type Id, type Need, type State, type WorkItem } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { Avatar, FileKind, NeedChip, Pill, RulesMark, SourceTag, Status } from '../ui/primitives';
import { EF_TONE } from '../ui/tone';
import { useThrowNotice, withBusy } from './busy';
import { roundCommand } from './edit';
import { requesterFacts } from './model';

/** `card.self` for the need's requester, or their name (`requesterFacts`: the creator stands in for one with no requester). */
function requesterLabel(live: State, need: Need, me: Id, t: (k: MessageKey) => string): string {
  const r = requesterFacts(live, need, me);
  return r.self ? t('card.self') : r.name;
}

/** `dr.round`'s row: the round (or `round.none`), with `RulesMark` and its round-picking chips while the round came from the rule. */
function RoundRow({ projectId, need, busy, setBusy }: { projectId: Id; need: Need; busy: boolean; setBusy: (b: boolean) => void }) {
  const { t, live, submit } = useApp();
  const onThrow = useThrowNotice();
  const [fixing, setFixing] = useState(false);
  // The drawer can switch to a different need without unmounting (openNeed only changes the
  // route's needId): drop any open round-fix chips from the need that was showing before.
  useEffect(() => setFixing(false), [need.id]);
  const round = need.roundId ? live.rounds[need.roundId] : null;
  return (
    <div className="kv">
      <span>{t('dr.round')}</span>
      <span className="row gap6 wrap">
        <span>{round ? (round.title || t('round', { n: round.n })) : t('round.none')}</span>
        {need.autoRound && <RulesMark onFix={() => setFixing((f) => !f)} />}
      </span>
      {fixing && (
        <div className="fix" data-testid="dr-round-fix">
          {projectRounds(live, projectId).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`chip${r.id === need.roundId ? ' on' : ''}`}
              disabled={busy}
              onClick={async () => {
                const cmd = roundCommand(need, r.id);
                // A throw keeps the chips open to retry; an answer (accepted or refused) closes them.
                if (await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow)) setFixing(false);
              }}
            >
              {(r.title || t('round', { n: r.n }))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `dr.meta`: Task 11's edit controls (status, revise, owner — `children`, rendered by
 * `NeedDrawer`), then requester, round (with its rule-matched fix), parent, and the
 * kind-specific fields.
 */
export function MetaSection({
  projectId,
  need,
  busy,
  setBusy,
  children,
}: {
  projectId: Id;
  need: Need;
  busy: boolean;
  setBusy: (b: boolean) => void;
  children?: ReactNode;
}) {
  const { t, live, me } = useApp();
  return (
    <section className="dr-s">
      <h3>{t('dr.meta')}</h3>
      {children}
      <div className="kv">
        <span>{t('dr.requester')}</span>
        <span>{requesterLabel(live, need, me, t)}</span>
      </div>
      <RoundRow projectId={projectId} need={need} busy={busy} setBusy={setBusy} />
      {need.parentId && (
        <div className="kv">
          <span>{t('dr.parent')}</span>
          <span>
            <NeedChip projectId={projectId} needId={need.parentId} />
          </span>
        </div>
      )}
      {need.kind === 'ext' ? (
        <div className="kv">
          <span>{t('dr.accept')}</span>
          <span>{need.accept}</span>
        </div>
      ) : (
        <>
          <div className="kv">
            <span>{t('dr.expect')}</span>
            {need.expect ? <span>{need.expect}</span> : <span className="faint">{t('dr.none')}</span>}
          </div>
          <div className="kv">
            <span>{t('dr.verify')}</span>
            {need.verify ? <span>{need.verify}</span> : <span className="faint">{t('dr.none')}</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** `dr.rev`, only while the need has revisions: each one's date, context version, text and reason. */
export function RevisionsSection({ need }: { need: Need }) {
  const { t, fmtDay } = useApp();
  if (need.revisions.length === 0) return null;
  return (
    <section className="dr-s">
      <h3>{t('dr.rev')}</h3>
      {need.revisions.map((r) => (
        <div key={r.id} className="rev">
          <div>
            <span className="faint small">{fmtDay(r.date)}</span> <span className="small">{t('dr.version', { v: r.version })}</span> {r.text}
          </div>
          <div className="small muted">{r.why}</div>
        </div>
      ))}
    </section>
  );
}

/** One `dr.work` row: the actor (an avatar, else the source word), the date and text, its pills, then the reason on its own line. */
function WorkRow({ w }: { w: WorkItem }) {
  const { t, fmtDay } = useApp();
  return (
    <li className={w.capture ? 'cap' : undefined}>
      <span className={`wsrc${w.src === 'agent' ? ' w-agent' : ''}`}>{w.by ? <Avatar userId={w.by} size="sm" /> : <SourceTag src={w.src} />}</span>
      <div className="grow">
        <div className="row gap6 wrap">
          <span className="faint small">{fmtDay(w.date)}</span>
          <span className="wt">{w.text}</span>
        </div>
        <div className="row gap6 wrap small">
          {w.capture ? (
            <Pill tone="muted">{t('cap.label')}</Pill>
          ) : (
            w.effect && <Pill tone={EF_TONE[w.effect]}>{t(`ef.${w.effect}` as MessageKey)}</Pill>
          )}
          {w.result && <Pill tone={w.result === 'keep' ? 'success' : 'muted'}>{t(`res.${w.result}` as MessageKey)}</Pill>}
          {w.via && <span className="muted">{t('dr.via', { client: w.via.client })}</span>}
        </div>
        {/* The reason sits on its own line: it often starts with a need code, and a pill right before a code reads as a mark (contract §8). */}
        {!w.capture && w.why && <div className="small muted">{w.why}</div>}
      </div>
    </li>
  );
}

/** `dr.work`: the need's activity, newest first, or `dr.none` when there is none yet. */
export function WorkSection({ work }: { work: WorkItem[] }) {
  const { t } = useApp();
  return (
    <section className="dr-s">
      <h3>{t('dr.work')}</h3>
      {work.length === 0 ? (
        <div className="faint small">{t('dr.none')}</div>
      ) : (
        <ol className="wlist">
          {work.map((w) => (
            <WorkRow key={w.id} w={w} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** `dr.artifacts`, only while the need has any: each one opens it in the Artifacts page. */
export function ArtifactsSection({ projectId, artifacts }: { projectId: Id; artifacts: Artifact[] }) {
  const { t, go } = useApp();
  if (artifacts.length === 0) return null;
  return (
    <section className="dr-s">
      <h3>{t('dr.artifacts')}</h3>
      {artifacts.map((a) => (
        <button key={a.id} type="button" className="li li-btn" onClick={() => go({ view: 'artifacts', projectId, focusId: a.id })}>
          <div className="row gap6">
            <FileKind kind={a.kind} />
            <span className="li-t">{a.title}</span>
            <span className="grow" />
            <span className="small faint">{a.where}</span>
          </div>
        </button>
      ))}
    </section>
  );
}

/** `dr.children`, only while the need has any: each child's chip and status. */
export function ChildrenSection({ projectId, children }: { projectId: Id; children: Need[] }) {
  const { t } = useApp();
  if (children.length === 0) return null;
  return (
    <section className="dr-s">
      <h3>{t('dr.children')}</h3>
      <div className="stack">
        {children.map((k) => (
          <div key={k.id} className="row gap6">
            <NeedChip projectId={projectId} needId={k.id} />
            <Status s={k.status} />
          </div>
        ))}
      </div>
    </section>
  );
}
