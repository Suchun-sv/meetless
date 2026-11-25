import { describe, expect, it } from 'vitest';
import type { InviteInfo } from '@meetless/api';
import { currentRound, type Round } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import { sampleWith } from '../shell/u1';
import {
  addMemberCommands,
  addableUsers,
  canCreateRole,
  canSubmitRound,
  clientLabel,
  CODEX_ENV,
  inviteFormError,
  inviteStatus,
  memberRows,
  newProjectCommands,
  nextRoundDraft,
  roleCommands,
  roundCreateCommand,
  roundDraftError,
  roundUpdateCommand,
  routeErrorText,
  signInMessage,
  tokenSectionErrorAfterCreate,
  withToken,
  type RoundDraft,
} from '../../src/renderer/setup/model';

const tr = createTranslator('en');
const t = tr.t;
const errorText = (code: string) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code }));

/** A full `Round` fixture with sensible defaults, for the pure model tests below. */
const round = (over: Partial<Round> = {}): Round => ({
  id: 'r1',
  projectId: 'p1',
  n: 1,
  title: 'R1',
  kind: 'hard',
  start: '2026-11-01',
  due: '2026-11-14',
  status: 'planned',
  items: [],
  delivery: null,
  ...over,
});

const draftOf = (r: Round): RoundDraft => ({ title: r.title, kind: r.kind, start: r.start, due: r.due });

describe('inviteFormError', () => {
  it('invite form needs a name and a code; spaces alone do not count', () => {
    expect(inviteFormError(t, { server: 'http://h', name: '  ', code: 'AB12' })).toBe(t('signin.nameMissing'));
    expect(inviteFormError(t, { server: 'http://h', name: 'Wen', code: ' ' })).toBe(t('signin.codeMissing'));
  });

  it('a filled name and code pass, whatever their case or padding (the bridge trims and upper-cases the code)', () => {
    expect(inviteFormError(t, { server: 'http://h', name: 'Wen', code: 'ab12' })).toBeNull();
    expect(inviteFormError(t, { server: 'http://h', name: ' Wen ', code: '  ab12  ' })).toBeNull();
  });
});

describe('signInMessage', () => {
  it('a server without the invite route says so and names the URL tried', () => {
    expect(signInMessage(t, tr, errorText, { code: 'HTTP_404', details: { url: 'http://h/v1/invites/redeem' } }, 'http://h')).toBe(
      t('signin.failed', { url: 'http://h/v1/invites/redeem', reason: t('error.NOT_IMPLEMENTED') }),
    );
  });

  it('a used or invalid code gives its own reason', () => {
    expect(signInMessage(t, tr, errorText, { code: 'INVITE_USED' }, 'http://h')).toContain(t('error.INVITE_USED'));
    expect(signInMessage(t, tr, errorText, { code: 'INVITE_INVALID' }, 'http://h')).toContain(t('error.INVITE_INVALID'));
  });

  it('no details at all still names the server typed, with the generic reason', () => {
    expect(signInMessage(t, tr, errorText, { code: 'SOMETHING_UNKNOWN' }, 'http://h')).toBe(
      t('signin.failed', { url: 'http://h', reason: t('error.generic', { code: 'SOMETHING_UNKNOWN' }) }),
    );
  });

  it('a transport message from the bridge is appended in brackets', () => {
    expect(signInMessage(t, tr, errorText, { code: 'NETWORK', details: { url: 'http://h', message: 'ECONNREFUSED' } }, 'http://h')).toBe(
      t('signin.failed', { url: 'http://h', reason: `${t('error.NETWORK')} (ECONNREFUSED)` }),
    );
  });

  it('a rate-limited result shows the seconds from details.retryAfter, rounded up, for signIn and redeemInvite alike', () => {
    expect(signInMessage(t, tr, errorText, { code: 'RATE_LIMITED', details: { url: 'http://h', retryAfter: 30 } }, 'http://h')).toBe(
      t('signin.failed', { url: 'http://h', reason: t('error.RATE_LIMITED', { seconds: 30 }) }),
    );
    // redeemInvite (R49): retryAfter at the top, the server's details also kept under cause.
    expect(signInMessage(t, tr, errorText, { code: 'RATE_LIMITED', details: { url: 'http://h', retryAfter: 44.2, cause: { retryAfter: 44.2 } } }, 'http://h')).toBe(
      t('signin.failed', { url: 'http://h', reason: t('error.RATE_LIMITED', { seconds: 45 }) }),
    );
  });

  it('a rate-limited result without a numeric retryAfter shows error.generic with the code, never a made-up wait (contract 12.8)', () => {
    const generic = t('signin.failed', { url: 'http://h', reason: t('error.generic', { code: 'RATE_LIMITED' }) });
    expect(signInMessage(t, tr, errorText, { code: 'RATE_LIMITED' }, 'http://h')).toBe(generic);
    expect(signInMessage(t, tr, errorText, { code: 'RATE_LIMITED', details: { retryAfter: '30' } }, 'http://h')).toBe(generic);
    expect(signInMessage(t, tr, errorText, { code: 'RATE_LIMITED', details: { retryAfter: Number.NaN } }, 'http://h')).toBe(generic);
    expect(generic).not.toMatch(/\d+s\b/);
  });

});

