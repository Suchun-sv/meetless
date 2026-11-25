import { describe, expect, it } from 'vitest';
import { DomainError, eventScope, viewFor, type DomainErrorCode } from '../src/index';
import { atlas, P, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('project.renamed', () => {
  it('a member renames the project; the name is trimmed and the rename is kept for Activity', () => {
    const log = atlas();
    const e = log.emit('project.renamed', U.lin, { projectId: P, name: '  Atlas data export  ' });
    const p = log.state.projects[P]!;
    expect(p.name).toBe('Atlas data export');
    expect(p.renames).toEqual([{ from: 'Atlas export', to: 'Atlas data export', by: U.lin, at: e.recordedAt, seq: e.seq }]);
  });

  it('a new project starts with no renames', () => {
    expect(atlas().state.projects[P]!.renames).toEqual([]);
  });

  it('strips dot symbols from the name', () => {
    const log = atlas();
    log.emit('project.renamed', U.me, { projectId: P, name: 'Atlas · export•v2' });
    expect(log.state.projects[P]!.name).toBe('Atlas export v2');
  });

  it('refuses an empty name, a blank one, and one that is only dots', () => {
    const log = atlas();
    for (const name of ['', '   ', '\n\t', ' · ']) rejects(() => log.emit('project.renamed', U.me, { projectId: P, name }), 'INVALID_EVENT');
    rejects(() => log.emit('project.renamed', U.me, { projectId: P, name: 42 as unknown as string }), 'INVALID_EVENT');
    expect(log.state.projects[P]!.name).toBe('Atlas export');
    expect(log.state.projects[P]!.renames).toEqual([]);
  });

  it('takes 80 characters and refuses 81 (counted after trimming, CJK by code point)', () => {
    const log = atlas();
    rejects(() => log.emit('project.renamed', U.me, { projectId: P, name: 'x'.repeat(81) }), 'INVALID_EVENT');
    rejects(() => log.emit('project.renamed', U.me, { projectId: P, name: '项'.repeat(81) }), 'INVALID_EVENT');
    log.emit('project.renamed', U.me, { projectId: P, name: ` ${'x'.repeat(80)} ` });
    expect(log.state.projects[P]!.name).toBe('x'.repeat(80));
    log.emit('project.renamed', U.me, { projectId: P, name: '𝒜'.repeat(80) });
    expect(log.state.projects[P]!.name).toBe('𝒜'.repeat(80));
  });

  it('refuses a non-member and an unknown project', () => {
    const log = atlas();
    rejects(() => log.emit('project.renamed', U.eve, { projectId: P, name: 'Hijacked' }), 'NOT_A_MEMBER');
    rejects(() => log.emit('project.renamed', U.me, { projectId: 'p-nope', name: 'Ghost' }), 'NOT_FOUND');
    expect(log.state.projects[P]!.name).toBe('Atlas export');
  });

  it('is scoped to the project: every member receives it, a non-member does not', () => {
    const log = atlas();
    const e = log.emit('project.renamed', U.ben, { projectId: P, name: 'Atlas v2' });
    expect(eventScope(log.state, e)).toEqual({ projectId: P, privateTo: null });
    for (const u of [U.me, U.lin, U.ben, U.zhou]) expect(log.streamFor(u).map((x) => x.id)).toContain(e.id);
    expect(log.streamFor(U.eve).map((x) => x.id)).not.toContain(e.id);
    expect(viewFor(log.state, U.zhou).projects[P]!.name).toBe('Atlas v2');
    expect(viewFor(log.state, U.eve).projects[P]).toBeUndefined();
  });
});
