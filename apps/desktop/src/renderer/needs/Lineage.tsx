import { useState } from 'react';
import { SEP, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { requesterLabel } from '../inputs/model';
import { NeedChip, Pill, Status } from '../ui/primitives';
import { FLOW_FILTERS, flowTimeline, type FlowFilter, type FlowItem, type FlowNode } from './lineage';
import { childrenOf } from './model';

/** A need row: its chip and status, with the needs derived from it nested under a quiet 「衍生」. */
function NeedRow({ projectId, needId, derived = false }: { projectId: Id; needId: Id; derived?: boolean }) {
  const { live, t } = useApp();
  const need = live.needs[needId];
  if (!need) return null;
  const kids = childrenOf(live, needId);
  return (
    <li>
      <div className="lin-row">
        {derived && <span className="small faint">{t('lin.derived')}</span>}
        <NeedChip projectId={projectId} needId={needId} />
        <Status s={need.status} />
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <NeedRow key={k.id} projectId={projectId} needId={k.id} derived />
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemRow({ projectId, item }: { projectId: Id; item: FlowItem }) {
  const { t, openOverlay } = useApp();
  switch (item.kind) {
    case 'need':
      return <NeedRow projectId={projectId} needId={item.needId} />;
    case 'rev':
      return (
        <li className="lin-row">
          <span className="small faint">{t('in.x.rev')}</span>
          <NeedChip projectId={projectId} needId={item.needId} />
          <span className="small">{item.text}</span>
        </li>
      );
    case 'decision':
      return (
        <li className="lin-row">
          <span className="small faint">{t('lin.decision')}</span>
          <NeedChip projectId={projectId} needId={item.needId} />
          <span className="small">{t(`lin.dec.${item.resolution}` as MessageKey)}</span>
        </li>
      );
    case 'action':
      return (
        <li className="lin-row">
          <span className="small faint">{t('in.x.action')}</span>
          <span className="small">{item.text}</span>
        </li>
      );
    case 'pending':
      return (
        <li>
          <button type="button" className="lin-row lin-pending" onClick={() => openOverlay({ kind: 'confirm', projectId })}>
            <span className="small faint">{t(`in.x.${item.type}`)}</span>
            <span className="small">{item.text}</span>
            <span className="small tone-warning">{t('lin.pending')}</span>
          </button>
        </li>
      );
  }
}

/** Expanded scenes per project, for the session. */
const OPEN = new Map<Id, Set<string>>();

/** The first produced item as one line, for a collapsed scene. */
function preview(live: ReturnType<typeof useApp>['live'], it: FlowItem | undefined): string {
  if (!it) return '';
  if (it.kind === 'need' || it.kind === 'rev' || it.kind === 'decision') {
    const n = live.needs[it.needId];
    return n ? `${n.code} ${n.title}` : '';
  }
  return it.text;
}

/** A scene card: always shown; what it produced folds open on a click, its original text behind 「原文」. */
function Scene({ projectId, node }: { projectId: Id; node: FlowNode }) {
  const { live, t } = useApp();
  const set = OPEN.get(projectId) ?? new Set<string>();
  OPEN.set(projectId, set);
  const [open, setOpen] = useState(set.has(node.key));
  const [orig, setOrig] = useState(false);
  const who = requesterLabel(live, node.from);
  const toggle = () => {
    if (open) set.delete(node.key);
    else set.add(node.key);
    setOpen(!open);
  };
  return (
    <div className={`lin-card${open ? ' open' : ''}`} data-testid="lin-node" data-type={node.type}>
      <button type="button" className="lin-card-h" aria-expanded={open} onClick={toggle}>
        <span className="lin-card-top">
          <Pill tone={node.type === 'proposal' ? 'ai' : 'neutral'}>{t(`lin.type.${node.type}` as MessageKey)}</Pill>
          {node.ai && node.type !== 'proposal' && <Pill tone="ai">{t('ai.deepseek')}</Pill>}
          {node.title && <strong className="lin-node-t">{node.title}</strong>}
        </span>
        <span className="lin-card-m small faint">
          {[who, t('lin.made', { n: node.items.length })].filter(Boolean).join(SEP)}
          {!open && node.items.length > 0 && <span className="lin-prev">{SEP + preview(live, node.items[0])}</span>}
        </span>
      </button>
      {open && (
        <div className="lin-card-b">
          {node.items.length > 0 && (
            <ul className="tree">
              {node.items.map((it, i) => (
                <ItemRow key={i} projectId={projectId} item={it} />
              ))}
            </ul>
          )}
          <button type="button" className="link small" data-testid="lin-orig" aria-expanded={orig} onClick={() => setOrig((v) => !v)}>
            {t('lin.original')}
          </button>
          {orig && (
            <div className="lin-orig" data-testid="lin-original">
              {node.original.length ? node.original.map((p, i) => <p key={i}>{p}</p>) : <p className="faint">{t('common.none')}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Lineage tab as a vertical timeline, newest at the top: a line on the left, each source a card
 * attached to it by a short tick with its date on the left; DDL due dates as diamonds on the line,
 * and today as a short labelled rule across it. A type filter on top.
 */
export function Lineage({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay, today } = useApp();
  const [filter, setFilter] = useState<FlowFilter>('all');
  const entries = flowTimeline(live, projectId, filter, today);
  const sources = entries.some((e) => e.kind === 'node');
  return (
    <div className="lineage" data-testid="lineage">
      <div className="lin-top">
        <h2>{t('lin.title')}</h2>
        <div className="seg lin-filter" role="group">
          {FLOW_FILTERS.map((f) => (
            <button key={f} type="button" className={f === filter ? 'on' : undefined} data-testid={`lin-f-${f}`} onClick={() => setFilter(f)}>
              {t(`lin.f.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {!sources && <p className="muted small">{t('lin.none')}</p>}
      <ol className="lin-line">
        {entries.map((e) =>
          e.kind === 'today' ? (
            <li key="today" className="lin-e lin-today" data-testid="lin-today">
              <span className="lin-date">{t('tl.today')}</span>
              <span className="lin-rail" />
            </li>
          ) : e.kind === 'ddl' ? (
            <li key={`ddl-${e.round.id}`} className="lin-e lin-ddl" data-testid="lin-ddl">
              <span className="lin-date">{fmtDay(e.date)}</span>
              <span className="lin-rail">
                <span className={`lin-ms s-${e.round.status}`} />
              </span>
              <span className="lin-ddl-t">{t('lin.ddl', { title: e.round.title || t('round', { n: e.round.n }), d: fmtDay(e.round.due) })}</span>
            </li>
          ) : (
            <li key={e.node.key} className="lin-e lin-src">
              <span className="lin-date">{e.node.date ? fmtDay(e.node.date) : t('lin.pending')}</span>
              <span className="lin-rail lin-tick" />
              <Scene projectId={projectId} node={e.node} />
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
