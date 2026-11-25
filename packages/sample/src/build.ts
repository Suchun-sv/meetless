import {
  codesIn,
  daysBetween,
  DETECTOR_ID,
  noDots,
  type ArtifactKind,
  type EventPayloads,
  type EventType,
  type ExtractInput,
  type Id,
  type IsoDate,
  type IsoTime,
  type NeedStatus,
  type Requester,
  type SourceKind,
  type WorkEffect,
} from '@meetless/core';
import type { ProtoCollab, ProtoExtra, ProtoInput, ProtoNeed, ProtoProject, ProtoWork, PrototypeData, Txt } from './prototype';

export type SampleLocale = 'zh-CN' | 'en';

export interface SampleOptions {
  locale: SampleLocale;
  /** The user who plays the prototype's "you". */
  me: Id;
  /** The real today: the prototype's today (2026-11-24) moves here, and every business date with it. */
  today: IsoDate;
}

export interface SampleAction {
  actorId: Id;
  cmd: { id: string; type: EventType; payload: unknown; occurredAt?: IsoTime };
}

export const SAMPLE_PROJECT_IDS = { paper: 'sample-paper', atlas: 'sample-atlas' } as const;

/** The prototype's "today"; sample dates shift by the days from here to `SampleOptions.today`. */
export const PROTOTYPE_TODAY = '2026-11-24';

/**
 * Prototype people who become members. `me` maps to `SampleOptions.me` (see `samplePeople`).
 * Everyone else in the prototype (the client, the venue) is a `Requester { name }`, not a member.
 */
export const SAMPLE_PEOPLE = { lin: 'u-lin', ben: 'u-ben', zhou: 'u-zhou', prof: 'u-prof', mia: 'u-mia', ruo: 'u-ruo' } as const;

export function samplePeople(me: Id): Record<string, Id> {
  return { me, ...SAMPLE_PEOPLE };
}

/** Prototype project id -> sample project id. */
const PROJECTS: [proto: string, id: Id][] = [
  ['paper', SAMPLE_PROJECT_IDS.paper],
  ['team', SAMPLE_PROJECT_IDS.atlas],
];

interface Ctx {
  pid: Id;
  proto: ProtoProject;
  extra: ProtoExtra;
  collab: ProtoCollab;
  /** Shared needs, then private ones (as listed). */
  needs: ProtoNeed[];
}

interface Step {
  /** Prototype business date (sort key); ties keep build order. */
  date: IsoDate;
  run: () => void;
}

const num = (code: string) => Number(code.slice(1));
const byKindThenNumber = (a: ProtoNeed, b: ProtoNeed) => (a.kind === b.kind ? num(a.id) - num(b.id) : a.kind === 'ext' ? -1 : 1);
const same = (a: Txt, b: Txt) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The prototype's two projects (the paper and Atlas) as the commands a real
 * team would have sent. Phase A: users, projects, members, roles, rounds and
 * needs (so shared codes equal the prototype ids). Phase B: everything else,
 * in business-date order. Command ids are `sample:<n>` in build order
 * (`register:<user>` for users, matching the dev-user registrations), so the
 * same data always yields the same ids, whatever the language or the day.
 */
