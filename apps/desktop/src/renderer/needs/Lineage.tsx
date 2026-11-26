import { useState } from 'react';
import { SEP, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { requesterLabel } from '../inputs/model';
import { NeedChip, Pill, Status } from '../ui/primitives';
import { FLOW_FILTERS, flowSections, type FlowFilter, type FlowItem, type FlowNode } from './lineage';
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

function Node({ projectId, node }: { projectId: Id; node: FlowNode }) {
  const { live, t, fmtDay } = useApp();
  const [open, setOpen] = useState(false);
  const who = requesterLabel(live, node.from);
  const facts = [node.date ? fmtDay(node.date) : t('lin.pending'), who].filter(Boolean).join(SEP);
  return (
    <div className="lin-node" data-testid="lin-node" data-type={node.type}>
      <button type="button" className="lin-node-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Pill tone={node.type === 'proposal' ? 'ai' : 'neutral'}>{t(`lin.type.${node.type}` as MessageKey)}</Pill>
        {node.ai && node.type !== 'proposal' && <Pill tone="ai">{t('ai.deepseek')}</Pill>}
        <span className="small faint">{facts}</span>
        {node.title && <strong className="lin-node-t">{node.title}</strong>}
        <span className="grow" />
        <span className="small faint">{t('lin.made', { n: node.items.length })}</span>
      </button>
      {open && (
        <div className="lin-orig" data-testid="lin-original">
          {node.original.length ? node.original.map((p, i) => <p key={i}>{p}</p>) : <p className="faint">{t('common.none')}</p>}
        </div>
      )}
      {node.items.length > 0 && (
        <ul className="tree">
          {node.items.map((it, i) => (
            <ItemRow key={i} projectId={projectId} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The Lineage tab: a time flow of where the project's needs came from. Sections by round (newest
 * first, then 「其他」), source nodes newest first, each with what it produced; a type filter on top.
 */
export function Lineage({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay } = useApp();
  const [filter, setFilter] = useState<FlowFilter>('all');
  const sections = flowSections(live, projectId, filter);
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
      {sections.length === 0 && <p className="muted small">{t('lin.none')}</p>}
      {sections.map((sec) => (
        <section key={sec.round?.id ?? 'other'} className="lin-sec">
          <h3 className="lin-sec-h">{sec.round ? `${t('round', { n: sec.round.n })} ${sec.round.title} ${fmtDay(sec.round.start)} – ${fmtDay(sec.round.due)}` : t('lin.other')}</h3>
          {sec.nodes.map((n) => (
            <Node key={n.key} projectId={projectId} node={n} />
          ))}
        </section>
      ))}
    </div>
  );
}