describe('newProjectCommands', () => {
  it('a blank project name sends nothing; a name is trimmed', () => {
    expect(newProjectCommands({ projectId: 'p1', name: '   ', description: '' })).toEqual([]);
    expect(newProjectCommands({ projectId: 'p1', name: ' Atlas 2 ', description: '' })[0]).toMatchObject({ type: 'project.created', payload: { name: 'Atlas 2' } });
  });

  it('a blank description is left out of the payload; a filled one is trimmed', () => {
    const [blank] = newProjectCommands({ projectId: 'p1', name: 'Atlas', description: '   ' });
    expect(blank).toEqual({ type: 'project.created', payload: { projectId: 'p1', name: 'Atlas' } });
    const [withDescr] = newProjectCommands({ projectId: 'p1', name: 'Atlas', description: ' export plan ' });
    expect(withDescr).toMatchObject({ payload: { description: 'export plan' } });
  });
});

describe('members and roles', () => {
  it('adding a member with a role is member_added then member_assigned, and both pass the reducer', () => {
    // u-mia is a registered user (sample-paper) who is not a member of sample-atlas.
    const cmds = addMemberCommands('sample-atlas', 'u-mia', 'sample-atlas:role:qa');
    expect(cmds.map((c) => c.type)).toEqual(['project.member_added', 'role.member_assigned']);
    const s = sampleWith('en', cmds);
    expect(s.projects['sample-atlas']!.memberIds).toContain('u-mia');
    expect(s.roles['sample-atlas:role:qa']!.memberIds).toContain('u-mia');
    expect(memberRows(s, 'sample-atlas').find((r) => r.userId === 'u-mia')).toMatchObject({ roleIds: ['sample-atlas:role:qa'] });
  });

  it('adding a member with no role is member_added alone', () => {
    const cmds = addMemberCommands('sample-atlas', 'u-mia', null);
    expect(cmds).toEqual([{ type: 'project.member_added', payload: { projectId: 'sample-atlas', userId: 'u-mia' } }]);
  });

  it('addableUsers leaves out members; the outsider Eve is addable to Atlas', () => {
    const s = sampleWith('en', [{ type: 'user.registered', payload: { userId: 'u-eve', displayName: 'Eve', locale: 'en' } }], 'system');
    const ids = addableUsers(s, 'sample-atlas').map((u) => u.id);
    expect(ids).toContain('u-eve');
    expect(ids).not.toContain('u-alex'); // already a member
  });

  it("roleCommands.create sends nothing for a blank name, and trims a real one", () => {
    expect(roleCommands.create('sample-atlas', '   ')).toEqual([]);
    const [cmd] = roleCommands.create('sample-atlas', ' Design ');
    expect(cmd).toMatchObject({ type: 'role.created', payload: { projectId: 'sample-atlas', name: 'Design' } });
  });

  it('canCreateRole guards a blank name and a submit already in flight (a fast double-click must not mint two roles)', () => {
    expect(canCreateRole('', false)).toBe(false);
    expect(canCreateRole('   ', false)).toBe(false);
    expect(canCreateRole('Design', true)).toBe(false); // still in flight
    expect(canCreateRole('Design', false)).toBe(true);
  });

  it('roleCommands.assign and .remove both pass the reducer', () => {
    // u-ben is already a member of sample-atlas (role Engineering), not yet in QA.
    const s1 = sampleWith('en', roleCommands.assign('sample-atlas:role:qa', 'u-ben'));
    expect(s1.roles['sample-atlas:role:qa']!.memberIds).toContain('u-ben');
    const s2 = sampleWith('en', roleCommands.remove('sample-atlas:role:qa', 'u-zhou'));
    expect(s2.roles['sample-atlas:role:qa']!.memberIds).not.toContain('u-zhou');
  });
});

