import { chatMessages, clip, handoffStaleness, noDots, SEP, type AgentReply, type Id, type IsoDate, type NeedStatus, type State } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import { addedState } from './added';
import { importPriv, replyLabel } from './chat';
import { materialTarget, type Target } from './target';

/*
 * The project agent's reply as plain blocks, by `reply.answer.intent` (desktop `chat/Reply.tsx`).
 * Everything comes from `live`, not the frozen reply alone: a cite that is gone (deleted, or now
 * private to someone else) is skipped rather than shown broken. A screen renders the blocks in
 * order and maps each action onto a tap.
 */

/** A tap in a reply. `open` routes; the rest the screen runs (accept-all needs A2's accept commands). */
export type ReplyAction =
  | { kind: 'open'; target: Target }
  | { kind: 'acceptAll'; inputId: Id }
  | { kind: 'import'; projectId: Id; messageId: Id; text: string; priv: boolean }
  | { kind: 'remind'; handoffId: Id };

export type ReplyBlock =
  /** A line of the answer. `gen`: prose the model wrote. `small`/`faint`: a detail line. */
  | { kind: 'text'; text: string; gen?: boolean; small?: boolean; faint?: boolean }
  /** A row of need chips (code and title, tap opens the need). */
  | { kind: 'needs'; projectId: Id; needIds: Id[] }
  /** A need chip with the matched fields under it (rule retrieval). */
  | { kind: 'hits'; projectId: Id; needId: Id; lines: string[] }
  /** A cited input or artifact: chip label, the matched window under it. */
  | { kind: 'material'; materialKind: 'input' | 'artifact'; id: Id; label: string; text: string; target: Target }
  /** A need chip with its status as coloured text. */
  | { kind: 'status'; projectId: Id; needId: Id; status: NeedStatus }
  /** One tappable line. */
  | { kind: 'action'; label: string; action: ReplyAction; testId?: string }
  /** Several tappable links in one row. */
  | { kind: 'actions'; items: { label: string; action: ReplyAction; testId?: string }[] }
  /** A stale handoff: its line, then 「提醒刷新」 or the reminded note. */
  | { kind: 'stale'; text: string; handoffId: Id; reminded: boolean };

export interface ReplyContext {
  t: Translator['t'];
  live: State;
  me: Id;
  today: IsoDate;
  fmtDay: (d: IsoDate) => string;
  scope: 'home' | Id;
  messageId: Id;
  /** Whether the scope's own dashboard is on screen (no 「打开看板」 then). */
  onDash: boolean;
}

const name = (s: State, id: Id | null | undefined) => (id ? noDots(s.users[id]?.displayName ?? id) : '');

