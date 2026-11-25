import { useEffect, useState } from 'react';
import { needVersion, SEP, toConfirm, type Id, type Need } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { HandoffBlock } from '../collab/HandoffBlock';
import { Btn, SourceTag, Status } from '../ui/primitives';
import { DrawerEdit } from './DrawerEdit';
import { ArtifactsSection, ChildrenSection, MetaSection, RevisionsSection, WorkSection } from './DrawerSections';
import { childrenOf, drawerWork, liveHandoffs, needArtifacts, pendingNeedIds, shownHandoff } from './model';
import { useThrowNotice, withBusy } from './busy';
import { SHARE_IDLE, shareClick, shareView, type ShareState } from './share';
import './needs.css';

/** The close `×`, shared by the full drawer and the "not available" placeholder. Hidden under 760px, where `BackButton` takes its place. */
function CloseButton() {
  const { t, closeNeed } = useApp();
  return (
    <button type="button" className="x dr-x" aria-label={t('close')} title={t('close')} onClick={closeNeed}>
      {'×'}
    </button>
  );
}

/**
 * `drawer-back`: under 760px the drawer is a full-screen page (design 2026-11-25 §7) and this
 * button, at the start of its header, closes it back to the page underneath. Hidden above 760px.
 */
export function BackButton() {
  const { t, closeNeed } = useApp();
  return (
    <button type="button" className="btn btn-ghost drawer-back" data-testid="drawer-back" onClick={closeNeed}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {t('web.back')}
    </button>
  );
}

/**
 * `dr-share` on a private need (12.9, 12.22): Share with project, or share the source input first,
 * or, after an `input.shared` refusal named other private needs, share those first, with their
 * codes on a muted line so nothing else is published unseen. `decideFirst` says to decide the
 * input's pending revision instead. Both offer `dr-share-review` to open To confirm.
 */
export function ShareControls({
  projectId,
  need,
  busy,
  share,
  onShare,
}: {
  projectId: Id;
  need: Need;
  busy: boolean;
  share: ShareState;
  onShare: () => void;
}) {
  const { t, live, openOverlay } = useApp();
  const view = shareView(live, need, share);
  return (
    <>
      <div className="row gap6 wrap">
        <Btn kind="primary" testId="dr-share" disabled={busy} onClick={onShare}>
          {t(view.label)}
        </Btn>
      </div>
      {(view.also.length > 0 || view.decideFirst) && (
        <div className="row gap6 wrap small">
          <span className="muted">{view.also.length > 0 ? t('dr.shareAlso', { codes: view.also.join(SEP) }) : t('dr.decideFirst')}</span>
          <Btn testId="dr-share-review" disabled={busy} onClick={() => openOverlay({ kind: 'confirm', projectId })}>
            {t('dr.review')}
          </Btn>
        </div>
      )}
    </>
  );
}

/**
 * The header (needs3/board.jsx `Drawer`, no kind mark): code, kind and close; the title; the
 * status row; and the action buttons — hand off and copy for agent on a shared need,
 * `ShareControls` on a private one. The "To confirm" line appears only while this need is itself
 * what To confirm is waiting on.
 */
