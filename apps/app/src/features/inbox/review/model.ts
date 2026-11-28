/**
 * The inbox review's view model (mobile-v2 B3, B4, B6, B7): the default plan for a material (each
 * item's project, action and due), which screen it opens on, the facts on the suggestion card, the
 * alternatives, and the commit body. Pure, no React or i18n.
 */
import type { CommitBody, InboxItem, IsoDate, ReviewMaterial as InboxMaterial, RoutingCandidate } from './types';

/** A target: an existing project, or the new project the form creates. */
export type Target = { projectId: string } | { newProject: true };
export const NEW: Target = { newProject: true };

export function sameTarget(a: Target, b: Target): boolean {
  return 'newProject' in a ? 'newProject' in b : 'projectId' in b && a.projectId === b.projectId;
}
export function targetKey(t: Target): string {
  return 'newProject' in t ? 'new' : t.projectId;
}

/** What happens to one item: accepted (a conflict applied or kept), merged into its duplicate, or skipped; `null` = not decided yet (B4). */
export type Decision = 'accept' | 'merge' | 'skip' | 'keep' | null;

export interface ItemPlan {
  item: InboxItem;
  target: Target;
  /** The due date as changed in review (`undefined` = the item's own). */
  due?: IsoDate | null;
  decision: Decision;
}

export interface NewProjectForm {
  name: string;
  roundTitle: string;
  due: IsoDate | null;
  quote: string | null;
  reason: string;
  template: string | null;
  /** Items left out of the new project (B7's checkboxes). */
  off: ReadonlySet<string>;
}

export type Mode = 'suggest' | 'split' | 'new';

/** The suggestion: the first routing candidate (none = B7's new project). */
export function suggestion(m: InboxMaterial): RoutingCandidate | null {
  return m.routing?.candidates[0] ?? null;
}

/** Each item's starting target: its own project, else the suggestion, else the new project. */
export function initialPlan(m: InboxMaterial): ItemPlan[] {
  const sug = suggestion(m);
  const first: Target = sug ? { projectId: sug.projectId } : NEW;
  return m.items.map((item) => ({ item, target: item.projectId ? { projectId: item.projectId } : item.projectId === null && m.routing?.newProject ? NEW : first, decision: null }));
}

/** B6 when the items go to more than one place; B7 when everything goes to a new project; else B3. */
export function modeOf(plan: readonly ItemPlan[]): Mode {
  const keys = new Set(plan.map((p) => targetKey(p.target)));
  if (keys.size > 1) return 'split';
  return keys.has('new') ? 'new' : 'suggest';
}

/** The default decision when everything is accepted at once: merge duplicates, apply conflicts, accept the rest. */
export function defaultDecision(i: InboxItem): Exclude<Decision, null> {
  if (i.duplicateOf) return 'merge';
  return 'accept';
}

export interface Facts {
  needs: number;
  hyps: number;
  revs: number;
  /** The earliest due date among the items (or the material's). */
  due: IsoDate | null;
}

export function facts(m: InboxMaterial, items: readonly InboxItem[] = m.items): Facts {
  const dues = items.map((i) => i.conflict?.new ?? i.due ?? null).filter((d): d is IsoDate => !!d).sort();
  return {
    needs: items.filter((i) => i.type === 'need').length,
    hyps: items.filter((i) => i.type === 'hyp').length,
    revs: items.filter((i) => i.type === 'rev').length,
    due: dues[0] ?? m.due?.date ?? null,
  };
}

/** The other existing projects worth offering (「也可能是」): the candidates after the first, at most two. */
export function alternatives(m: InboxMaterial, current: Target): string[] {
  return (m.routing?.candidates ?? [])
    .map((c) => c.projectId)
    .filter((p) => !sameTarget({ projectId: p }, current))
    .slice(0, 2);
}

/** A candidate's reason for `projectId`, with its bold runs (S's `reasonBold`, else need codes). */
export function reasonFor(m: InboxMaterial, projectId: string): { text: string; bold: boolean }[] {
  const c = m.routing?.candidates.find((x) => x.projectId === projectId);
  if (!c?.reason) return [];
  if (!c.reasonBold?.length) return reasonRuns(c.reason);
  const out: { text: string; bold: boolean }[] = [];
  let rest = c.reason;
  while (rest) {
    const hits = c.reasonBold.map((b) => ({ b, at: rest.indexOf(b) })).filter((h) => h.b && h.at >= 0).sort((a, b) => a.at - b.at);
    const h = hits[0];
    if (!h) {
      out.push({ text: rest, bold: false });
      break;
    }
    if (h.at > 0) out.push({ text: rest.slice(0, h.at), bold: false });
    out.push({ text: h.b, bold: true });
    rest = rest.slice(h.at + h.b.length);
  }
  return out;
}

/** The reason line split into plain and bold runs: need codes with their title (N1 批改第 4 次作业) are bold. */
export function reasonRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\b[NH]p?\d+(?:\s[^，。；、,;「」\s][^，。；、,;「」]*?)?(?=\s?(?:是|和|与|的|，|。|；|$))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[0], bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** The new-project form, prefilled from the new-project candidate (or the material). */
export function newProjectForm(m: InboxMaterial): NewProjectForm {
  const np = m.routing?.newProject;
  return {
    name: np?.name ?? m.title,
    roundTitle: np?.firstRound?.title ?? '',
    due: np?.firstRound?.due ?? m.due?.date ?? null,
    quote: np?.firstRound?.quote ?? m.due?.quote ?? null,
    reason: np?.reason ?? '',
    template: np?.template ?? null,
    off: new Set(),
  };
}

/**
 * The commit body: every item with its decision (undecided ones take the default), target, due as
 * changed, merge target and conflict choice; items left out of a new project are skipped. The new
 * project travels only when some item goes to it.
 */
export function commitBody(plan: readonly ItemPlan[], form: NewProjectForm | null): CommitBody {
  const items = plan.map((p) => {
    const d = p.decision ?? defaultDecision(p.item);
    const offNew = 'newProject' in p.target && !!form?.off.has(p.item.id);
    const action: CommitBody['items'][number]['action'] = offNew || d === 'skip' ? 'skip' : d === 'merge' ? 'merge' : 'accept';
    return {
      itemId: p.item.id,
      action,
      target: p.target,
      ...(p.due !== undefined ? { due: p.due } : {}),
      ...(action === 'merge' && p.item.duplicateOf ? { mergeInto: p.item.duplicateOf } : {}),
      ...(p.item.conflict ? { conflict: d === 'keep' ? ('keep' as const) : ('apply' as const) } : {}),
    };
  });
  const toNew = items.some((i) => 'newProject' in i.target && i.action !== 'skip');
  return {
    items,
    ...(toNew && form ? { newProject: { name: form.name.trim(), firstRound: form.roundTitle.trim() && form.due ? { title: form.roundTitle.trim(), due: form.due } : null, template: form.template } } : {}),
  };
}

/** How many items the commit actually takes (not skipped), and into how many places. */
export function takeCounts(body: CommitBody): { items: number; places: number } {
  const taken = body.items.filter((i) => i.action !== 'skip');
  return { items: taken.length, places: new Set(taken.map((i) => targetKey(i.target))).size };
}
