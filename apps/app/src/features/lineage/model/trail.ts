import { clip, noDots, type Id, type IsoDate, type State } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import { requesterLabel } from '@renderer/inputs/model';
import { flowNodes, type FlowItem, type FlowNode } from '@renderer/needs/lineage';
import type { Target } from '../../chat/model/target';
import type { IconName } from '../../chat/ui/icons';

/*
 * 06 项目›脉络 on phones (mobile-v1): one scene per source, newest first. Each scene has a line
 * icon and kind label, title, date, a one-line summary and what it produced as 「编号 + 小动词」.
 * Reported work joins as 「Agent 回报」 scenes. Tapping folds the original quote open inline.
 */

export type TrailKind = FlowNode['type'] | 'report';

export interface TrailOut {
  key: string;
  code: string | null;
  verb: string;
  target: Target | null;
}

export interface TrailScene {
  key: string;
  kind: TrailKind;
  icon: IconName;
  label: string;
  date: IsoDate | null;
  title: string;
  summary: string | null;
  outs: TrailOut[];
  /** Outs past the first 3 when there are more than 4. */
  more: number;
  /** The original words (first paragraphs) and who said them; tapping the quote opens the full source. */
  quote: string | null;
  ref: string | null;
  source: Target | null;
  seq: number;
}

const ICON: Record<TrailKind, IconName> = {
  meeting: 'users',
  mail: 'mail',
  chat: 'chat',
  agent: 'bot',
  doc: 'file',
  handwritten: 'pen',
  delivery: 'package',
  proposal: 'sparkles',
  manual: 'pen',
  report: 'bot',
};

/** 「编号 + 小动词」 for one produced item. */
function out(t: Translator['t'], live: State, projectId: Id, node: FlowNode, it: FlowItem, i: number): TrailOut | null {
  const need = (id: Id) => live.needs[id];
  const target = (id: Id): Target => ({ kind: 'need', projectId, needId: id });
  switch (it.kind) {
    case 'need': {
      const n = need(it.needId);
      if (!n) return null;
      const verb = n.status === 'refuted' ? t('lnv.out.refuted') : n.kind === 'hyp' ? t('lnv.out.hyp') : t('lnv.out.new');
      return { key: `${i}`, code: n.code, verb, target: target(n.id) };
    }
    case 'rev': {
      const n = need(it.needId);
      if (!n) return null;
      const inputId = node.key.startsWith('in:') ? node.key.slice(3) : null;
      const r = inputId ? n.revisions.find((x) => x.inputId === inputId) : undefined;
      return { key: `${i}`, code: n.code, verb: r ? t('lnv.out.revV', { v: r.version }) : t('lnv.out.rev'), target: target(n.id) };
    }
    case 'decision': {
      const n = need(it.needId);
      if (!n) return null;
      return { key: `${i}`, code: n.code, verb: t(`lin.dec.${it.resolution}` as MessageKey), target: target(n.id) };
    }
    case 'action':
      return { key: `${i}`, code: null, verb: noDots(it.text), target: null };
    case 'pending':
      return { key: `${i}`, code: null, verb: t('lnv.out.pending', { type: t(`in.x.${it.type}`), text: clip(noDots(it.text), 16) }), target: { kind: 'confirm', projectId } };
  }
}

function sceneOf(t: Translator['t'], live: State, projectId: Id, node: FlowNode): TrailScene {
  const all = node.items.map((it, i) => out(t, live, projectId, node, it, i)).filter((x): x is TrailOut => x !== null);
  const outs = all.length > 4 ? all.slice(0, 3) : all;
  const inputId = node.key.startsWith('in:') ? node.key.slice(3) : null;
  const quote = node.original.filter((p) => p.trim()).slice(0, 3).join('\n') || null;
  const who = requesterLabel(live, node.from);
  return {
    key: node.key,
    kind: node.type,
    icon: ICON[node.type],
    label: t(`lin.type.${node.type}` as MessageKey),
    date: node.date,
    title: noDots(node.title) || t(`lin.type.${node.type}` as MessageKey),
    summary: node.gist ? noDots(node.gist) : null,
    outs,
    more: all.length - outs.length,
    quote: quote ? noDots(quote) : null,
    ref: who,
    source: inputId ? { kind: 'input', projectId, inputId } : null,
    seq: node.seq,
  };
}

/** Reported work as 「Agent 回报」 scenes: who (and through which agent), the report, the need it moved. */
function reportScenes(t: Translator['t'], live: State, projectId: Id): TrailScene[] {
  const out: TrailScene[] = [];
  for (const w of Object.values(live.work)) {
    if (w.projectId !== projectId || w.capture || w.ignored) continue;
    const who = noDots(live.users[w.by]?.displayName ?? w.by);
    const via = w.via?.client ? clientName(w.via.client) : null;
    const n = w.needId ? live.needs[w.needId] : undefined;
    out.push({
      key: `wk:${w.id}`,
      kind: 'report',
      icon: 'bot',
      label: t('lnv.type.report'),
      date: w.date,
      title: via ? t('lnv.report', { who, via }) : t('lnv.reportBy', { who }),
      summary: noDots(w.text),
      outs: n ? [{ key: '0', code: n.code, verb: t('lnv.out.work'), target: { kind: 'need', projectId, needId: n.id } }] : [],
      more: 0,
      quote: w.why ? noDots(w.why) : null,
      ref: who,
      source: null,
      seq: w.seq,
    });
  }
  return out;
}

/** 'claude-code' reads as Claude Code, 'codex' as Codex. */
export function clientName(c: string): string {
  return c
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/** Every scene of the project, newest first (an undated open proposal counts as newest). */
export function trailScenes(t: Translator['t'], live: State, projectId: Id): TrailScene[] {
  const scenes = [...flowNodes(live, projectId).map((n) => sceneOf(t, live, projectId, n)), ...reportScenes(t, live, projectId)];
  return scenes.sort((a, b) => (b.date ?? '9999').localeCompare(a.date ?? '9999') || b.seq - a.seq);
}