export function replyBlocks(reply: AgentReply, c: ReplyContext): ReplyBlock[] {
  const { t, live } = c;
  const a = reply.answer;
  const code = (id: Id | null) => (id ? live.needs[id]?.code ?? '' : '');
  const text = (s: string, o: Omit<Extract<ReplyBlock, { kind: 'text' }>, 'kind' | 'text'> = {}): ReplyBlock => ({ kind: 'text', text: s, ...o });

  switch (a.intent) {
    case 'retrieval': {
      const groups = a.needs.filter((g) => live.needs[g.needId]);
      const materials = a.materials.filter((m) => (m.kind === 'input' ? live.inputs[m.id] : live.artifacts[m.id]));
      const gen = a.text !== undefined;
      const out: ReplyBlock[] = [gen ? text(a.text!, { gen: true }) : text(t('ans.found'))];
      if (gen && groups.length > 0) {
        // Cites may span projects only on Home; group them per project so each chip row opens in its own.
        const byProject = new Map<Id, Id[]>();
        for (const g of groups) {
          const pid = live.needs[g.needId]!.projectId;
          byProject.set(pid, [...(byProject.get(pid) ?? []), g.needId]);
        }
        for (const [projectId, needIds] of byProject) out.push({ kind: 'needs', projectId, needIds });
      }
      if (!gen) {
        for (const g of groups) {
          const n = live.needs[g.needId]!;
          out.push({ kind: 'hits', projectId: n.projectId, needId: n.id, lines: g.hits.slice(0, 2).map((h) => `${t(`ans.f.${h.field}` as MessageKey)}${SEP}${clip(noDots(h.text), 140)}`) });
        }
      }
      if (materials.length > 0) {
        out.push(text(t('ans.materials'), { small: true, faint: true }));
        for (const m of materials) {
          const kind = t(m.kind === 'input' ? 'nav.inputs' : 'nav.artifacts');
          const page = m.kind === 'artifact' && m.page != null ? `${SEP}${t('ans.f.page')}${SEP}${m.page + 1}` : '';
          out.push({ kind: 'material', materialKind: m.kind, id: m.id, label: `${kind}${SEP}${clip(noDots(m.title), 60)}${page}`, text: noDots(m.text), target: materialTarget(m) });
        }
      }
      return out;
    }

    case 'summary': {
      if (a.projectId === null) return [text(t('ans.summaryHome', { p: a.projects }))];
      if (a.round) {
        const round = t('round', { n: live.rounds[a.round.roundId]?.n ?? 0 });
        return [text(t('ans.summary', { round, d: a.round.daysLeft, doing: a.counts.doing, todo: a.counts.todo, met: a.counts.met }))];
      }
      return [text(t('ans.summaryNoRound', { doing: a.counts.doing, todo: a.counts.todo, met: a.counts.met }))];
    }

    case 'today': {
      const items = a.items.filter((it) => it.needId === null || live.needs[it.needId]);
      if (items.length === 0) return [text(t('ans.today.none'))];
      const out: ReplyBlock[] = [text(t('ans.today'))];
      for (const it of items) {
        const confirm: ReplyAction = { kind: 'open', target: { kind: 'confirm', projectId: it.projectId } };
        const need: ReplyAction | null = it.needId ? { kind: 'open', target: { kind: 'need', projectId: it.projectId, needId: it.needId } } : null;
        const h = live.handoffs[it.id];
        switch (it.kind) {
          case 'conflict':
            out.push({ kind: 'action', label: t('ans.today.conflict', { need: code(it.needId) }), action: confirm });
            break;
          case 'proposal':
            out.push({ kind: 'action', label: t('ans.today.proposal'), action: confirm });
            break;
          case 'confirm':
            out.push({ kind: 'action', label: t('ans.today.confirm'), action: confirm });
            break;
          case 'toMe':
            if (need) out.push({ kind: 'action', label: t('ans.today.toMe', { need: code(it.needId), who: h ? name(live, h.fromId) : '' }), action: need });
            break;
          case 'stale':
            if (need) out.push({ kind: 'action', label: t('ans.today.stale', { need: code(it.needId), who: h ? name(live, h.toId) : '' }), action: need });
            break;
          case 'mine':
            if (need) out.push({ kind: 'action', label: t('ans.today.mine', { need: code(it.needId) }), action: need });
            break;
        }
      }
      return out;
    }

    case 'deadlines': {
      if (a.items.length === 0) return [text(t('ans.deadlinesNone'))];
      return [
        text(t('ans.deadlines')),
        ...a.items.map((it) => {
          const round = live.rounds[it.roundId];
          const p = noDots(live.projects[it.projectId]?.name ?? '');
          const left = it.daysLeft >= 0 ? t('round.left', { n: it.daysLeft }) : t('round.over', { n: -it.daysLeft });
          return text(t('ans.deadline', { p, round: noDots(round?.title ?? '') || t('round', { n: round?.n ?? 0 }), d: round ? c.fmtDay(round.due) : '', left }), { small: true });
        }),
      ];
    }

    case 'weekly': {
      if (a.people.length === 0) return [text(t('ans.weeklyNone'))];
      return [text(t('ans.weekly')), ...a.people.map((p) => text(t('ans.weeklyRow', { who: name(live, p.userId), n: p.count, text: clip(noDots(p.text), 80) }), { small: true }))];
    }

    case 'delivery': {
      const lines = a.lines.filter((l) => live.needs[l.needId]);
      if (lines.length === 0) return [text(t('ans.deliveryNone'))];
      const round = t('round', { n: live.rounds[a.roundId ?? '']?.n ?? 0 });
      return [text(t('ans.delivery', { round })), ...lines.map((l): ReplyBlock => ({ kind: 'status', projectId: live.needs[l.needId]!.projectId, needId: l.needId, status: l.status }))];
    }

    case 'addCard': {
      const out: ReplyBlock[] = [text(t('ch.cardOn', { name: t(`w.${a.card}`) }))];
      if (!c.onDash) out.push({ kind: 'action', label: t('ch.openDash'), action: { kind: 'open', target: { kind: 'dash', scope: c.scope } } });
      return out;
    }

    case 'added': {
      const st = addedState(live, a.inputId);
      const allNew = a.items.length > 0 && a.items.every((x) => x.type === 'new');
      const head = a.items.length === 0 ? t('ans.added.none') : allNew ? t('ans.added.new', { n: a.items.length }) : t('ans.added', { n: a.items.length });
      const out: ReplyBlock[] = [text(head)];
      for (const it of a.items) {
        const rev = it.type === 'rev' && it.needId ? `${SEP}${code(it.needId)}` : '';
        out.push(text(`${t(`in.x.${it.type}`)}${rev}${SEP}${noDots(it.text)}`, { small: true }));
      }
      if (st.pending.length > 0) {
        const items: Extract<ReplyBlock, { kind: 'actions' }>['items'] = [];
        if (st.bulk.length > 0) items.push({ label: t('ans.added.acceptAll'), action: { kind: 'acceptAll', inputId: a.inputId }, testId: 'added-accept-all' });
        items.push({ label: t('ans.added.review'), action: { kind: 'open', target: { kind: 'confirm', projectId: a.projectId } }, testId: 'added-review' });
        out.push({ kind: 'actions', items });
      } else if (a.items.length > 0 && st.input) {
        out.push(text(t('ans.added.done'), { small: true, faint: true }));
      }
      return out;
    }

    case 'asInput': {
      if (c.scope === 'home') return [text(t('ch.asInput'))];
      // The privacy the text was sent under, never the switch now (ruling R21); private with no record.
      const priv = importPriv(c.messageId);
      const msg = chatMessages(live, c.me, c.scope).find((m) => m.id === c.messageId)?.text ?? '';
      return [
        text(t('ch.asInput')),
        { kind: 'action', label: t('ch.importTo', { v: t(priv ? 'pv.only' : 'pv.project') }), action: { kind: 'import', projectId: c.scope, messageId: c.messageId, text: msg, priv }, testId: 'chat-import' },
      ];
    }

    case 'handoff': {
      const need = a.needId ? live.needs[a.needId] : null;
      const who = a.toId ? live.users[a.toId] : null;
      if (!need || !who) return [text(t('ans.handoffNone'))];
      return [
        text(t('ans.handoff', { need: need.code, who: noDots(who.displayName) })),
        { kind: 'action', label: t('ho.btn'), action: { kind: 'open', target: { kind: 'handoff', projectId: a.projectId, needId: need.id, toId: a.toId } } },
      ];
    }

    case 'stale': {
      const items = a.items.filter((it) => live.needs[it.needId]);
      if (items.length === 0) return [text(t('ans.staleNone'))];
      return [
        text(t('ans.stale', { n: items.length })),
        ...items.map((it): ReplyBlock => {
          const h = live.handoffs[it.handoffId];
          const stale = h ? handoffStaleness(live, h) : null;
          return { kind: 'stale', text: t('ch.staleRow', { need: code(it.needId), who: h ? name(live, h.toId) : '', v: it.fetched, current: it.current }), handoffId: it.handoffId, reminded: !stale || stale.reminded };
        }),
      ];
    }
  }
}

/** One message of the thread, ready to render: the question, the reply blocks, and the violet label under it. */
export interface ThreadItem {
  id: Id;
  question: string;
  blocks: ReplyBlock[];
  source: 'deepseek' | 'rules';
  label: string;
  tip: string;
  note: string;
  at: string;
}

/** The private thread for `scope`, oldest first (one user's own history with the agent; nobody else sees it). */
export function threadItems(c: Omit<ReplyContext, 'messageId'>): ThreadItem[] {
  return chatMessages(c.live, c.me, c.scope).map((m) => {
    const l = replyLabel(m.reply);
    return {
      id: m.id,
      question: m.text,
      blocks: replyBlocks(m.reply, { ...c, messageId: m.id }),
      source: l.generated ? 'deepseek' : 'rules',
      label: c.t(l.label),
      tip: c.t(l.generated ? 'app.deepseekTip' : 'app.rulesTip'),
      note: c.t(l.note),
      at: m.at,
    };
  });
}
