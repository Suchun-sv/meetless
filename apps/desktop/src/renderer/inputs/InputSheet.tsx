import { useEffect, useRef } from 'react';
import { noDots, SCENES, SEP, type Id, type Input, type Scene } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { sceneOf } from '../needs/lineage';
import { useApp } from '../app/AppContext';
import { Btn, FileKind } from '../ui/primitives';
import { downloadBlob } from '../artifacts/blobs';
import { paraExtract, requesterLabel } from './model';

const MEDIA_TYPE: Record<'docx' | 'pdf', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** `CSS.escape` when it exists (every real renderer target); a minimal fallback otherwise (fix round 1, Important 4 / Minor 11). */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Scrolls `paraId`'s paragraph into view inside `container` (ruling R13, contract 12.21), kept as
 * its own helper so the mount/update effect that calls it stays a one-liner (mirrors
 * `artifacts/PagesPreview.tsx`'s `scrollToPage`). `querySelector` is never called for a null
 * container or a null/undefined `paraId`.
 */
export function scrollToPara(container: HTMLElement | null, paraId: Id | null | undefined): void {
  if (!container || !paraId) return;
  const el = container.querySelector(`[data-para="${cssEscape(paraId)}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

/**
 * Pane-c: the selected input's header, the docx/pdf preview note, and its paragraphs.
 *
 * The share-first state (`blockedNeedIds`) is owned by `InputsPage`, not here (fix round 1,
 * Important 1): this component is re-rendered, not remounted, when the selected input changes, so
 * keeping that state local would let it survive a switch to a different input and point "share
 * the related need first" at a need unrelated to the one now showing.
 */
export function InputSheet({
  input,
  paraId,
  hotExtractId,
  onHoverExtract,
  blockedNeedIds,
  onShare,
  onShareNeedsFirst,
}: {
  input: Input;
  paraId?: Id | null;
  hotExtractId: Id | null;
  onHoverExtract: (extractId: Id | null) => void;
  blockedNeedIds: Id[] | null;
  onShare: () => void;
  onShareNeedsFirst: () => void;
}) {
  const { live, me, t, fmtDay, bridge, notify, errorText, submit } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => scrollToPara(ref.current, paraId), [paraId]);

  const map = paraExtract(input);
  const fromLabel = requesterLabel(live, input.from);
  const fact = [fromLabel ? t('in.from', { who: fromLabel }) : null, fmtDay(input.date)].filter((x): x is string => !!x).join(SEP);
  const isMine = input.privateTo === me;
  const isDocFile = input.kind === 'docx' || input.kind === 'pdf';
  const blocked = isMine && blockedNeedIds !== null && blockedNeedIds.length > 0;

  return (
    <div className="pane-c" data-testid="in-sheet">
      <div ref={ref} className="sheet">
        <div className="row gap6 wrap">
          <FileKind kind={input.kind} />
          <strong className="grow">{noDots(input.title)}</strong>
          {isMine && <span className="small tone-muted">{t('pv.mine')}</span>}
          {isMine && !blocked && (
            <Btn kind="sm" testId="in-share" onClick={onShare}>
              {t('pv.publish')}
            </Btn>
          )}
          {blocked && (
            <>
              <Btn kind="sm" testId="in-share-needs-first" onClick={onShareNeedsFirst}>
                {t('common.sharePrivateNeedFirst')}
              </Btn>
              {/* R14 / contract 12.22: the share path is not the only way out — deciding the
                  blocking revision below (accept or ignore it while the input stays private)
                  works too. ExtractPanel marks those same extracts (`blockingNeedIds`). */}
              <span className="small faint" data-testid="in-decide-hint">
                {t('in.decideHint')}
              </span>
            </>
          )}
        </div>
        <div className="row gap6 wrap">
          <span className="small faint">{fact}</span>
          {/* The scene was detected on import; whoever sees the input can correct it. */}
          <label className="small faint row gap6">
            {t('in.scene')}
            <select className="small" data-testid="in-scene" value={sceneOf(input)} onChange={(e) => void submit('input.scene_set', { inputId: input.id, scene: e.target.value as Scene })}>
              {SCENES.map((sc) => (
                <option key={sc} value={sc}>
                  {t(`lin.type.${sc}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isDocFile && (
          <div className="row gap6 wrap">
            <span className="small faint">{t('in.preview')}</span>
            {input.blobHash && (
              <Btn
                kind="sm"
                testId="in-original"
                onClick={() =>
                  void downloadBlob(bridge, input.blobHash!, noDots(input.title), MEDIA_TYPE[input.kind as 'docx' | 'pdf']).then((r) => {
                    if (!r.ok) notify('error', errorText(r.code));
                  })
                }
              >
                {t('af.original')}
              </Btn>
            )}
          </div>
        )}
        {input.body.map((p) => {
          const xId = map[p.id];
          const isFocused = p.id === paraId;
          const on = isFocused || (xId !== undefined && xId === hotExtractId);
          return (
            <p
              key={p.id}
              data-para={p.id}
              className={`para${xId ? ' hit' : ''}${on ? ' on' : ''}`}
              aria-current={isFocused ? 'true' : undefined}
              onMouseEnter={() => xId && onHoverExtract(xId)}
              onMouseLeave={() => xId && onHoverExtract(null)}
            >
              {noDots(p.text)}
            </p>
          );
        })}
      </div>
    </div>
  );
}