function Header({ projectId, need, busy, setBusy }: { projectId: Id; need: Need; busy: boolean; setBusy: (b: boolean) => void }) {
  const { t, me, today, live, openOverlay, submit } = useApp();
  const onThrow = useThrowNotice();
  const [share, setShare] = useState<ShareState>(SHARE_IDLE);
  // A share attempt's leftover state must not follow the drawer to a different need.
  useEffect(() => setShare(SHARE_IDLE), [need.id]);
  const priv = need.privateTo !== null;
  const tc = toConfirm(live, me, projectId, today);
  const pendingCount = tc.conflicts.filter((c) => c.needId === need.id).length + tc.questions.filter((q) => q.kind === 'stale' && q.needId === need.id).length;
  const pending = pendingNeedIds(tc).has(need.id);

  const onShare = async () => {
    // A throw part-way keeps the current state: the next click recomputes its steps from `live`.
    const next = await withBusy(setBusy, () => shareClick(live, need, share, submit), onThrow);
    if (next) setShare(next);
  };

  return (
    <div className="dr-h">
      <BackButton />
      <div className="row gap6">
        <span className="mono faint">{need.code}</span>
        <span className="faint small">{t(`kind.${need.kind}` as MessageKey)}</span>
        <span className="grow" />
        <CloseButton />
      </div>
      <h2>{need.title}</h2>
      <div className="row gap6 wrap">
        <Status s={need.status} />
        {priv && <span className="lock">{t('pv.mine')}</span>}
        {need.verdict && <span className="small muted">{need.verdict}</span>}
        <span className="small faint">{t('dr.version', { v: needVersion(need) })}</span>
      </div>
      {priv ? (
        <ShareControls projectId={projectId} need={need} busy={busy} share={share} onShare={onShare} />
      ) : (
        <div className="row gap6 wrap">
          <Btn kind="primary" testId="dr-handoff" disabled={busy} onClick={() => openOverlay({ kind: 'handoff', projectId, needId: need.id })}>
            {t('ho.btn')}
          </Btn>
          <Btn testId="dr-link" disabled={busy} onClick={() => openOverlay({ kind: 'link', projectId, needId: need.id })}>
            {t('lk.btn')}
          </Btn>
        </div>
      )}
      {pending && (
        <div className="row gap6 wrap small">
          <span className="faint">{t('dr.pending', { n: pendingCount })}</span>
          <Btn testId="dr-pending" disabled={busy} onClick={() => openOverlay({ kind: 'confirm', projectId })}>
            {t('dr.review')}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** `dr.source`: the quote, where it came from and when, and `dr.open` to the input it came from. */
function SourceSection({ projectId, need }: { projectId: Id; need: Need }) {
  const { t, fmtDay, go } = useApp();
  const src = need.source;
  return (
    <section className="dr-s">
      <h3>{t('dr.source')}</h3>
      <blockquote>{src.quote}</blockquote>
      <div className="row gap6 small faint wrap">
        <span className="src">
          <SourceTag src={src.src} />
        </span>
        <span>{src.ref + SEP + fmtDay(src.date)}</span>
        {src.inputId && (
          <button type="button" className="link" data-testid="dr-source-open" onClick={() => go({ view: 'inputs', projectId, focusId: src.inputId! })}>
            {t('dr.open')} {'↗'}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The need drawer (needs3/board.jsx `Drawer`): header, a hand-off block for each live handoff
 * (`liveHandoffs`, newest first; else the closed one `shownHandoff` returns, if any), source, details, revisions, activity, artifacts and children,
 * in that order. Task 11 adds edit controls in `dr.meta`. A need outside `live` (unknown, or
 * private to someone else) renders only `dr.missing` and the close button.
 */
export function NeedDrawer({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live, t } = useApp();
  const [busy, setBusy] = useState(false);
  // The drawer can switch to a different need without unmounting: a submit from the need that
  // was showing before must not leave this one's buttons disabled.
  useEffect(() => setBusy(false), [needId]);
  const n = live.needs[needId];
  const need = n && n.projectId === projectId ? n : null;

  if (!need) {
    return (
      <aside className="drawer" data-testid="drawer" data-need={needId}>
        <div className="dr-h">
          <BackButton />
          <div className="row gap6">
            <span className="faint">{t('dr.missing')}</span>
            <span className="grow" />
            <CloseButton />
          </div>
        </div>
      </aside>
    );
  }

  const work = drawerWork(live, needId);
  const artifacts = needArtifacts(live, needId);
  const children = childrenOf(live, needId);
  // Every live handoff gets its own block (newest first); with none live, the latest closed one.
  const liveOnes = liveHandoffs(live, needId);
  const latest = shownHandoff(live, needId);
  const handoffs = liveOnes.length > 0 ? liveOnes : latest ? [latest] : [];

  return (
    <aside className="drawer" data-testid="drawer" data-need={needId}>
      <Header projectId={projectId} need={need} busy={busy} setBusy={setBusy} />
      {handoffs.map((h) => (
        <HandoffBlock key={h.id} need={need} h={h} />
      ))}
      <SourceSection projectId={projectId} need={need} />
      <MetaSection projectId={projectId} need={need} busy={busy} setBusy={setBusy}>
        <DrawerEdit need={need} busy={busy} setBusy={setBusy} />
      </MetaSection>
      <RevisionsSection need={need} />
      <WorkSection work={work} />
      <ArtifactsSection projectId={projectId} artifacts={artifacts} />
      <ChildrenSection projectId={projectId} children={children} />
    </aside>
  );
}
