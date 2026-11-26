import { noDots, type Extract, type Id, type Input } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { runCmds } from '../collab/answer';
import { acceptCommands } from '../collab/confirm';
import { newId } from '../model/ids';
import { Btn, NeedChip, Pill, RulesMark } from '../ui/primitives';
import { EXTRACT_TONE, extractAction } from './model';

/**
 * Pane-r: the selected input's detected items, accepted or ignored one by one. `blockingNeedIds`
 * (fix round 1, Important 3 / R14, contract 12.22) names the private needs a blocked
 * `input.shared` named: the `rev` extract that targets one of them gets a neutral marker (never
 * violet — that colour is reserved for rule output), pointing at the other way out of the share
 * refusal: decide (accept or ignore) that extract while the input stays private.
 */
export function ExtractPanel({
  input,
  parsing,
  onHover,
  blockingNeedIds,
}: {
  input: Input | null;
  parsing: boolean;
  onHover: (extractId: Id | null) => void;
  blockingNeedIds: Id[];
}) {
  const { t, submit, openOverlay, live, today } = useApp();

  const onAccept = (x: Extract) => {
    if (!input) return;
    // Under the DDL of its due date, created first when the project has none that day.
    void runCmds(acceptCommands(live, input, x, newId('n'), today), submit);
  };
  const onIgnore = (x: Extract) => {
    if (!input) return;
    void submit('extract.ignored', { inputId: input.id, extractId: x.id });
  };
  const onDecide = () => {
    if (!input) return;
    openOverlay({ kind: 'confirm', projectId: input.projectId });
  };

  return (
    <div className="pane-r" data-testid="in-extract-panel">
      <h3>{t('in.extract')}</h3>
      {!input ? (
        <div className="faint small">{t('in.pick')}</div>
      ) : parsing ? (
        <div className="faint small" data-testid="in-parsing">
          {t('in.parsing')}
        </div>
      ) : input.extracts.length === 0 ? (
        <div className="faint small">{t('in.none')}</div>
      ) : (
        input.extracts.map((x) => {
          const action = extractAction(input, x);
          // Mirrors core: only a `rev` extract has a `needId` at all (contract §12.9's `checkExtracts`).
          const isBlocking = x.type === 'rev' && x.state === null && x.needId !== null && blockingNeedIds.includes(x.needId);
          return (
            <div
              key={x.id}
              className={`xc${x.state ? ` ${x.state}` : ''}`}
              data-testid="in-x"
              data-x={x.id}
              data-state={x.state ?? 'open'}
              onMouseEnter={() => onHover(x.id)}
              onMouseLeave={() => onHover(null)}
            >
              <div className="row gap6">
                {/* The need code never follows a mark (guards: marksBeforeCodes): the chip comes first, the type Pill after it. */}
                {x.type === 'rev' && x.needId && <NeedChip projectId={input.projectId} needId={x.needId} />}
                <Pill tone={EXTRACT_TONE[x.type]}>{t(`in.x.${x.type}` as MessageKey)}</Pill>
              </div>
              <div className="xc-t">{noDots(x.text)}</div>
              {action === 'open' && (
                <div className="row gap6">
                  <Btn kind="primary" testId="in-x-accept" onClick={() => onAccept(x)}>
                    {t('in.accept')}
                  </Btn>
                  <Btn testId="in-x-ignore" onClick={() => onIgnore(x)}>
                    {t('in.ignore')}
                  </Btn>
                </div>
              )}
              {action === 'decide' && (
                <div className="row gap6 wrap">
                  <span className="small tone-warning">{t('in.conflict')}</span>
                  <Btn testId="in-x-decide" onClick={onDecide}>
                    {t('in.decide')}
                  </Btn>
                </div>
              )}
              {action === 'accepted' && (
                <div className="small faint row gap6">
                  <span>{t('in.accepted')}</span>
                  {x.resultNeedId && <NeedChip projectId={input.projectId} needId={x.resultNeedId} />}
                </div>
              )}
              {action === 'ignored' && <div className="small faint">{t('in.ignored')}</div>}
              {isBlocking && (
                <div className="small tone-neutral" data-testid="in-x-blocking">
                  {t('in.decideHint')}
                </div>
              )}
            </div>
          );
        })
      )}
      <div className="in-x-footer small faint row gap6">
        {input?.detector.startsWith('deepseek') ? (
          <>
            <span className="ai tone-ai">{t('ai.deepseek')}</span>
            <span>{t('in.deepseek')}</span>
          </>
        ) : (
          <>
            <RulesMark />
            <span>{t('in.rules')}</span>
          </>
        )}
      </div>
    </div>
  );
}
