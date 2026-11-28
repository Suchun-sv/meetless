import { myProjectIds, toConfirm, type Id, type State } from '@meetless/core';

/** One material awaiting confirmation (mobile-v2: 「一份材料」 is the unit, not an item). */
export interface PendingMaterial {
  key: string;
  kind: 'input' | 'proposal' | 'question';
  /** The source input for extracts and conflicts. */
  inputId: Id | null;
  projectIds: Id[];
  /** Items inside it waiting for a decision. */
  items: number;
}

/**
 * Materials awaiting the user's confirmation across their projects (mobile-v2 decision 3): the
 * 「需求」 tab badge and 我的's 「N 份材料待确认」 use this one number. Pending extracts and conflicts
 * group by their source input; each Agent proposal is one material (decision 5); each question
 * (unlinked work, stale need) counts as one. Inbox materials of the user's own scope join here once
 * the server's inbox lands in core.
 */
export function pendingMaterials(s: State, me: Id, today: string): PendingMaterial[] {
  const by = new Map<string, PendingMaterial>();
  const add = (key: string, base: Omit<PendingMaterial, 'key' | 'projectIds' | 'items'>, projectId: Id) => {
    const m = by.get(key) ?? { key, ...base, projectIds: [], items: 0 };
    m.items += 1;
    if (!m.projectIds.includes(projectId)) m.projectIds.push(projectId);
    by.set(key, m);
  };
  for (const pid of myProjectIds(s, me)) {
    const tc = toConfirm(s, me, pid, today);
    for (const x of tc.extracts) add(`in:${x.inputId}`, { kind: 'input', inputId: x.inputId }, pid);
    for (const c of tc.conflicts) add(c.inputId ? `in:${c.inputId}` : `cf:${c.id}`, { kind: 'input', inputId: c.inputId ?? null }, pid);
    for (const p of tc.proposals) add(`pr:${p.id}`, { kind: 'proposal', inputId: null }, pid);
    for (const q of tc.questions) add(`q:${q.kind}:${q.kind === 'unlinked' ? q.workId : q.needId}`, { kind: 'question', inputId: null }, pid);
  }
  return [...by.values()];
}

export function pendingMaterialCount(s: State, me: Id, today: string): number {
  return pendingMaterials(s, me, today).length;
}