describe('inviteStatus', () => {
  const base: InviteInfo = { id: 'i1', projectId: 'p1', roleId: null, createdBy: 'u-alex', createdAt: '2026-11-24T09:00:00.000Z', usedBy: null, usedAt: null, revokedAt: null };

  it('revoked wins over used, used over open', () => {
    expect(inviteStatus(base)).toBe('open');
    expect(inviteStatus({ ...base, usedBy: 'u-zhou', usedAt: '2026-11-24T10:00:00.000Z' })).toBe('used');
    expect(inviteStatus({ ...base, revokedAt: '2026-11-24T10:00:00.000Z' })).toBe('revoked');
    expect(inviteStatus({ ...base, usedBy: 'u-zhou', usedAt: '2026-11-24T10:00:00.000Z', revokedAt: '2026-11-24T11:00:00.000Z' })).toBe('revoked');
  });
});

describe('rounds', () => {
  it('the next draft starts the day after the last due date and runs two weeks', () => {
    expect(nextRoundDraft([round({ due: '2026-12-01' })], '2026-11-24')).toEqual({ title: '', kind: 'hard', start: '2026-12-02', due: '2026-12-15' });
    expect(nextRoundDraft([], '2026-11-24').start).toBe('2026-11-24');
  });

  it('the next draft picks the latest due among several rounds, and crosses a month end correctly', () => {
    const rounds = [round({ id: 'r1', n: 1, due: '2026-11-09' }), round({ id: 'r2', n: 2, due: '2026-11-28' }), round({ id: 'r3', n: 3, due: '2026-11-18' })];
    expect(nextRoundDraft(rounds, '2026-11-24')).toEqual({ title: '', kind: 'hard', start: '2026-11-29', due: '2026-12-12' });
  });

  it('roundDraftError: missing title, then due before start, else null', () => {
    expect(roundDraftError(t, { title: '   ', kind: 'hard', start: '2026-12-01', due: '2026-12-14' })).toBe(t('pj.titleMissing'));
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '2026-12-10', due: '2026-12-01' })).toBe(t('pj.dueBeforeStart'));
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '2026-12-01', due: '2026-12-14' })).toBeNull();
  });

  it('roundDraftError: a cleared or invalid start or due date fails inline, naming the field', () => {
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '', due: '2026-12-14' })).toBe(t('pj.startMissing'));
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '2026-12-01', due: '' })).toBe(t('pj.dueMissing'));
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '2026-02-30', due: '2026-12-14' })).toBe(t('pj.startMissing'));
    expect(roundDraftError(t, { title: 'R2', kind: 'hard', start: '2026-12-01', due: '12/14/2026' })).toBe(t('pj.dueMissing'));
    expect(canSubmitRound(t, { title: 'R2', kind: 'hard', start: '', due: '' }, false)).toBe(false);
    // The zh-CN copy names the field too.
    const zt = createTranslator('zh-CN').t;
    expect(roundDraftError(zt, { title: 'R2', kind: 'hard', start: '', due: '2026-12-14' })).toBe(zt('pj.startMissing'));
  });

  it('roundCreateCommand sends round.created from the draft, with a trimmed title, and passes the reducer', () => {
    const d: RoundDraft = { title: '  New round  ', kind: 'cadence', start: '2026-12-01', due: '2026-12-14' };
    const cmd = roundCreateCommand('sample-atlas', d, 'rnd-x');
    expect(cmd).toEqual({ type: 'round.created', payload: { roundId: 'rnd-x', projectId: 'sample-atlas', title: 'New round', kind: 'cadence', start: '2026-12-01', due: '2026-12-14' } });
    const s = sampleWith('en', [cmd]);
    expect(s.rounds['rnd-x']).toMatchObject({ title: 'New round', kind: 'cadence', status: 'planned' });
  });

  it('an update sends only changed fields, and nothing for a delivered round', () => {
    const planned = round({ id: 'r2', n: 2, status: 'planned', title: 'R2', start: '2026-12-01', due: '2026-12-14' });
    expect(roundUpdateCommand(planned, { ...draftOf(planned), title: 'R2 renamed' })).toEqual({ type: 'round.updated', payload: { roundId: 'r2', title: 'R2 renamed' } });
    expect(roundUpdateCommand(planned, draftOf(planned))).toBeNull(); // nothing changed
    const delivered = round({ id: 'r1', n: 1, status: 'delivered', title: 'R1', start: '2026-11-01', due: '2026-11-14' });
    expect(roundUpdateCommand(delivered, { ...draftOf(delivered), title: 'x' })).toBeNull();
  });

  it('a delivered round refuses an update even when title, kind, start and due all change (the freeze is client-enforced only, not by core)', () => {
    const delivered = round({ id: 'r1', n: 1, status: 'delivered', title: 'R1', kind: 'hard', start: '2026-11-01', due: '2026-11-14' });
    expect(roundUpdateCommand(delivered, { title: 'Renamed', kind: 'cadence', start: '2026-12-01', due: '2026-12-14' })).toBeNull();
  });

  it('canSubmitRound: guards a draft error and a submit already in flight', () => {
    const valid: RoundDraft = { title: 'R2', kind: 'hard', start: '2026-12-01', due: '2026-12-14' };
    expect(canSubmitRound(t, valid, false)).toBe(true);
    expect(canSubmitRound(t, valid, true)).toBe(false); // still in flight
    expect(canSubmitRound(t, { ...valid, title: '  ' }, false)).toBe(false); // missing title
    expect(canSubmitRound(t, { ...valid, due: '2026-11-01' }, false)).toBe(false); // due before start
  });

  it('the first round of a new project becomes current (reducer)', () => {
    const s = sampleWith('en', [
      { type: 'project.created', payload: { projectId: 'p-new', name: 'New project' } },
      { type: 'round.created', payload: { roundId: 'rnd-1', projectId: 'p-new', title: 'Round one', kind: 'hard', start: '2026-12-01', due: '2026-12-14' } },
    ]);
    expect(currentRound(s, 'p-new')).toMatchObject({ id: 'rnd-1', n: 1, status: 'current' });
  });
});

