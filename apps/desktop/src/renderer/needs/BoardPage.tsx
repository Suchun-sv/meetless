import { useState } from 'react';
import { projectRounds, SEP, toConfirm, type Id, type NeedKind } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { Btn } from '../ui/primitives';
import { Timeline } from '../ui/Timeline';
import { Lineage } from './Lineage';
import { boardColumns, boardViewFor, cardFacts, pendingNeedIds, type BoardColumn, type BoardView } from './model';
import { NeedCard } from './NeedCard';
import { leftText } from '../dash/model';
import { NewNeedModal } from './NewNeedModal';
import './needs.css';

/** `id` is the stable test-id suffix (U2 test ids: `board-filter-all|ext|hyp`). */
const KIND_CHIPS: readonly [kind: NeedKind | null, key: MessageKey, id: string][] = [
  [null, 'filter.all', 'all'],
  ['ext', 'filter.ext', 'ext'],
  ['hyp', 'filter.hyp', 'hyp'],
];

/** One board column: its round header (or `col.unscheduled`), its live cards, and its refuted ones apart. */
function BoardColumnView({ col, pending, selectedNeedId }: { col: BoardColumn; pending: ReadonlySet<Id>; selectedNeedId: Id | null }) {
  const { live, me, t, fmtDay } = useApp();
  const card = (n: (typeof col.live)[number]) => <NeedCard key={n.id} need={n} facts={cardFacts(live, n, me, pending)} selected={n.id === selectedNeedId} />;
  return (
    <section className={`col${col.round ? ` col-${col.round.status}` : ''}`} data-testid="board-col" data-round={col.round?.n ?? ''} data-status={col.status ?? ''}>
      <div className="col-h">
        {col.round ? (
          <>
            <strong>{col.round.title || t('round', { n: col.round.n })}</strong>
            <div className="col-sub">
              <span>{fmtDay(col.round.due) + (col.round.status === 'delivered' ? SEP + t('round.delivered') : '')}</span>
              {col.daysLeft !== null && <span className="left">{SEP + leftText(t, col.daysLeft)}</span>}
            </div>
          </>
        ) : col.status ? (
          <strong>{t(`col.${col.status}` as MessageKey)}</strong>
        ) : (
          <strong>{t('col.unscheduled')}</strong>
        )}
      </div>
      {col.live.length === 0 && col.refuted.length === 0 && <div className="faint small pad">{t('col.empty')}</div>}
      {col.live.map(card)}
      {col.refuted.length > 0 && (
        <details className="refuted">
          <summary>{t('col.refuted', { n: col.refuted.length })}</summary>
          {col.refuted.map(card)}
        </details>
      )}
    </section>
  );
}

/**
 * The needs board (needs3/board.jsx `Board` + `app.jsx`'s board view bar): a round timeline,
 * the rounds/lineage switch, the kind and round filters, one column per round (plus a
 * trailing Unscheduled column), and the composer.
 */
export function BoardPage({ composer }: PageProps) {
  const { live, me, today, t, route } = useApp();
  const routeProjectId = 'projectId' in route ? route.projectId : null;
  // Hooks first, before any early return. The view state belongs to one project: a move to
  // another board starts from the defaults again (`boardViewFor`).
  const [stored, setStored] = useState<BoardView>(() => boardViewFor({ projectId: null, mode: 'rounds', kind: null, round: null }, routeProjectId));
  const [newOpen, setNewOpen] = useState(false);
  if (routeProjectId === null || !('projectId' in route)) return null;
  const projectId = routeProjectId;
  const view = boardViewFor(stored, projectId);
  const { mode, kind, round } = view;
  const setView = (patch: Partial<BoardView>) => setStored({ ...view, ...patch });
  const setMode = (m: BoardView['mode']) => setView({ mode: m });
  const setKind = (k: NeedKind | null) => setView({ kind: k });
  const setRound = (r: number | null) => setView({ round: r });

  const pending = pendingNeedIds(toConfirm(live, me, projectId, today));
  const cols = boardColumns(live, projectId, { kind, round }, today);
  const noRounds = projectRounds(live, projectId).length === 0;
  const selectedNeedId = route.needId ?? null;

  return (
    <div className="board-v" data-testid="page-board">
      <Timeline projectId={projectId} selected={round} onSelect={setRound} />
      <div className="bar">
        <div className="seg">
          {(['rounds', 'lineage'] as const).map((m) => (
            <button key={m} type="button" data-testid={`board-mode-${m}`} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)}>
              {t(`view.${m}`)}
            </button>
          ))}
        </div>
        <div className="row gap6 wrap">
          {KIND_CHIPS.map(([k, key, id]) => (
            <button key={key} type="button" data-testid={`board-filter-${id}`} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              {t(key)}
            </button>
          ))}
          {round !== null && (
            <button type="button" className="chip on" data-testid="board-round-clear" onClick={() => setRound(null)}>
              {`${t('round', { n: round })} ×`}
            </button>
          )}
          <Btn testId="board-new" onClick={() => setNewOpen(true)}>
            {t('board.new')}
          </Btn>
        </div>
      </div>
      {mode === 'rounds' ? (
        <>
          {noRounds && <p className="faint small">{t('board.noRounds')}</p>}
          <div className="cols">
            {cols.map((col) => (
              <BoardColumnView key={col.round?.id ?? col.status ?? 'unscheduled'} col={col} pending={pending} selectedNeedId={selectedNeedId} />
            ))}
          </div>
        </>
      ) : (
        <Lineage projectId={projectId} />
      )}
      {composer()}
      {newOpen && <NewNeedModal projectId={projectId} onClose={() => setNewOpen(false)} />}
    </div>
  );
}