export function buildSample(data: PrototypeData, opts: SampleOptions): SampleAction[] {
  if ((Object.values(SAMPLE_PEOPLE) as string[]).includes(opts.me)) {
    throw new Error(`sample: me (${opts.me}) is one of the sample's own people (${Object.values(SAMPLE_PEOPLE).join(', ')}); choose another user`);
  }
  const out: SampleAction[] = [];
  const people = samplePeople(opts.me);
  const delta = daysBetween(PROTOTYPE_TODAY, opts.today);
  let n = 0;

  const t = (v: Txt): string => noDots(typeof v === 'string' ? v : v[opts.locale]);
  const day = (d: IsoDate): IsoDate => new Date(Date.parse(`${d}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
  const emit = <K extends EventType>(actorId: Id, type: K, payload: EventPayloads[K], when?: IsoDate) => {
    out.push({ actorId, cmd: { id: `sample:${++n}`, type, payload, ...(when ? { occurredAt: `${day(when)}T12:00:00.000Z` } : {}) } });
  };

  const ctxs: Ctx[] = PROJECTS.map(([protoId, pid]) => {
    const proto = data.projects.find((p) => p.id === protoId);
    const extra = data.extra[protoId];
    const collab = data.collab[protoId];
    if (!proto || !extra || !collab) throw new Error(`prototype project ${protoId} missing`);
    const shared = [...proto.needs, ...collab.needs.filter((x) => !x.private)].sort(byKindThenNumber);
    return { pid, proto, extra, collab, needs: [...shared, ...collab.needs.filter((x) => x.private)] };
  });

  // ------------------------------------------------------------ ids and people
  const needId = (c: Ctx, code: string) => `${c.pid}:${code}`;
  const roundId = (c: Ctx, round: number) => `${c.pid}:r${round}`;
  const inputId = (c: Ctx, input: ProtoInput) => `${c.pid}:${input.id}`;
  const member = (key: string | undefined): Id | null => (key !== undefined && people[key]) || null;
  const requester = (c: Ctx, key: string | undefined): Requester | null => {
    if (key === undefined) return null;
    const id = member(key);
    if (id) return { userId: id };
    const name = c.proto.people[key];
    return name ? { name: t(name) } : null;
  };
  const protoNeed = (c: Ctx, code: string | null | undefined) => c.needs.find((x) => x.id === code);
  /** 张老师（导师） -> 张老师; Prof. Zhang (advisor) -> Prof. Zhang. */
  const shortName = (v: string) => v.replace(/\s*[（(][^（()）]*[)）]\s*$/, '');
  const names = (c: Ctx, key: string) => {
    const v = c.proto.people[key];
    return v === undefined ? [] : typeof v === 'string' ? [shortName(v)] : [shortName(v['zh-CN']), shortName(v.en)];
  };

  /** Who did a piece of work: its `by`; else the hypothesis's author; else a "Ben: ..." prefix; else me. */
  const workActor = (c: Ctx, w: ProtoWork): Id => {
    const by = member(w.by);
    if (by) return by;
    const nd = protoNeed(c, w.need);
    const author = nd?.kind === 'hyp' ? member(nd.by) : null;
    if (author) return author;
    const texts = typeof w.text === 'string' ? [w.text] : [w.text['zh-CN'], w.text.en];
    for (const key of Object.keys(c.proto.people)) {
      const id = member(key);
      if (!id || key === 'me') continue;
      if (names(c, key).some((nm) => texts.some((x) => x.startsWith(`${nm}：`) || x.startsWith(`${nm}:`)))) return id;
    }
    return opts.me;
  };
  const agentClient = (text: Txt) => (/codex/i.test(typeof text === 'string' ? text : `${text['zh-CN']} ${text.en}`) ? 'codex' : 'claude-code');
  /** The client of the recipient's own agent reports in this project (Mia uses Codex, Zhou Claude Code). */
  const fetchClient = (c: Ctx, to: Id) => {
    const report = [...c.extra.work, ...c.collab.work].find((w) => w.src === 'agent' && workActor(c, w) === to);
    return report ? agentClient(report.text) : 'claude-code';
  };

  // ------------------------------------------------------------ inputs
  const fromExtract = (c: Ctx, nd: ProtoNeed) => {
    for (const input of c.extra.inputs) {
      const x = input.extracts.find((y) => y.need === nd.id && y.state === 'accepted' && (y.type === 'new' || y.type === 'hyp'));
      if (x) return { input, x };
    }
    return null;
  };
  /** An accepted extract on an input of the same day already records this (the extract's own work item or revision). */
  const echoesExtract = (c: Ctx, code: string | null, date: IsoDate, types: string[]) =>
    code !== null && c.extra.inputs.some((i) => i.date === date && i.extracts.some((x) => x.state === 'accepted' && x.need === code && types.includes(x.type)));
  const isConflict = (c: Ctx, input: ProtoInput, code: string | undefined) =>
    c.collab.questions.some((q) => q.conflict && q.conflict.need === code && same(q.conflict.src, input.title));

  /**
   * Who an input is from: the person who said what it yields. The core takes a need's requester from its input,
   * so an input whose accepted extracts create needs is "from" the most frequent author (`by`) of those needs
   * (the first on a tie); any other input keeps its prototype `from`.
   */
  const inputFrom = (c: Ctx, input: ProtoInput): string => {
    const by = input.extracts
      .filter((x) => x.state === 'accepted' && (x.type === 'new' || x.type === 'hyp'))
      .map((x) => protoNeed(c, x.need)?.by)
      .filter((k): k is string => k !== undefined);
    if (!by.length) return input.from;
    const count = (k: string) => by.filter((y) => y === k).length;
    return by.reduce((best, k) => (count(k) > count(best) ? k : best), by[0]!);
  };

  const imported = new Set<string>();
  const importInput = (c: Ctx, input: ProtoInput) => {
    imported.add(inputId(c, input));
    const body = input.body.map((b, i) => ({ id: `p${i + 1}`, text: t(b.p), x: b.x }));
    const extracts: ExtractInput[] = input.extracts.map((x) => {
      const nd = x.type === 'new' || x.type === 'hyp' ? protoNeed(c, x.need) : undefined;
      const accept = x.accept ?? nd?.accept;
      const expect = x.expect ?? nd?.expect;
      const verify = x.verify ?? nd?.verify;
      return {
        id: x.id,
        type: x.type,
        text: t(x.text),
        paraId: body.find((b) => b.x === x.id)?.id ?? null,
        needId: x.type === 'rev' && x.need ? needId(c, x.need) : null,
        accept: accept === undefined ? null : t(accept),
        expect: expect === undefined ? null : t(expect),
        verify: verify === undefined ? null : t(verify),
        conflict: x.type === 'rev' && isConflict(c, input, x.need),
      };
    });
    emit(
      opts.me,
      'input.imported',
      {
        inputId: inputId(c, input),
        projectId: c.pid,
        kind: input.kind,
        title: t(input.title),
        from: requester(c, inputFrom(c, input)),
        date: day(input.date),
        body: body.map(({ id, text }) => ({ id, text })),
        extracts,
        detector: DETECTOR_ID,
      },
      input.date,
    );
  };
  /** Decides the input's extracts that create no need (revisions, actions, ignored ones) as the prototype has them. */
  const decideOthers = (c: Ctx, input: ProtoInput) => {
    for (const x of input.extracts) {
      if (x.state === 'ignored') emit(opts.me, 'extract.ignored', { inputId: inputId(c, input), extractId: x.id }, input.date);
      else if (x.state === 'accepted' && (x.type === 'rev' || x.type === 'action')) emit(opts.me, 'extract.accepted', { inputId: inputId(c, input), extractId: x.id }, input.date);
    }
  };

  // ------------------------------------------------------------ phase A: users
  const users: [Id, string][] = [];
  for (const c of ctxs) {
    for (const key of Object.keys(c.proto.people)) {
      const id = member(key);
      if (!id || users.some(([u]) => u === id)) continue;
      const display = key === 'me' ? t(opts.me.replace(/^u-/, '').replace(/^./, (ch) => ch.toUpperCase())) : shortName(t(c.proto.people[key]!));
      users.push([id, display]);
    }
  }
  for (const [userId, displayName] of users) {
    out.push({ actorId: 'system', cmd: { id: `register:${userId}`, type: 'user.registered', payload: { userId, displayName, locale: opts.locale } } });
  }

  // ------------------------------------------------------------ phase A: projects, members, roles, rounds, needs
  for (const c of ctxs) {
    const { pid, proto } = c;
    emit(opts.me, 'project.created', { projectId: pid, name: t(proto.name), description: t(proto.kindLabel), sample: true }, proto.start);
    for (const key of Object.keys(proto.people)) {
      const id = member(key);
      if (id && id !== opts.me) emit(opts.me, 'project.member_added', { projectId: pid, userId: id }, proto.start);
    }
    for (const role of c.collab.roles) {
      const roleId = `${pid}:role:${role.id}`;
      emit(opts.me, 'role.created', { roleId, projectId: pid, name: t(role.name) }, proto.start);
      for (const key of role.members) emit(opts.me, 'role.member_assigned', { roleId, userId: member(key)! }, proto.start);
    }
    for (const r of [...proto.rounds].sort((a, b) => a.n - b.n)) {
      const items = r.status !== 'delivered' && r.delivery ? { items: r.delivery.items.map(t) } : {};
      emit(opts.me, 'round.created', { roundId: roundId(c, r.n), projectId: pid, title: t(r.title), kind: r.kind, start: day(r.start), due: day(r.due), ...items }, proto.start);
    }

    for (const nd of c.needs) {
      const id = needId(c, nd.id);
      const ownerId = member(c.collab.owners[nd.id]);
      const opt = (v: Txt | undefined) => (v === undefined ? null : t(v));
      const ex = nd.private ? null : fromExtract(c, nd);
      if (!ex) {
        emit(
          // Private needs are always the loading user's own.
          nd.private ? opts.me : (nd.kind === 'hyp' && member(nd.by)) || opts.me,
          'need.created',
          {
            needId: id,
            projectId: pid,
            kind: nd.kind,
            title: t(nd.title),
            roundId: roundId(c, nd.round),
            status: nd.status as NeedStatus,
            parentId: nd.parent ? needId(c, nd.parent) : null,
            fromRoundId: nd.fromRound ? roundId(c, nd.fromRound) : null,
            ownerId,
            requester: requester(c, nd.by),
            accept: opt(nd.accept),
            expect: opt(nd.expect),
            verify: opt(nd.verify),
            verdict: opt(nd.verdict),
            source: { src: nd.source.src as SourceKind, date: day(nd.source.date), quote: t(nd.source.quote), ref: t(nd.source.ref) },
            ...(nd.private ? { private: true } : {}),
          },
          nd.source.date,
        );
        continue;
      }
      // From an accepted extract: the quote links to the input; title, links, owner and status follow.
      const { input, x } = ex;
      if (!imported.has(inputId(c, input))) {
        importInput(c, input);
        decideOthers(c, input);
      }
      emit(opts.me, 'extract.accepted', { inputId: inputId(c, input), extractId: x.id, needId: id, roundId: roundId(c, nd.round) }, input.date);
      const update = {
        ...(same(nd.title, x.text) ? {} : { title: t(nd.title) }),
        ...(ownerId ? { ownerId } : {}),
        ...(nd.fromRound ? { fromRoundId: roundId(c, nd.fromRound) } : {}),
        ...(nd.parent ? { parentId: needId(c, nd.parent) } : {}),
      };
      if (Object.keys(update).length) emit(opts.me, 'need.updated', { needId: id, ...update }, input.date);
      if (nd.status !== (nd.kind === 'ext' ? 'todo' : 'untested')) {
        emit(opts.me, 'need.status_set', { needId: id, status: nd.status as NeedStatus, ...(nd.kind === 'hyp' && nd.verdict ? { verdict: t(nd.verdict) } : {}) }, input.date);
      }
    }
  }

  // ------------------------------------------------------------ phase B: everything else, by business date
  const steps: Step[] = [];
  for (const c of ctxs) {
    const { pid, proto } = c;

    for (const nd of c.needs) {
      (nd.revisions ?? []).forEach((rev, i) => {
        // A revision an accepted input extract makes is made there, once.
        if (echoesExtract(c, nd.id, rev.date, ['rev'])) return;
        steps.push({
          date: rev.date,
          run: () => emit(opts.me, 'need.revised', { needId: needId(c, nd.id), revisionId: `${needId(c, nd.id)}:rev${i + 1}`, text: t(rev.text), why: t(rev.why), date: day(rev.date) }, rev.date),
        });
      });
    }

    for (const input of c.extra.inputs) {
      if (c.needs.some((nd) => !nd.private && fromExtract(c, nd)?.input === input)) continue; // imported in phase A
      steps.push({
        date: input.date,
        run: () => {
          importInput(c, input);
          decideOthers(c, input);
        },
      });
    }

    for (const h of c.collab.handoffs) {
      const handoffId = `${pid}:${h.id}`;
      const to = member(h.to)!;
      steps.push({
        date: h.date,
        run: () => {
          emit(member(h.from)!, 'handoff.created', { handoffId, projectId: pid, needId: needId(c, h.need), toId: to, ask: t(h.ask), due: day(h.due) }, h.date);
          if (h.state !== 'sent') emit(to, 'handoff.responded', { handoffId, response: 'accepted' }, h.date);
          if (h.state === 'doing') emit(to, 'handoff.started', { handoffId }, h.date);
        },
      });
      const f = h.fetched;
      if (f) steps.push({ date: f.at, run: () => emit(to, 'handoff.context_fetched', { handoffId, version: f.v, client: fetchClient(c, to) }, f.at) });
    }

    for (const w of [...proto.work, ...c.extra.work, ...c.collab.work]) {
      if (w.ef === 'extract' && echoesExtract(c, w.need, w.date, ['new', 'hyp'])) continue;
      if (w.ef === 'revise' && echoesExtract(c, w.need, w.date, ['rev'])) continue;
      const also = w.extra ? codesIn(w.extra)[0] : undefined;
      steps.push({
        date: w.date,
        run: () =>
          emit(
            workActor(c, w),
            'work.recorded',
            {
              workId: `${pid}:${w.id}`,
              projectId: pid,
              needId: w.need ? needId(c, w.need) : null,
              alsoNeedId: also ? needId(c, also) : null,
              src: w.src as SourceKind,
              text: t(w.text),
              why: w.why === undefined ? null : t(w.why),
              effect: (w.ef as WorkEffect | null) ?? null,
              result: w.res ?? null,
              date: day(w.date),
              ...(w.src === 'agent' ? { via: { client: agentClient(w.text), tokenId: 'sample' } } : {}),
            },
            w.date,
          ),
      });
    }

    for (const a of c.extra.artifacts) {
      const artifactId = `${pid}:${a.id}`;
      const versions = [...a.versions].reverse(); // oldest first
      versions.forEach((v, i) => {
        steps.push({
          date: v.date,
          run: () => {
            if (i === 0) {
              emit(opts.me, 'artifact.created', { artifactId, projectId: pid, kind: a.kind as ArtifactKind, title: t(a.title), where: t(a.where), needIds: a.needs.map((code) => needId(c, code)) }, v.date);
            }
            emit(opts.me, 'artifact.version_added', { artifactId, versionId: `${artifactId}:v${i + 1}`, label: t(v.v), date: day(v.date), roundId: roundId(c, v.round), note: t(v.note) }, v.date);
          },
        });
      });
    }

    for (const r of proto.rounds) {
      const d = r.delivery;
      if (r.status !== 'delivered' || !d) continue;
      steps.push({
        date: r.due,
        run: () =>
          emit(
            opts.me,
            'round.delivered',
            { roundId: roundId(c, r.n), date: day(r.due), items: d.items.map(t), account: d.account.map((x) => ({ needId: needId(c, x.need), status: x.v as NeedStatus, note: t(x.note) })) },
            r.due,
          ),
      });
    }
  }
  // Array.prototype.sort is stable: same-day steps keep build order (a handoff before its fetch, work before the delivery).
  for (const s of steps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) s.run();
  return out;
}
