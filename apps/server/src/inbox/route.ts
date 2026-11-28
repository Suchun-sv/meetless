import type { Id, IsoDate, Need, Project, Round, State } from '@meetless/core';
import { currentRound, projectNeeds, projectRounds, readableProjectIds } from '@meetless/core';
import type { InboxItem, InboxRouting } from '@meetless/api';
import type { ProjectAi } from '../agents/deepseek';

/**
 * Stage 2 and 3 of the inbox: which project the items belong to (or a new one), and which of them
 * repeat or contradict a need there. DeepSeek when the server has it (validated against the real
 * projects and needs), else the rules below.
 */

const ROUTE_PROMPT = `You sort work items from one piece of material (an email, a document, a chat, a photo) into the user's projects.
Answer with JSON only:
{"candidates":[{"projectId":"<id>","reason":"<one short Chinese sentence: why it belongs there>","bold":["<keyword or need code quoted in the reason>"]}],
 "newProject":null | {"name":"<short Chinese project name>","reason":"<one Chinese sentence: none of the projects mentions ...>","firstRound":{"title":"<deadline title>","due":"YYYY-MM-DD"|null,"quote":"<source sentence>"|null}},
 "items":[{"id":"<item id>","projectId":"<id>"|null,"duplicateOf":"<need code>"|null,"revises":"<need code>"|null,"dueConflict":"<need code>"|null}]}
Rules:
- candidates: best first, at most 3, only projects whose goal, deadlines or needs clearly match. Empty when none fits.
- newProject: only when no project fits; then candidates is empty and every item's projectId is null.
- items: every item, with its project (items may go to different projects when the material covers several).
- duplicateOf: the item is the same thing as an existing need of its project (same work, maybe other words).
- revises: the item changes an existing need of its project (new detail or scope), not a new piece of work.
- dueConflict: the item names the same work as an existing need of its project but a different deadline than that need's.
- Never invent ids or codes. Reasons in Chinese, short, no dot symbols.`;

interface ProjectBrief {
  project: Project;
  needs: Need[];
  rounds: Round[];
}

function briefs(view: State, userId: Id): ProjectBrief[] {
  return [...readableProjectIds(view, userId)]
    .map((id) => view.projects[id]!)
    .filter((p) => p && !p.archived)
    .map((p) => ({ project: p, needs: projectNeeds(view, p.id).filter((n) => n.privateTo === null || n.privateTo === userId), rounds: projectRounds(view, p.id) }));
}

const dueOf = (view: State, n: Need): IsoDate | null => (n.roundId ? (view.rounds[n.roundId]?.due ?? null) : null);

export interface RouteResult {
  routing: InboxRouting;
  /** Per item: its project and what it repeats, revises or contradicts there. */
  items: InboxItem[];
}

/** Routes `items` among the user's projects; `title`/`summary`/`due` describe the material. */
export async function routeItems(
  ai: ProjectAi | undefined,
  view: State,
  userId: Id,
  material: { title: string; summary: string | null; due: { date: IsoDate; quote: string | null } | null },
  items: InboxItem[],
): Promise<RouteResult> {
  const all = briefs(view, userId);
  if (ai?.enabled && all.length > 0) {
    const r = await byModel(ai, view, userId, all, material, items).catch(() => null);
    if (r) return r;
  }
  return byRules(view, all, material, items);
}

