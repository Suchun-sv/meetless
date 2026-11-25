import { needVersion } from './reducer';
import { handoffForNeed, workFor } from './queries';
import { SEP } from './text';
import type { Id, Need, NeedKind, NeedStatus, State, WorkEffect } from './types';

/** Localised labels for the context text (provided by @meetless/i18n). */
export interface ContextLabels {
  kind: (k: NeedKind) => string;
  status: (s: NeedStatus) => string;
  effect: (e: WorkEffect) => string;
  round: (n: number, title: string) => string;
  due: (date: string) => string;
  version: (v: number) => string;
  date: (d: string) => string;
  accept: string;
  expect: string;
  verify: string;
  verdict: string;
  source: string;
  revisions: string;
  work: string;
  children: string;
  parent: string;
  artifacts: string;
  refuted: string;
  owner: string;
  requester: string;
  handoff: string;
  captured: string;
  fetchHint: (link: string) => string;
  report: string;
}

export interface NeedContext {
  needId: Id;
  code: string;
  projectId: Id;
  version: number;
  link: string;
  markdown: string;
}

export function needLink(projectId: Id, code: string): string {
  return `meetless://${projectId}/${code}`;
}

/** Parses meetless://<project>/<code-or-id>. */
export function parseNeedLink(s: string): { projectId: Id; ref: string } | null {
  const m = /^meetless:\/\/([^/\s]+)\/([^/\s?#]+)/.exec(s.trim());
  return m ? { projectId: decodeURIComponent(m[1]!), ref: decodeURIComponent(m[2]!) } : null;
}

const who = (s: State, n: Need) => (n.requester?.userId ? (s.users[n.requester.userId]?.displayName ?? n.requester.userId) : (n.requester?.name ?? null));

/**
 * The live context behind a handoff link, generated from `view` at call time.
 * `view` decides what is visible: the service passes the caller's view (their
 * private items included, others' excluded); link previews pass the shareable
 * view (no private items at all).
 */
export function needContext(view: State, needId: Id, L: ContextLabels, opts: { full?: boolean } = {}): NeedContext {
  const n = view.needs[needId];
  if (!n) throw new Error(`need ${needId} not visible`);
  const full = opts.full !== false;
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const r = n.roundId ? view.rounds[n.roundId] : null;
  const v = needVersion(n);
  const link = needLink(n.projectId, n.code);
  line(`# ${n.code} ${n.title}`);
  line(`> ${[L.kind(n.kind), r ? L.round(r.n, r.title) : null, r ? L.due(L.date(r.due)) : null, L.status(n.status), L.version(v)].filter(Boolean).join(SEP)}`);
  const owner = n.ownerId ? (view.users[n.ownerId]?.displayName ?? n.ownerId) : null;
  const req = who(view, n);
  if (owner || req) line(`> ${[owner ? `${L.owner}: ${owner}` : null, req ? `${L.requester}: ${req}` : null].filter(Boolean).join(SEP)}`);
  line();
  if (n.kind === 'ext') {
    line(`## ${L.accept}`);
    line(n.accept ?? n.title);
  } else {
    line(`## ${L.expect}`);
    line(n.expect ?? n.title);
    if (n.verify) {
      line(`## ${L.verify}`);
      line(n.verify);
    }
    if (n.verdict) {
      line(`## ${L.verdict}`);
      line(n.verdict);
    }
  }
  if (n.parentId && view.needs[n.parentId]) {
    const p = view.needs[n.parentId]!;
    line();
    line(`## ${L.parent}`);
    line(`${p.code} ${p.title}${SEP}${L.status(p.status)}`);
  }
  line();
  line(`## ${L.source}`);
  line(`${n.source.quote}${n.source.ref ? ` — ${n.source.ref}` : ''}${SEP}${L.date(n.source.date)}`);
  if (n.revisions.length) {
    line();
    line(`## ${L.revisions}`);
    for (const x of n.revisions) line(`- ${L.date(x.date)} ${L.version(x.version)}: ${x.text}${x.why ? ` (${x.why})` : ''}`);
  }
  const h = handoffForNeed(view, n.id);
  if (h && h.state !== 'done') {
    line();
    line(`## ${L.handoff}`);
    const from = view.users[h.fromId]?.displayName ?? h.fromId;
    const to = view.users[h.toId]?.displayName ?? h.toId;
    line(`${from} → ${to}: ${h.ask}${h.due ? `${SEP}${L.due(L.date(h.due))}` : ''}`);
  }
  const ws = workFor(view, n.id);
  if (ws.length) {
    line();
    line(`## ${L.work}`);
    for (const w of full ? ws : ws.slice(-3)) {
      const by = view.users[w.by]?.displayName ?? w.by;
      line(`- ${L.date(w.date)} ${by}: ${w.text}${w.capture ? ` (${L.captured})` : w.effect ? ` — ${L.effect(w.effect)}` : ''}`);
    }
  }
  if (full) {
    const kids = Object.values(view.needs).filter((k) => k.parentId === n.id).sort((a, b) => a.createdSeq - b.createdSeq);
    if (kids.length) {
      line();
      line(`## ${L.children}`);
      for (const k of kids) line(`- ${k.code} ${k.title} — ${L.status(k.status)}`);
    }
    const arts = Object.values(view.artifacts).filter((a) => a.needIds.includes(n.id));
    if (arts.length) {
      line();
      line(`## ${L.artifacts}`);
      for (const a of arts) line(`- ${a.title}${a.versions[0] ? ` ${a.versions[0].label}` : ''} (${a.where})${a.url ? ` ${a.url}` : ''}`);
    }
    const dead = Object.values(view.needs).filter((k) => k.projectId === n.projectId && k.status === 'refuted').sort((a, b) => a.createdSeq - b.createdSeq);
    if (dead.length) {
      line();
      line(`## ${L.refuted}`);
      for (const k of dead) line(`- ${k.code} ${k.title}${k.verdict ? ` — ${k.verdict}` : ''}`);
    }
  }
  line();
  line('---');
  line(L.fetchHint(link));
  line(L.report);
  return { needId: n.id, code: n.code, projectId: n.projectId, version: v, link, markdown: out.join('\n') };
}
