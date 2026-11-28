import { currentRound, daysBetween, noDots, type Id, type IsoDate, type Need, type NeedStatus, type SourceKind, type State } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import { requesterLabel } from '@renderer/inputs/model';
import type { Target } from '../../chat/model/target';
import type { IconName } from '../../chat/ui/icons';
import { clientName } from './trail';

/*
 * 07 单条需求的来龙去脉 (mobile-v1): one need's story, oldest first: 提出 (its source), each 改版,
 * each 交接, the reported work (same-day reports merged into one step), and a fixed 「现在」.
 */

export interface TrailStep {
  key: string;
  icon: IconName;
  /** Date, scene, who: small grey words. */
  meta: string[];
  what: string;
  quote: string | null;
  why: string | null;
  /** Where the quote opens in full (the input it came from). */
  source: Target | null;
  /** A handoff's ask folds; tapping the step shows it in full. */
  folds: boolean;
  last?: boolean;
}

export interface NeedTrailView {
  need: Need;
  code: string;
  kind: string;
  title: string;
  status: NeedStatus;
  statusLabel: string;
  version: number;
  owner: string | null;
  steps: TrailStep[];
}

const SRC_ICON: Partial<Record<SourceKind, IconName>> = { meeting: 'users', chat: 'chat', mail: 'mail', doc: 'file', file: 'file', agent: 'bot', commit: 'file', exp: 'file' };

export function needTrail(t: Translator['t'], live: State, projectId: Id, needId: Id, today: IsoDate, fmtDay: (d: IsoDate) => string): NeedTrailView | null {
  const n = live.needs[needId];
  if (!n || n.projectId !== projectId) return null;
  const who = (id: Id) => noDots(live.users[id]?.displayName ?? id);
  const inputTarget = (inputId?: Id): Target | null => (inputId && live.inputs[inputId] ? { kind: 'input', projectId, inputId } : null);
  const dated: (TrailStep & { date: IsoDate; seq: number })[] = [];

  // 提出, 第 1 版: the source's words, and what counts as done (or the expected effect for a hypothesis).
  const by = requesterLabel(live, n.requester);
  dated.push({
    key: 'raised',
    date: n.source.date,
    seq: n.createdSeq,
    icon: SRC_ICON[n.source.src] ?? 'file',
    meta: [fmtDay(n.source.date), noDots(n.source.ref), by ?? ''].filter(Boolean),
    what: t('lnv.raised'),
    quote: n.source.quote ? `“${noDots(n.source.quote)}”` : null,
    why: n.accept ? t('lnv.accept', { text: noDots(n.accept) }) : n.expect ? t('lnv.expect', { text: noDots(n.expect) }) : null,
    source: inputTarget(n.source.inputId),
    folds: false,
  });

  for (const r of n.revisions) {
    const input = r.inputId ? live.inputs[r.inputId] : undefined;
    dated.push({
      key: `rev-${r.id}`,
      date: r.date,
      seq: r.seq,
      icon: input?.scene === 'chat' ? 'chat' : input?.scene === 'mail' ? 'mail' : input?.scene === 'meeting' ? 'users' : 'file',
      meta: [fmtDay(r.date), input ? noDots(input.title) : '', who(r.by)].filter(Boolean),
      what: t('lnv.revised', { v: r.version, text: noDots(r.text) }),
      quote: r.why ? `“${noDots(r.why)}”` : null,
      why: null,
      source: inputTarget(r.inputId),
      folds: false,
    });
  }

  for (const h of Object.values(live.handoffs)) {
    if (h.needId !== needId) continue;
    const at = h.history[0]?.at.slice(0, 10) ?? today;
    dated.push({
      key: `ho-${h.id}`,
      date: at,
      seq: h.createdSeq,
      icon: 'swap',
      meta: [fmtDay(at), t('lnv.ev.handoff', { from: who(h.fromId), to: who(h.toId) })],
      what: t('lnv.handoff'),
      quote: null,
      why: noDots(h.ask),
      source: null,
      folds: true,
    });
  }

  // Reported work: one step per day and reporter; several on one day read 「回报 N 次」.
  const reports = new Map<string, { date: IsoDate; seq: number; by: Id; via: string | null; texts: string[] }>();
  for (const w of Object.values(live.work)) {
    if (w.needId !== needId || w.capture || w.ignored) continue;
    const k = `${w.date}|${w.by}`;
    const cur = reports.get(k) ?? { date: w.date, seq: w.seq, by: w.by, via: w.via?.client ? clientName(w.via.client) : null, texts: [] };
    cur.texts.push(noDots(w.text));
    cur.seq = Math.max(cur.seq, w.seq);
    reports.set(k, cur);
  }
  for (const [k, r] of reports) {
    dated.push({
      key: `wk-${k}`,
      date: r.date,
      seq: r.seq,
      icon: 'bot',
      meta: [fmtDay(r.date), r.via ? t('lnv.via', { who: who(r.by), via: r.via }) : who(r.by)],
      what: r.texts.length > 1 ? t('lnv.reportN', { n: r.texts.length }) : t('lnv.reported'),
      quote: `“${r.texts.join('\n')}”`,
      why: null,
      source: null,
      folds: false,
    });
  }

  dated.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  // 现在: the status, and how far the need's deadline is.
  const statusLabel = t(`st.${n.status}` as MessageKey);
  const round = n.roundId ? live.rounds[n.roundId] : currentRound(live, projectId);
  const left = round ? daysBetween(today, round.due) : null;
  const title = round ? noDots(round.title) || t('round', { n: round.n }) : '';
  const steps: TrailStep[] = [
    ...dated,
    {
      key: 'now',
      icon: 'flag',
      meta: [t('lnv.now')],
      what: statusLabel,
      quote: null,
      why: round && left !== null ? (left >= 0 ? t('lnv.left', { round: title, n: left }) : t('lnv.over', { round: title, n: -left })) : null,
      source: null,
      folds: false,
      last: true,
    },
  ];

  return {
    need: n,
    code: n.code,
    kind: t(`kind.${n.kind}` as MessageKey),
    title: noDots(n.title),
    status: n.status,
    statusLabel,
    version: n.revisions.length ? n.revisions[n.revisions.length - 1]!.version : 1,
    owner: n.ownerId ? who(n.ownerId) : null,
    steps,
  };
}
