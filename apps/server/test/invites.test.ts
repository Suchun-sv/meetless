import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DOT_RE } from '@meetless/core';
import { cmd, http, TOKENS, withServer, type TestServer } from './helpers';
import { seedTeam, type Team } from './seed';

/** Opens an authenticated websocket and resolves once it is open. */
function wsOpen(base: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`, { headers: { authorization: `Bearer ${token}` } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const closeCode = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));

describe('invites', () => {
  let s: TestServer;
  let team: Team;

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
  });

  afterAll(() => s.stop());

  it('a member creates a project invite with a role; redeeming it registers the user, adds them to the project and the role, and returns a working personal token', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: team.roleId });
    expect(created.status).toBe(200);
    const { code } = created.json;

    const r = await http(s.base, null, 'POST', '/v1/invites/redeem', {
      code: code.toLowerCase().replaceAll('-', ' '),
      displayName: ' Kai ',
      locale: 'en',
    });
    expect(r.status).toBe(200);
    expect(r.json.projectId).toBe(team.projectId);
    expect(r.json.token).toMatch(/^mlp_/);
    expect(r.json.user.displayName).toBe('Kai');
    expect(r.json.user.locale).toBe('en');

    expect(s.svc.current.projects[team.projectId]!.memberIds).toContain(r.json.user.id);
    expect(s.svc.current.roles[team.roleId]!.memberIds).toContain(r.json.user.id);
    expect(s.svc.current.users[r.json.user.id]!.displayName).toBe('Kai');

    const me = await http(s.base, r.json.token, 'GET', '/v1/me');
    expect(me.json.user.id).toBe(r.json.user.id);
  });

  it('M6: redeeming a code padded with tabs, newlines, NBSP and full-width spaces, in mixed case, still works', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const { code } = created.json; // "XXXX-XXXX-XXXX", upper case Crockford
    const groups = code.split('-').map((g: string) => g.toLowerCase());
    const padded = `\t\u00A0${groups[0]}\n -\u3000 ${groups[1]} \t-\n${groups[2]}\u00A0\t`;

    const r = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: padded, displayName: 'Padded', locale: 'en' });
    expect(r.status).toBe(200);
    expect(r.json.projectId).toBe(team.projectId);
    expect(r.json.user.displayName).toBe('Padded');

    const again = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: padded, displayName: 'Padded2', locale: 'en' });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('INVITE_USED');
  });

  it('a second redeem answers INVITE_USED; a revoked or unknown code answers INVITE_INVALID', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const { code } = created.json;

    const first = await http(s.base, null, 'POST', '/v1/invites/redeem', { code, displayName: 'Rin', locale: 'en' });
    expect(first.status).toBe(200);

    const second = await http(s.base, null, 'POST', '/v1/invites/redeem', { code, displayName: 'Rin2', locale: 'en' });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('INVITE_USED');

    const unknown = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe('INVITE_INVALID');

    const toRevoke = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const revokeRes = await http(s.base, TOKENS.alex, 'DELETE', `/v1/projects/${team.projectId}/invites/${toRevoke.json.invite.id}`);
    expect(revokeRes.status).toBe(200);
    const revokedTry = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: toRevoke.json.code, displayName: 'Y', locale: 'en' });
    expect(revokedTry.status).toBe(404);
    expect(revokedTry.json.error.code).toBe('INVITE_INVALID');
  });

  it('two concurrent redeems create exactly one user', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const { code } = created.json;
    const redeem = (displayName: string) => http(s.base, null, 'POST', '/v1/invites/redeem', { code, displayName, locale: 'en' });

    const [a, b] = await Promise.all([redeem('Concurrent A'), redeem('Concurrent B')]);
    const results = [a, b].map((x) => x.json.error?.code ?? 'ok').sort();
    expect(results).toEqual(['INVITE_USED', 'ok']);
  });

  it('a non-member cannot create, list or revoke invites (NOT_A_MEMBER); a role from another project is NOT_FOUND', async () => {
    const create = await http(s.base, TOKENS.eve, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    expect(create.status).toBe(403);
    expect(create.json.error.code).toBe('NOT_A_MEMBER');

    const list = await http(s.base, TOKENS.eve, 'GET', `/v1/projects/${team.projectId}/invites`);
    expect(list.status).toBe(403);
    expect(list.json.error.code).toBe('NOT_A_MEMBER');

    const revoke = await http(s.base, TOKENS.eve, 'DELETE', `/v1/projects/${team.projectId}/invites/anything`);
    expect(revoke.status).toBe(403);
    expect(revoke.json.error.code).toBe('NOT_A_MEMBER');

    const otherProjectId = 'p-other';
    const otherRoleId = 'r-other';
    const createProject = await http(s.base, TOKENS.ben, 'POST', '/v1/commands', cmd('project.created', { projectId: otherProjectId, name: 'Other project' }));
    expect(createProject.status).toBe(201);
    const createRole = await http(s.base, TOKENS.ben, 'POST', '/v1/commands', cmd('role.created', { roleId: otherRoleId, projectId: otherProjectId, name: 'Other role' }));
    expect(createRole.status).toBe(201);

    const badRole = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: otherRoleId });
    expect(badRole.status).toBe(404);
    expect(badRole.json.error.code).toBe('NOT_FOUND');
  });

  it('list shows used and revoked state and never the code', async () => {
    const used = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const redeemed = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: used.json.code, displayName: 'Used', locale: 'en' });
    expect(redeemed.status).toBe(200);

    const revoked = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const revokeRes = await http(s.base, TOKENS.alex, 'DELETE', `/v1/projects/${team.projectId}/invites/${revoked.json.invite.id}`);
    expect(revokeRes.status).toBe(200);

    const list = await http(s.base, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/invites`);
    expect(list.status).toBe(200);
    const usedEntry = list.json.invites.find((i: { id: string }) => i.id === used.json.invite.id);
    const revokedEntry = list.json.invites.find((i: { id: string }) => i.id === revoked.json.invite.id);
    expect(usedEntry.usedAt).not.toBeNull();
    expect(usedEntry.revokedAt).toBeNull();
    expect(revokedEntry.revokedAt).not.toBeNull();
    expect(revokedEntry.usedAt).toBeNull();

    const body = JSON.stringify(list.json);
    expect(body).not.toContain(used.json.code.replaceAll('-', ''));
    expect(body).not.toContain(revoked.json.code.replaceAll('-', ''));
  });

  it('a display name with dot symbols is stored without them', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const r = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: created.json.code, displayName: 'Kai · Lee', locale: 'en' });
    expect(r.status).toBe(200);
    expect(DOT_RE.test(r.json.user.displayName)).toBe(false);
    expect(DOT_RE.test(s.svc.current.users[r.json.user.id]!.displayName)).toBe(false);
  });

  it('session.revoke ends the personal token: the next request answers TOKEN_REVOKED and its open websocket closes with 4401', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${team.projectId}/invites`, { roleId: null });
    const r = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: created.json.code, displayName: 'Sess', locale: 'en' });
    expect(r.status).toBe(200);
    const token = r.json.token;

    const ws = await wsOpen(s.base, token);
    const closed = closeCode(ws);

    const revoke = await http(s.base, token, 'DELETE', '/v1/session');
    expect(revoke.status).toBe(200);
    expect(revoke.json).toEqual({ revoked: true });

    expect(await closed).toBe(4401);

    const me = await http(s.base, token, 'GET', '/v1/me');
    expect(me.status).toBe(401);
    expect(me.json.error.code).toBe('TOKEN_REVOKED');

    const devRevoke = await http(s.base, TOKENS.alex, 'DELETE', '/v1/session');
    expect(devRevoke.status).toBe(403);
    expect(devRevoke.json.error.code).toBe('NOT_AUTHORISED');
  });
});