async function byModel(
  ai: ProjectAi,
  view: State,
  userId: Id,
  all: ProjectBrief[],
  material: { title: string; summary: string | null; due: { date: IsoDate; quote: string | null } | null },
  items: InboxItem[],
): Promise<RouteResult | null> {
  const projects = all
    .slice(0, 30)
    .map((b) => {
      const cur = currentRound(view, b.project.id);
      const rounds = b.rounds
        .filter((r) => r.status !== 'delivered')
        .slice(0, 6)
        .map((r) => `${r.title}${r.span ? ` (${r.start}..${r.due}, period)` : ` due ${r.due}`}`)
        .join('; ');
      const needs = b.needs
        .filter((n) => n.status !== 'dropped')
        .slice(-25)
        .map((n) => `  ${n.code} ${n.title.replace(/\s+/g, ' ').slice(0, 80)}${dueOf(view, n) ? ` (due ${dueOf(view, n)})` : ''}`)
        .join('\n');
      return `Project ${b.project.id} "${b.project.name}"${b.project.description ? `: ${b.project.description.slice(0, 160)}` : ''}${cur ? ` | current: ${cur.title}` : ''}${rounds ? ` | deadlines: ${rounds}` : ''}\n${needs || '  (no needs)'}`;
    })
    .join('\n\n');
  const list = items.map((i) => `${i.id} [${i.type}] ${i.text}${i.due ? ` (due ${i.due})` : ''}`).join('\n');
  const user = `Material: ${material.title}\nSummary: ${material.summary ?? '-'}\nDeadline: ${material.due ? `${material.due.date} 「${material.due.quote ?? ''}」` : '-'}\n\nItems:\n${list}\n\nProjects:\n${projects}`;
  const text = await ai.json(userId, 'route', ROUTE_PROMPT, user, 1500);
  if (!text) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const byId = new Map(all.map((b) => [b.project.id, b]));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const noDots = (s: string) => s.replace(/[·•●]/g, ' ').slice(0, 200);
  const candidates: InboxRouting['candidates'] = [];
  for (const c of Array.isArray(j.candidates) ? (j.candidates as Record<string, unknown>[]) : []) {
    const pid = str(c?.projectId);
    if (!pid || !byId.has(pid) || candidates.some((x) => x.projectId === pid)) continue;
    const bold = Array.isArray(c.bold) ? (c.bold as unknown[]).map(str).filter((x): x is string => !!x).slice(0, 4) : [];
    candidates.push({ projectId: pid, reason: noDots(str(c.reason) ?? ''), ...(bold.length ? { reasonBold: bold } : {}) });
    if (candidates.length === 3) break;
  }
  let newProject: InboxRouting['newProject'];
  const np = j.newProject as Record<string, unknown> | null | undefined;
  if (np && typeof np === 'object' && str(np.name)) {
    const fr = np.firstRound as Record<string, unknown> | null | undefined;
    const due = str(fr?.due);
    newProject = {
      name: noDots(str(np.name)!).slice(0, 40),
      reason: noDots(str(np.reason) ?? ''),
      firstRound: fr && str(fr.title) ? { title: noDots(str(fr.title)!).slice(0, 40), due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, quote: str(fr.quote) } : null,
      template: null,
    };
  }
  if (!candidates.length && !newProject) return null;
  const fallback = candidates[0]?.projectId ?? null;
  const answers = new Map<string, Record<string, unknown>>();
  for (const a of Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : []) if (str(a?.id)) answers.set(str(a.id)!, a);
  const out = items.map((it) => {
    const a = answers.get(it.id);
    const asked = str(a?.projectId);
    const pid = candidates.length === 0 ? null : asked && byId.has(asked) ? asked : fallback;
    const next: InboxItem = { ...it, projectId: pid };
    if (pid) {
      const needs = byId.get(pid)!.needs;
      const byCode = (v: unknown) => {
        const code = str(v);
        return code ? (needs.find((n) => n.code === code) ?? null) : null;
      };
      const conflict = byCode(a?.dueConflict);
      const dup = byCode(a?.duplicateOf);
      const rev = byCode(a?.revises);
      const old = conflict ? dueOf(view, conflict) : null;
      if (conflict && it.due && old !== it.due) next.conflict = { needId: conflict.id, field: 'due', old, new: it.due };
      else if (dup) next.duplicateOf = dup.id;
      else if (rev) {
        next.type = 'rev';
        next.revNeedId = rev.id;
      }
    }
    return next;
  });
  // A project an item went to that the model left out of the candidates still shows as one.
  for (const it of out) if (it.projectId && !candidates.some((c) => c.projectId === it.projectId)) candidates.push({ projectId: it.projectId, reason: '' });
  return { routing: { candidates, ...(newProject && !candidates.length ? { newProject } : {}) }, items: out };
}

const words = (s: string): Set<string> => {
  const out = new Set<string>();
  const t = s.toLowerCase();
  for (const w of t.match(/[a-z0-9]{3,}/g) ?? []) out.add(w);
  const han = t.replace(/[^一-鿿]/g, '');
  for (let i = 0; i + 1 < han.length; i++) out.add(han.slice(i, i + 2));
  return out;
};
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

/** Without the model: the project whose name, goal, deadlines and needs share the most words with the material. */
function byRules(view: State, all: ProjectBrief[], material: { title: string; summary: string | null; due: { date: IsoDate; quote: string | null } | null }, items: InboxItem[]): RouteResult {
  const mw = words([material.title, material.summary ?? '', ...items.map((i) => i.text)].join(' '));
  const scored = all
    .map((b) => {
      const text = [b.project.name, b.project.description, ...b.rounds.map((r) => r.title), ...b.needs.map((n) => n.title)].join(' ');
      return { b, score: overlap(mw, words(text)) + overlap(mw, words(b.project.name)) * 3 };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return {
      routing: {
        candidates: [],
        newProject: {
          name: material.title.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 24),
          reason: '已有的项目里都没有提到这些内容',
          firstRound: material.due ? { title: material.title.slice(0, 24), due: material.due.date, quote: material.due.quote } : null,
          template: null,
        },
      },
      items: items.map((i) => ({ ...i, projectId: null })),
    };
  }
  const top = scored[0]!.b;
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return {
    routing: { candidates: scored.slice(0, 3).map((x) => ({ projectId: x.b.project.id, reason: `和「${x.b.project.name}」的内容相关` })) },
    items: items.map((i) => {
      const same = top.needs.find((n) => n.status !== 'dropped' && (norm(n.title).includes(norm(i.text)) || norm(i.text).includes(norm(n.title))));
      if (!same) return { ...i, projectId: top.project.id };
      const old = dueOf(view, same);
      if (i.due && old && old !== i.due) return { ...i, projectId: top.project.id, conflict: { needId: same.id, field: 'due', old, new: i.due } };
      return { ...i, projectId: top.project.id, duplicateOf: same.id };
    }),
  };
}