describe('withToken', () => {
  it('fills every placeholder only when a token exists', () => {
    expect(withToken('A=<TOKEN> B=<TOKEN>', 'ml_x')).toBe('A=ml_x B=ml_x');
    expect(withToken('A=<TOKEN>', null)).toBe('A=<TOKEN>');
  });

  it('CODEX_ENV is the literal env line Codex is told to set before it reads MEETLESS_TOKEN', () => {
    expect(CODEX_ENV).toBe('export MEETLESS_TOKEN=<TOKEN>');
    expect(withToken(CODEX_ENV, 'ml_x')).toBe('export MEETLESS_TOKEN=ml_x');
    expect(withToken(CODEX_ENV, null)).toBe('export MEETLESS_TOKEN=<TOKEN>');
  });
});

describe('clientLabel', () => {
  const base = { id: 'c1', at: '2026-11-24T09:00:00.000Z', tokenId: 'tok-1', tool: 'search' as const, projectId: null, needCode: null, ok: true, code: null };

  it('names the two known clients, passes an unknown one through, and falls back to MCP with none at all', () => {
    expect(clientLabel({ ...base, client: 'claude-code' })).toBe('Claude Code');
    expect(clientLabel({ ...base, client: 'codex' })).toBe('Codex');
    expect(clientLabel({ ...base, client: 'my-other-agent' })).toBe('my-other-agent');
    expect(clientLabel({ ...base, client: null })).toBe('MCP');
  });
});

describe('tokenSectionErrorAfterCreate', () => {
  it('a create that follows an earlier tokens.list/tokens.create failure clears that error, not just on a fresh page', () => {
    // Regression: AgentsPage.createToken's success branch used to leave a stale tokensError in
    // place, so a create after an earlier failure still rendered the error block over the list.
    expect(tokenSectionErrorAfterCreate({ ok: true })).toBeNull();
  });

  it('a failed create sets the new error, replacing whatever was there before', () => {
    expect(tokenSectionErrorAfterCreate({ ok: false, error: 'Not implemented' })).toBe('Not implemented');
  });
});

describe('routeErrorText (ruling R22)', () => {
  it('a route this server does not have (HTTP_404) reads as a sentence, never the raw code', () => {
    expect(routeErrorText(t, errorText, 'HTTP_404')).toBe(t('pj.unsupported'));
    expect(routeErrorText(t, errorText, 'HTTP_404')).not.toContain('HTTP_404');
    const zh = createTranslator('zh-CN');
    expect(routeErrorText(zh.t, errorText, 'HTTP_404')).toBe(zh.t('pj.unsupported'));
  });

  it('every other code keeps errorText(code), and error.NOT_IMPLEMENTED is left alone', () => {
    expect(routeErrorText(t, errorText, 'FORBIDDEN')).toBe(errorText('FORBIDDEN'));
    expect(routeErrorText(t, errorText, 'HTTP_500')).toBe(t('error.generic', { code: 'HTTP_500' }));
    expect(routeErrorText(t, errorText, 'NOT_IMPLEMENTED')).toBe(errorText('NOT_IMPLEMENTED'));
    expect(t('pj.unsupported')).not.toBe(t('error.NOT_IMPLEMENTED'));
  });
});
