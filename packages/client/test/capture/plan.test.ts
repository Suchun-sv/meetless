import { describe, expect, it } from 'vitest';
import { DOT_RE, SEP, viewFor } from '@meetless/core';
import { captureWorkId, planCapture, versionRecords } from '../../src/capture/plan';
import { a, apply, forty, id, recs, s, vid } from './fixture';

describe('planCapture', () => {
  it('matches by code first, then keywords, and records only matched items', () => {
    const cmds = planCapture(s, 'u-alex', a('a-code'), recs(['c91a N2 tweak'], ['bump eslint'], ['add date range filter for export']));
    expect(cmds.map((c) => c.payload.needId)).toEqual([id('N2'), id('N1')]);
    expect(cmds.every((c) => c.payload.capture === true && c.payload.autoLinked === true && c.id === c.payload.workId)).toBe(true);
  });

  it('a capture linked to a private need, or read from a private artifact, is private', () => {
    const [mine] = planCapture(s, 'u-alex', a('a-code'), recs(['secret latency trick tuned']));
    expect(mine!.payload.private).toBe(true);
    const after = apply(s, 'u-alex', mine!);
    expect(after.work[mine!.payload.workId]!.privateTo).toBe('u-alex');
    expect(viewFor(after, 'u-lin').work[mine!.payload.workId]).toBeUndefined();
    expect(planCapture(s, 'u-alex', a('a-priv'), recs(['N1 slide']))[0]!.payload.private).toBe(true);
  });

  it('ids are deterministic and salted by privacy', () => {
    expect(planCapture(s, 'u-alex', a('a-code'), recs(['N1 x']))[0]!.id).toBe(planCapture(s, 'u-lin', a('a-code'), recs(['N1 x']))[0]!.id);
    expect(captureWorkId('u-alex', 'a-priv', 'k', 'n')).not.toBe(captureWorkId('u-lin', 'a-priv', 'k', 'n'));
    expect(captureWorkId('p1', 'a', 'k', 'n')).toMatch(/^cap-[0-9a-f]{24}$/);
  });

  it('existing captures are skipped and max caps the run', () => {
    const first = planCapture(s, 'u-alex', a('a-code'), recs(['N1 x']));
    expect(planCapture(apply(s, 'u-alex', first[0]!), 'u-alex', a('a-code'), recs(['N1 x']))).toEqual([]);
    expect(planCapture(s, 'u-alex', a('a-code'), forty('N1'))).toHaveLength(30);
  });

  it('captured text never contains a dot character', () => {
    const [c] = planCapture(s, 'u-alex', a('a-code'), recs(['N2 fix · export • now']));
    expect(DOT_RE.test(c!.payload.text)).toBe(false);
    expect(c!.payload.text).toContain(SEP);
  });

  it('needId restricts matching to one need; closed needs are never candidates', () => {
    expect(planCapture(s, 'u-alex', a('a-code'), recs(['N1 and N2']), { needId: id('N2') })[0]!.payload.needId).toBe(id('N2'));
    expect(planCapture(s, 'u-alex', a('a-code'), recs(['N3 done']))).toEqual([]);
  });

  it('an explicit needId only accepts an open need of the artifact’s own project; otherwise nothing is planned (M11)', () => {
    // N3 is closed (met): naming it explicitly still records nothing.
    expect(planCapture(s, 'u-alex', a('a-code'), recs(['N3 done']), { needId: id('N3') })).toEqual([]);
    // A need from another project, named explicitly, records nothing either.
    const other = apply(
      apply(s, 'u-alex', { id: 'p2', type: 'project.created', payload: { projectId: 'p2', name: 'Other' } }),
      'u-alex',
      { id: 'n-other', type: 'need.created', payload: { needId: 'n-other', projectId: 'p2', kind: 'ext', title: 'export date range filter', roundId: null, source: { src: 'chat', date: '2026-11-20', quote: '', ref: 'x' } } },
    );
    expect(planCapture(other, 'u-alex', a('a-code'), recs(['export date range filter']), { needId: 'n-other' })).toEqual([]);
    // An unknown id records nothing.
    expect(planCapture(s, 'u-alex', a('a-code'), recs(['N1 x']), { needId: 'nope' })).toEqual([]);
  });

  it('versionRecords reads the note and each derived text block, keyed by version', () => {
    expect(versionRecords(a('a-doc')).map((r) => r.key)).toEqual([`v:${vid}:note`, `v:${vid}:b0`, `v:${vid}:b1`]);
  });
});
