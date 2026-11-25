import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOT_RE, isProgress, openProposals, toConfirm } from '@meetless/core';
import { hashSecret, newToken } from '../src/accounts/secrets';
import { todayIso } from '../src/agentapi/write';
import { http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { seedTeam, type Team } from './seed';

/** Mints an agent token for `userToken`'s user; returns the plaintext and the token row's own id. */
async function agentToken(base: string, userToken: string, label: string): Promise<{ token: string; id: string }> {
  const r = await http(base, userToken, 'POST', '/v1/tokens', { label });
  expect(r.status, `tokens.create for ${label}`).toBe(200);
  return { token: r.json.token as string, id: r.json.info.id as string };
}

describe('agent write routes: work.record, needs.propose, needs.verdict', () => {
  let s: TestServer;
  let team: Team;
  let lin: { token: string; id: string };
  let alex: { token: string; id: string };
  let eve: { token: string; id: string };

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
    lin = await agentToken(s.base, TOKENS.lin, 'lin-mcp');
    alex = await agentToken(s.base, TOKENS.alex, 'alex-mcp');
    eve = await agentToken(s.base, TOKENS.eve, 'eve-mcp');
  });
  afterAll(async () => {
    await s.stop();
  });

  const recordWork = (token: string, code: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${s.base}/v1/projects/${team.projectId}/work`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ code, ...body }),
    }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));

  const propose = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${s.base}/v1/projects/${team.projectId}/proposals`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));

  const verdict = (token: string, code: string, body: Record<string, unknown>) =>
    fetch(`${s.base}/v1/projects/${team.projectId}/needs/${code}/verdict`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));

  it("work.record appends work by the token owner with via client and token id, src agent and today's date; it counts as progress", async () => {
    const res = await recordWork(lin.token, 'N1', { text: 'Drafted the CSV export spec' }, { 'x-meetless-client': 'codex' });
    expect(res.status).toBe(200);
    const w = s.svc.current.work[res.json.workId]!;
    expect(w.via).toEqual({ client: 'codex', tokenId: lin.id });
    expect(w.src).toBe('agent');
    expect(w.by).toBe(IDS.lin);
    expect(w.date).toBe(todayIso(s.cfg.now()));
    expect(isProgress(w)).toBe(true);
    expect(w.needId).toBe(team.needs.N1);
    expect(w.capture).toBe(false);
    expect(w.ignored).toBe(false);
  });

  it('work on my private need stays private to me', async () => {
    const res = await recordWork(alex.token, 'Hp1', { text: 'Tried a lower dose first' }, { 'x-meetless-client': 'claude-code' });
    expect(res.status).toBe(200);
    const id = res.json.workId as string;
    const w = s.svc.current.work[id]!;
    expect(w.privateTo).toBe(IDS.alex);
    expect(w.needId).toBe(team.needs.Hp1);
    // Lin (another user, not the owner) never sees this event at all.
    expect(s.svc.eventsFor(IDS.lin, 0).events.some((e) => e.type === 'work.recorded' && (e.payload as { workId?: string }).workId === id)).toBe(false);
    // Alex (the owner) does.
    expect(s.svc.eventsFor(IDS.alex, 0).events.some((e) => e.type === 'work.recorded' && (e.payload as { workId?: string }).workId === id)).toBe(true);
  });

  it("with a personal token via.tokenId is that token's id; with a dev token it is dev:<userId>", async () => {
    const personalToken = newToken('personal');
    const personalId = `tok-personal-${randomUUID()}`;
    await s.accounts.createToken({
      id: personalId,
      kind: 'personal',
      userId: IDS.lin,
      label: 'app',
      tokenHash: hashSecret(personalToken),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    });

    const viaPersonal = await recordWork(personalToken, 'N1', { text: 'Noted from the app' });
    expect(viaPersonal.status).toBe(200);
    // No `x-meetless-client` header on this call: `clientOf` falls back to the token's own label ('app').
    expect(s.svc.current.work[viaPersonal.json.workId]!.via).toEqual({ client: 'app', tokenId: personalId });

    const viaDev = await recordWork(TOKENS.lin, 'N1', { text: 'Noted from a dev session' });
    expect(viaDev.status).toBe(200);
    expect(s.svc.current.work[viaDev.json.workId]!.via).toEqual({ client: 'unknown', tokenId: `dev:${IDS.lin}` });
  });

  it("needs.propose appends proposal.created with via and the parent from parentCode, and it shows in the owner's To confirm", async () => {
    const before = openProposals(s.svc.current, team.projectId).length;
    const res = await propose(
      lin.token,
      { kind: 'ext', title: 'Add a header row to the CSV export', parentCode: 'N1' },
      { 'x-meetless-client': 'claude-code' },
    );
    expect(res.status).toBe(200);
    const proposalId = res.json.proposalId as string;
    const pr = s.svc.current.proposals[proposalId]!;
    expect(pr.via).toEqual({ client: 'claude-code', tokenId: lin.id });
    expect(pr.by).toBe(IDS.lin);
    expect(pr.parentId).toBe(team.needs.N1);
    expect(pr.status).toBe('open');

    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(before + 1);
    const confirm = toConfirm(s.svc.view(IDS.alex), IDS.alex, team.projectId, TODAY);
    const mine = confirm.proposals.find((p) => p.id === proposalId);
    expect(mine).toBeDefined();
    expect(mine!.parentId).toBe(team.needs.N1);
  });

  it('needs.verdict sets a hypothesis status and verdict; on an external need it is INVALID_EVENT', async () => {
    const res = await verdict(lin.token, 'H1', { status: 'testing', verdict: 'Early signal: load time down from 2.1s to 1.3s' });
    expect(res.status).toBe(200);
    const h = s.svc.current.needs[team.needs.H1]!;
    expect(h.status).toBe('testing');
    expect(h.verdict).toBe('Early signal: load time down from 2.1s to 1.3s');

    const headBefore = s.svc.head;
    const statusBefore = s.svc.current.needs[team.needs.N1]!.status;
    // N1 is external. Every status this route's own type permits ('testing'/'held'/'refuted'/
    // 'parked') is hypothesis-only (HYP_STATUSES): sent to a real client this never reaches
    // 'only hypotheses have a verdict' at all — core's own `statusFor` throws INVALID_STATUS
    // first (confirmed: packages/core/test/confirm.test.ts asserts exactly that for an ext need
    // given a hyp-only status). So the contract's INVALID_EVENT is answered by `setVerdict`
    // itself, from the need's own kind, before any `submit` call is even made.
    const refused = await verdict(lin.token, 'N1', { status: 'held', verdict: 'not a hypothesis' });
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('INVALID_EVENT');
    expect(s.svc.head).toBe(headBefore);
    expect(s.svc.current.needs[team.needs.N1]!.status).toBe(statusBefore);
  });

  it("needs.propose with parentCode of a private need: NOT_FOUND for someone it's hidden from, PRIVATE_ITEM for its own (shared proposal) owner; nothing appended either way", async () => {
    const headBefore1 = s.svc.head;
    const openBefore1 = openProposals(s.svc.current, team.projectId).length;
    // Lin cannot see Hp1 at all: identical NOT_FOUND shape to a genuinely missing code.
    const hiddenParent = await propose(lin.token, { kind: 'ext', title: 'Depends on the dosing work', parentCode: 'Hp1' });
    const missingParent = await propose(lin.token, { kind: 'ext', title: 'Depends on nothing real', parentCode: 'Hx9' });
    expect(hiddenParent.status).toBe(404);
    expect(hiddenParent.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hp1' } } });
    expect(missingParent.status).toBe(404);
    expect(missingParent.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hx9' } } });
    expect(s.svc.head).toBe(headBefore1);
    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(openBefore1);

    const headBefore2 = s.svc.head;
    const openBefore2 = openProposals(s.svc.current, team.projectId).length;
    // Alex can see Hp1 (it's theirs), but a proposal is always shared: core's own `checkParent`
    // refuses a shared proposal naming a still-private parent.
    const ownPrivateParent = await propose(alex.token, { kind: 'ext', title: 'Depends on my own private hypothesis', parentCode: 'Hp1' });
    expect(ownPrivateParent.status).toBe(422);
    expect(ownPrivateParent.json.error.code).toBe('PRIVATE_ITEM');
    expect(s.svc.head).toBe(headBefore2);
    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(openBefore2);
  });

  it('agent-written free text is cleaned with noDots before it is stored: work.record text/why, needs.propose title/accept/expect/verify/why, needs.verdict verdict', async () => {
    const work = await recordWork(lin.token, 'N1', { text: '• Did the export spec\n• also the XLSX variant', why: 'Because: • client asked' });
    expect(work.status).toBe(200);
    const w = s.svc.current.work[work.json.workId]!;
    expect(DOT_RE.test(w.text)).toBe(false);
    expect(w.text).toContain('Did the export spec');
    expect(DOT_RE.test(w.why!)).toBe(false);
    expect(w.why).toContain('client asked');

    const proposal = await propose(lin.token, {
      kind: 'ext',
      title: '• Add a totals row',
      accept: '• totals row present',
      expect: '• one extra row',
      verify: '• open the file',
      why: '• finance asked for it',
    });
    expect(proposal.status).toBe(200);
    const pr = s.svc.current.proposals[proposal.json.proposalId]!;
    for (const field of [pr.title, pr.accept, pr.expect, pr.verify, pr.why] as (string | null)[]) {
      expect(DOT_RE.test(field!)).toBe(false);
    }
    expect(pr.title).toContain('Add a totals row');

    const verdictRes = await verdict(lin.token, 'H1', { status: 'held', verdict: '• holding: needs another round of data' });
    expect(verdictRes.status).toBe(200);
    const h = s.svc.current.needs[team.needs.H1]!;
    expect(DOT_RE.test(h.verdict!)).toBe(false);
    expect(h.verdict).toContain('holding: needs another round of data');
  });

  it('a required field that is empty once noDots-cleaned (bullet-only) is BAD_REQUEST naming the field, before anything is appended; an optional one stores null instead', async () => {
    const headBefore = s.svc.head;
    const openBefore = openProposals(s.svc.current, team.projectId).length;

    // work.record: text is required.
    const badWork = await recordWork(lin.token, 'N1', { text: '•' });
    expect(badWork.status).toBe(400);
    expect(badWork.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'text' } } });
    expect(s.svc.head).toBe(headBefore);

    // needs.propose: title is required.
    const badTitle = await propose(lin.token, { kind: 'ext', title: '•' });
    expect(badTitle.status).toBe(400);
    expect(badTitle.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'title' } } });
    expect(s.svc.head).toBe(headBefore);
    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(openBefore);

    // needs.verdict: verdict is required — a bullet-only one must not silently become a stored
    // blank verdict on an otherwise-successful status change.
    const statusBefore = s.svc.current.needs[team.needs.H1]!.status;
    const verdictBefore = s.svc.current.needs[team.needs.H1]!.verdict;
    const badVerdict = await verdict(lin.token, 'H1', { status: 'testing', verdict: '•' });
    expect(badVerdict.status).toBe(400);
    expect(badVerdict.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'verdict' } } });
    expect(s.svc.head).toBe(headBefore);
    expect(s.svc.current.needs[team.needs.H1]!.status).toBe(statusBefore);
    expect(s.svc.current.needs[team.needs.H1]!.verdict).toBe(verdictBefore);

    // work.record's `why` is optional: the same bullet-only input stores null, not BAD_REQUEST
    // and not a blank string.
    const okWithEmptyWhy = await recordWork(lin.token, 'N1', { text: 'A real report', why: '•' });
    expect(okWithEmptyWhy.status).toBe(200);
    expect(s.svc.current.work[okWithEmptyWhy.json.workId]!.why).toBeNull();
  });

  it('clean/cleanOpt refuse a non-string value (and clean refuses an omitted required one) with BAD_REQUEST naming the field, before anything is appended', async () => {
    const headBefore = s.svc.head;
    const openBefore = openProposals(s.svc.current, team.projectId).length;

    // work.record: text is required — a number, and an omitted field, are both BAD_REQUEST.
    const numberText = await recordWork(lin.token, 'N1', { text: 5 });
    expect(numberText.status).toBe(400);
    expect(numberText.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'text' } } });
    const missingText = await recordWork(lin.token, 'N1', {});
    expect(missingText.status).toBe(400);
    expect(missingText.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'text' } } });
    // why is optional, but a present non-string is still refused, not silently dropped to null.
    const numberWhy = await recordWork(lin.token, 'N1', { text: 'A real report', why: 5 });
    expect(numberWhy.status).toBe(400);
    expect(numberWhy.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'why' } } });
    expect(s.svc.head).toBe(headBefore);

    // needs.propose: title is required.
    const numberTitle = await propose(lin.token, { kind: 'ext', title: 5 });
    expect(numberTitle.status).toBe(400);
    expect(numberTitle.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'title' } } });
    const missingTitle = await propose(lin.token, { kind: 'ext' });
    expect(missingTitle.status).toBe(400);
    expect(missingTitle.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'title' } } });
    expect(s.svc.head).toBe(headBefore);
    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(openBefore);

    // needs.verdict: verdict is required.
    const statusBefore = s.svc.current.needs[team.needs.H1]!.status;
    const verdictBefore = s.svc.current.needs[team.needs.H1]!.verdict;
    const numberVerdict = await verdict(lin.token, 'H1', { status: 'testing', verdict: 5 });
    expect(numberVerdict.status).toBe(400);
    expect(numberVerdict.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'verdict' } } });
    const missingVerdict = await verdict(lin.token, 'H1', { status: 'testing' });
    expect(missingVerdict.status).toBe(400);
    expect(missingVerdict.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'verdict' } } });
    expect(s.svc.head).toBe(headBefore);
    expect(s.svc.current.needs[team.needs.H1]!.status).toBe(statusBefore);
    expect(s.svc.current.needs[team.needs.H1]!.verdict).toBe(verdictBefore);
  });

  it('write routes refuse another user’s private need (NOT_FOUND) and a non-member (NOT_A_MEMBER), and the refusals show in agentCalls with ok false', async () => {
    const headBefore = s.svc.head;
    const hidden = await recordWork(lin.token, 'Hp1', { text: 'should never land' });
    expect(hidden.status).toBe(404);
    expect(hidden.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hp1' } } });

    const nonMember = await recordWork(eve.token, 'N1', { text: 'should never land either' });
    expect(nonMember.status).toBe(403);
    expect(nonMember.json.error.code).toBe('NOT_A_MEMBER');

    expect(s.svc.head).toBe(headBefore);

    const linCalls = await s.accounts.listCalls(IDS.lin, 20);
    expect(linCalls[0]).toMatchObject({ tool: 'record_work', ok: false, code: 'NOT_FOUND', projectId: team.projectId });

    const eveCalls = await s.accounts.listCalls(IDS.eve, 20);
    expect(eveCalls[0]).toMatchObject({ tool: 'record_work', ok: false, code: 'NOT_A_MEMBER', projectId: team.projectId });
  });
});
