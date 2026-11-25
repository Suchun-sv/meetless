import { noDots, SEP, type Id, type ProjectRename } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { EF_TONE } from '../ui/tone';
import { NeedChip, Pill, RulesMark, SourceTag } from '../ui/primitives';
import { useApp } from '../app/AppContext';
import { displayName } from '../model/state';
import type { StreamRowData } from './model';

/**
 * One activity-stream row (task 9 brief): the source, date and author on the left, the effect,
 * need chips, result and why on the right, then the kind marks. `w.needId`/`alsoNeedId` may name
 * a need the viewer's state does not hold (R37); `needChip` renders nothing for such an id, never
 * a placeholder and never a crash.
 */
export function StreamRow({ projectId, row }: { projectId: Id; row: StreamRowData }) {
  const { live, t, fmtDay, openOverlay } = useApp();
  const { w, kind, rules, mine, unlinked, askable } = row;
  // "Counts as progress" (and the agent client with it) only for linked progress work (R21c): an
  // unlinked row counts toward nothing until it is linked, so it shows stream.unlinked instead.
  const counts = row.progress && !unlinked;

  const needChip = (needId: Id | null) => {
    if (!needId) return null;
    const n = live.needs[needId];
    if (!n || n.projectId !== projectId) return null;
    return <NeedChip key={needId} projectId={projectId} needId={needId} />;
  };

  const author = displayName(live, w.by);

  return (
    <div className="srow" data-testid="stream-row" data-work={w.id} data-kind={kind}>
      <div className="sig">
        <div>
          <div className="small faint row gap6">
            <SourceTag src={w.src} />
            <span>{[fmtDay(w.date), noDots(author)].join(SEP)}</span>
          </div>
          <div className={w.src === 'commit' ? 'mono' : undefined}>{noDots(w.text)}</div>
        </div>
      </div>
      <div className="read">
        {/* The need code never follows a mark (guards: marksBeforeCodes): the chips come first, the Pills after. */}
        <div className="row gap6 wrap">
          {needChip(w.needId)}
          {needChip(w.alsoNeedId)}
          {w.effect && <Pill tone={EF_TONE[w.effect]}>{t(`ef.${w.effect}` as MessageKey)}</Pill>}
          {w.result && <Pill tone={w.result === 'keep' ? 'success' : 'muted'}>{t(`res.${w.result}` as MessageKey)}</Pill>}
        </div>
        {w.why && <div className="small muted">{noDots(w.why)}</div>}
        <div className="row gap6 wrap">
          {counts && kind === 'agent' && w.via && (
            <>
              <span className="small tone-success">{t('stream.via', { client: w.via.client })}</span>
              <span className="small tone-success">{t('stream.progress')}</span>
            </>
          )}
          {counts && kind === 'manual' && <span className="small tone-success">{t('stream.progress')}</span>}
          {kind === 'capture' && <span className="small tone-muted">{t('cap.label')}</span>}
          {rules && <RulesMark />}
          {mine && <span className="small tone-muted">{t('pv.mine')}</span>}
          {unlinked && <span className="small faint">{t('stream.unlinked')}</span>}
          {askable && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="stream-review"
              onClick={() => openOverlay({ kind: 'confirm', projectId })}
            >
              {t('stream.review')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A system line in Activity (contract 12.23): who renamed the project, from which name to which, and the day. */
export function StreamSysRow({ rename }: { rename: ProjectRename }) {
  const { live, t, fmtDay } = useApp();
  const text = t('stream.renamed', { who: noDots(displayName(live, rename.by)), from: noDots(rename.from), to: noDots(rename.to) });
  return (
    <div className="srow-sys small muted" data-testid="stream-sys" data-seq={rename.seq}>
      {[fmtDay(rename.at.slice(0, 10)), text].join(SEP)}
    </div>
  );
}
