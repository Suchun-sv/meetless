import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashSecret, newToken } from '../src/accounts/secrets';
import { sha256 } from '../src/index';
import * as extractModule from '../src/imports/extract';
import { MAX_IMPORT_BYTES } from '../src/imports/extract';
import { cmd, http, IDS, TODAY, TOKENS, until, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';
import { minimalPdf } from './support/pdf';

const N1_TITLE = 'Export customer data to CSV';
const PDF_MEDIA = 'application/pdf';

/** Mints an agent token for `userToken`'s user; returns the plaintext token. */
async function agentToken(base: string, userToken: string, label: string): Promise<string> {
  const r = await http(base, userToken, 'POST', '/v1/tokens', { label });
  expect(r.status, `tokens.create for ${label}`).toBe(200);
  return r.json.token as string;
}

/** A GET with an optional `x-meetless-client` header and query string (`http()` cannot set custom headers). */
async function getWithHeaders(base: string, token: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Replaces every occurrence of `id` in a response body with a fixed placeholder, so two bodies that differ only in an echoed request id can be compared for everything else. */
function normaliseId(json: unknown, id: string): unknown {
  return JSON.parse(JSON.stringify(json).split(id).join('<id>'));
}

describe('agent read routes: context.get, needs.list, search, artifacts.read', () => {
  let s: TestServer;
  let team: Team;
  let linAgent: string;
  let alexAgent: string;

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
    linAgent = await agentToken(s.base, TOKENS.lin, 'lin-mcp');
    alexAgent = await agentToken(s.base, TOKENS.alex, 'alex-mcp');
  });
  afterAll(async () => {
    await s.stop();
  });

  const context = (token: string, code: string, opts: { locale?: string; client?: string } = {}) => {
    const qs = opts.locale ? `?locale=${encodeURIComponent(opts.locale)}` : '';
    return getWithHeaders(s.base, token, `/v1/projects/${team.projectId}/needs/${code}/context${qs}`, opts.client ? { 'x-meetless-client': opts.client } : {});
  };

  const listNeeds = (token: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams(extra).toString();
    return getWithHeaders(s.base, token, `/v1/projects/${team.projectId}/needs${qs ? `?${qs}` : ''}`);
  };
  const codes = (r: { json: { needs: { code: string }[] } }) => r.json.needs.map((n) => n.code);

  const find = (token: string, q: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ q, projectId: team.projectId, ...extra }).toString();
    return getWithHeaders(s.base, token, `/v1/search?${qs}`);
  };

  const readArtifact = (token: string, artifactId: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams(extra).toString();
    return getWithHeaders(s.base, token, `/v1/projects/${team.projectId}/artifacts/${artifactId}${qs ? `?${qs}` : ''}`);
  };

  const handoff = () => s.svc.current.handoffs[team.handoffId]!;

  it("context.get returns the need context in the caller's locale with version 1 + revisions and the meetless link", async () => {
    // alexAgent: Alex is not N1's handoff recipient (Lin is), so this call never records a fetch.
    const r = await context(alexAgent, 'N1');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ code: 'N1', version: 1, link: `meetless://${team.projectId}/N1`, recordedFetch: false });
    expect(r.json.markdown).toContain(N1_TITLE);
  });

  it('context.get honours an explicit locale (zh-CN labels, not the English ones)', async () => {
    const r = await context(alexAgent, 'N1', { locale: 'zh-CN' });
    expect(r.status).toBe(200);
    expect(r.json.markdown).toContain('外部需求'); // kind.ext
    expect(r.json.markdown).toContain('验收标准'); // dr.accept
    expect(r.json.markdown).not.toContain('Done when');
  });

  it("the recipient's agent token records one fetch with the client label; a repeat at the same version records nothing; after a revision the new version is recorded", async () => {
    const first = await context(linAgent, 'N1', { client: 'claude-code' });
    expect(first.status).toBe(200);
    expect(first.json.recordedFetch).toBe(true);
    expect(handoff().fetches.map((f) => [f.version, f.client])).toEqual([[1, 'claude-code']]);

    // A repeat at the same version: still recordedFetch (the version is on record), but no new fetch row.
    const again = await context(linAgent, 'N1', { client: 'claude-code' });
    expect(again.status).toBe(200);
    expect(again.json.recordedFetch).toBe(true);
    expect(handoff().fetches.map((f) => [f.version, f.client])).toEqual([[1, 'claude-code']]);

    // Alex revises N1: version 2.
    const revise = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('need.revised', { needId: team.needs.N1, revisionId: randomUUID(), text: 'Export to CSV and XLSX', why: 'client asked for XLSX too', date: TODAY }));
    expect(revise.status).toBe(201);

    const afterRevision = await context(linAgent, 'N1', { client: 'claude-code' });
    expect(afterRevision.status).toBe(200);
    expect(afterRevision.json.version).toBe(2);
    expect(afterRevision.json.recordedFetch).toBe(true);
    expect(handoff().fetches.map((f) => f.version)).toEqual([1, 2]);
  });

  it('a personal-token preview and a non-recipient agent never record a fetch, even when a fetch is actually due', async () => {
    // Revise N1 again so there is a version Lin's handoff has not fetched yet (it last fetched
    // v2, above): with nothing new due, a broken `p.kind` check would have no row to wrongly
    // append and this test would pass even if it ignored the caller's kind entirely.
    const revise = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('need.revised', { needId: team.needs.N1, revisionId: randomUUID(), text: 'Export to CSV, XLSX and JSON', why: 'and now JSON too', date: TODAY }));
    expect(revise.status).toBe(201);

    const fetchCountBefore = handoff().fetches.length;

    const personalToken = newToken('personal');
    await s.accounts.createToken({
      id: `tok-personal-${randomUUID()}`,
      kind: 'personal',
      userId: IDS.lin,
      label: 'app',
      tokenHash: hashSecret(personalToken),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    });
    const preview = await context(personalToken, 'N1');
    expect(preview.status).toBe(200);
    expect(preview.json.version).toBe(3); // the fetch really is due at this version
    expect(preview.json.recordedFetch).toBe(false);

    // alexAgent is an agent token, but Alex is not N1's handoff recipient.
    const nonRecipient = await context(alexAgent, 'N1');
    expect(nonRecipient.status).toBe(200);
    expect(nonRecipient.json.recordedFetch).toBe(false);

    expect(handoff().fetches.length).toBe(fetchCountBefore); // neither call above added a row
  });

  it('the client label falls back to the token label without x-meetless-client', async () => {
    // An isolated need/handoff so this fetch is unambiguously the first one recorded.
    const projectId = 'p-fallback';
    const needId = 'need-fallback-1';
    const handoffId = 'handoff-fallback-1';
    await s.svc.submit(IDS.alex, { id: randomUUID(), type: 'project.created', payload: { projectId, name: 'Fallback label project' } });
    await s.svc.submit(IDS.alex, { id: randomUUID(), type: 'project.member_added', payload: { projectId, userId: IDS.lin } });
    await s.svc.submit(IDS.alex, {
      id: randomUUID(),
      type: 'need.created',
      payload: { needId, projectId, kind: 'ext', title: 'Fallback label need', roundId: null, source: { src: 'meeting', date: TODAY, quote: 'fallback label need', ref: 'kickoff notes' } },
    });
    await s.svc.submit(IDS.alex, { id: randomUUID(), type: 'handoff.created', payload: { handoffId, projectId, needId, toId: IDS.lin, ask: 'look at this', due: null } });

    const linFallbackAgent = await agentToken(s.base, TOKENS.lin, 'lin-fallback-label');
    // Project p-fallback is brand new: its own code counter starts fresh, so this first `ext` need is N1.
    const r = await getWithHeaders(s.base, linFallbackAgent, `/v1/projects/${projectId}/needs/N1/context`);
    expect(r.status).toBe(200);
    expect(r.json.recordedFetch).toBe(true);

    const h = s.svc.current.handoffs[handoffId]!;
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]!.client).toBe('lin-fallback-label');
  });

  it("another user's private need answers the same NOT_FOUND as a missing code; a non-member gets NOT_A_MEMBER", async () => {
    const hidden = await context(linAgent, 'Hp1');
    const missing = await context(linAgent, 'Hx9');
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // Same shape from the same single branch either way; `details.code` is just the caller's own
    // query echoed back (not a leak), so it differs exactly as much as the two queries did.
    expect(hidden.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hp1' } } });
    expect(missing.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hx9' } } });

    const eveAgent = await agentToken(s.base, TOKENS.eve, 'eve-mcp');
    const nonMember = await context(eveAgent, 'N1');
    expect(nonMember.status).toBe(403);
    expect(nonMember.json.error.code).toBe('NOT_A_MEMBER');
  });

  it('a lower-case code resolves (n1 is N1)', async () => {
    const r = await context(alexAgent, 'n1');
    expect(r.status).toBe(200);
    expect(r.json.code).toBe('N1');
  });

  it("needs.list filters by kind, status and round, and never lists another user's private need", async () => {
    expect(codes(await listNeeds(linAgent))).not.toContain('Hp1');
    expect(codes(await listNeeds(alexAgent))).toContain('Hp1');
    expect(codes(await listNeeds(linAgent, { kind: 'hyp' }))).toEqual(['H1']);
    expect(codes(await listNeeds(linAgent, { status: 'todo' }))).toEqual(['N1']);
    expect(codes(await listNeeds(linAgent, { round: 'current' }))).toEqual(['N1', 'H1']);
    expect(codes(await listNeeds(linAgent, { round: '1' }))).toEqual(['N1', 'H1']);
    expect(codes(await listNeeds(linAgent, { round: '7' }))).toEqual([]);
  });

  it("search returns hits with need codes and finds nothing in another user's private items", async () => {
    const asLin = await find(linAgent, PRIVATE_WORD);
    expect(asLin.status).toBe(200);
    expect(asLin.json.hits).toEqual([]);

    const asAlex = await find(alexAgent, PRIVATE_WORD);
    expect(asAlex.status).toBe(200);
    expect(asAlex.json.hits.length).toBeGreaterThan(0);
    expect(asAlex.json.hits[0].needCode).toBe('Hp1');

    const named = await find(linAgent, 'csv export');
    expect(named.status).toBe(200);
    expect(named.json.hits.some((h: { needCode: string | null }) => h.needCode === 'N1')).toBe(true);
  });

  it('artifacts.read gives the latest version with derived texts and lists only visible need codes', async () => {
    const bytes = minimalPdf([['kickoff page one'], ['kickoff page two']]);
    const hash = sha256(bytes);
    await s.svc.putBlob(IDS.alex, hash, bytes, PDF_MEDIA);
    await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.version_added', { artifactId: team.artifacts.deck, versionId: 'v-deck-1', label: 'v1', date: TODAY, note: '', blobHash: hash, mediaType: PDF_MEDIA }));

    await until(() => s.svc.current.artifacts[team.artifacts.deck]?.versions.find((v) => v.id === 'v-deck-1')?.derived, 8000, 'deck v1 derived text');

    const r = await readArtifact(linAgent, team.artifacts.deck);
    expect(r.status).toBe(200);
    expect(r.json.version.id).toBe('v-deck-1');
    expect(r.json.text.join(' ')).toContain('kickoff page one');
    expect(r.json.artifact.needCodes).toEqual(['N1']);
  });

  it('artifacts.read extracts a pdf version on read when derived is still null, and gives [] without a file', async () => {
    const noWorker = await withServer({ workers: { pdfText: false } });
    try {
      await http(noWorker.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId: 'p-noworker', name: 'No worker project' }));
      await http(noWorker.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.created', { artifactId: 'art-nw', projectId: 'p-noworker', kind: 'pdf', title: 'Spec', where: 'local', needIds: [] }));

      const bytes = minimalPdf(['lazily extracted text']);
      const hash = sha256(bytes);
      await noWorker.svc.putBlob(IDS.alex, hash, bytes, PDF_MEDIA);
      await http(noWorker.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.version_added', { artifactId: 'art-nw', versionId: 'v-nw-1', label: 'v1', date: TODAY, note: '', blobHash: hash, mediaType: PDF_MEDIA }));
      expect(noWorker.svc.current.artifacts['art-nw']?.versions[0]?.derived).toBeNull();

      const agent = await agentToken(noWorker.base, TOKENS.alex, 'alex-nw');
      const r = await getWithHeaders(noWorker.base, agent, '/v1/projects/p-noworker/artifacts/art-nw');
      expect(r.status).toBe(200);
      expect(r.json.text.join(' ')).toContain('lazily extracted text');

      await http(noWorker.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.created', { artifactId: 'art-nofile', projectId: 'p-noworker', kind: 'pdf', title: 'No file', where: 'local', needIds: [] }));
      await http(noWorker.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.version_added', { artifactId: 'art-nofile', versionId: 'v-nofile-1', label: 'v1', date: TODAY, note: '', blobHash: null, mediaType: null }));
      const r2 = await getWithHeaders(noWorker.base, agent, '/v1/projects/p-noworker/artifacts/art-nofile');
      expect(r2.status).toBe(200);
      expect(r2.json.text).toEqual([]);
    } finally {
      await noWorker.stop();
    }
  });

  it("a guessed artifact id for another user's private artifact gives the same NOT_FOUND shape as a missing one", async () => {
    const missingArtifactId = `art-missing-${randomUUID()}`;
    const hiddenArtifact = await readArtifact(linAgent, team.artifacts.secret);
    const missingArtifact = await readArtifact(linAgent, missingArtifactId);
    expect(hiddenArtifact.status).toBe(404);
    expect(missingArtifact.status).toBe(404);
    expect(hiddenArtifact.json.error.code).toBe('NOT_FOUND');
    expect(missingArtifact.json.error.code).toBe('NOT_FOUND');
    // Same body once each call's own echoed artifactId is normalised away.
    expect(normaliseId(hiddenArtifact.json, team.artifacts.secret)).toEqual(normaliseId(missingArtifact.json, missingArtifactId));
  });

  it("a private item's id carried on shared work resolves to NOT_FOUND for another user (R37 regression)", async () => {
    const privInputId = `input-${randomUUID()}`;
    const importRes = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('input.imported', {
      inputId: privInputId,
      projectId: team.projectId,
      kind: 'txt',
      title: 'Private notes',
      from: null,
      date: TODAY,
      blobHash: null,
      body: [{ id: `${privInputId}-p1`, text: `notes about ${PRIVATE_WORD} dosing protocol` }],
      extracts: [],
      detector: 'manual/1',
      private: true,
    }));
    expect(importRes.status).toBe(201);

    const carrierNeedId = `need-${randomUUID()}`;
    const carrierWorkId = `work-${randomUUID()}`;
    const needRes = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('need.created', {
      needId: carrierNeedId,
      projectId: team.projectId,
      kind: 'hyp',
      title: 'Warm cache start',
      roundId: team.roundId,
      expect: 'Faster cold start',
      source: { src: 'meeting', date: TODAY, quote: 'warm cache start idea', ref: 'kickoff notes' },
      private: true,
    }));
    expect(needRes.status).toBe(201);
    const workRes = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('work.recorded', {
      workId: carrierWorkId,
      projectId: team.projectId,
      needId: carrierNeedId,
      alsoNeedId: team.needs.Hp1,
      src: 'doc',
      text: 'cross-checked against an earlier private note',
      date: TODAY,
      private: true,
    }));
    expect(workRes.status).toBe(201);
    // Sharing the primary need flips this work item to shared too; `alsoNeedId` (Hp1, still
    // private) is never touched by `need.shared` — the carried id this test guards against.
    const share = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('need.shared', { needId: carrierNeedId }));
    expect(share.status).toBe(201);
    expect(s.svc.current.work[carrierWorkId]!.privateTo).toBeNull();
    expect(s.svc.current.work[carrierWorkId]!.alsoNeedId).toBe(team.needs.Hp1);
    const carrierCode = s.svc.current.needs[carrierNeedId]!.code;
    expect(carrierCode).not.toBe('Hp1');

    // Read through the carrier itself: its own context and a search that matches its own
    // (public) text must surface the carrier fine, but never Hp1's words or id.
    const carrierCtx = await context(linAgent, carrierCode);
    expect(carrierCtx.status).toBe(200);
    expect(carrierCtx.json.markdown).toContain('cross-checked');
    expect(carrierCtx.json.markdown).not.toContain(PRIVATE_WORD);
    expect(carrierCtx.json.markdown).not.toContain('dosing');
    expect(carrierCtx.json.markdown).not.toContain(team.needs.Hp1);

    const byCrossChecked = await find(linAgent, 'cross-checked');
    expect(byCrossChecked.status).toBe(200);
    const workHit = byCrossChecked.json.hits.find((h: { kind: string; id: string }) => h.kind === 'work' && h.id === carrierWorkId);
    expect(workHit).toBeDefined();
    expect(workHit.needCode).toBe(carrierCode);
    expect(JSON.stringify(byCrossChecked.json)).not.toContain(team.needs.Hp1);

    const hidden = await context(linAgent, 'Hp1');
    const missing = await context(linAgent, 'Hx9');
    // Same shape either way (see the dedicated NOT_FOUND-equality test above for why
    // `details.code` legitimately differs: it is the caller's own query echoed back).
    expect(hidden.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hp1' } } });
    expect(missing.json).toEqual({ error: { code: 'NOT_FOUND', details: { what: 'need', projectId: team.projectId, code: 'Hx9' } } });

    const byWord = await find(linAgent, PRIVATE_WORD);
    expect(byWord.json.hits).toEqual([]);
    const byRawNeedId = await find(linAgent, team.needs.Hp1);
    expect(JSON.stringify(byRawNeedId.json)).not.toContain(team.needs.Hp1);
    const byRawInputId = await find(linAgent, privInputId);
    expect(JSON.stringify(byRawInputId.json)).not.toContain(privInputId);

    const linNeeds = await listNeeds(linAgent);
    expect(linNeeds.status).toBe(200);
    expect(linNeeds.json.needs.some((n: { code: string }) => n.code === 'Hp1')).toBe(false);
    expect(linNeeds.json.needs.some((n: { code: string }) => n.code === carrierCode)).toBe(true);

    const artifactProbe = await readArtifact(linAgent, privInputId);
    expect(artifactProbe.status).toBe(404);
    expect(artifactProbe.json.error.code).toBe('NOT_FOUND');

    for (const body of [hidden.json, byWord.json, byCrossChecked.json, linNeeds.json, artifactProbe.json, carrierCtx.json]) {
      const blob = JSON.stringify(body);
      expect(blob).not.toContain(PRIVATE_WORD);
      expect(blob).not.toContain('dosing');
      expect(blob).not.toContain(team.needs.Hp1);
    }
  });
});

describe('artifacts.read pdf fallback: only with the worker off, size-capped, one parse per version (final review I3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Creates project `projectId` with a pdf artifact and one version of `bytes`; returns the blob hash. */
  async function pdfVersion(s: TestServer, projectId: string, bytes: Uint8Array): Promise<string> {
    const hash = sha256(bytes);
    await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId, name: 'Fallback project' }));
    await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.created', { artifactId: 'art-fb', projectId, kind: 'pdf', title: 'Spec', where: 'local', needIds: [] }));
    await s.svc.putBlob(IDS.alex, hash, bytes, PDF_MEDIA);
    const v = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('artifact.version_added', { artifactId: 'art-fb', versionId: 'v-fb-1', label: 'v1', date: TODAY, note: '', blobHash: hash, mediaType: PDF_MEDIA }));
    expect(v.status).toBe(201);
    return hash;
  }
  const read = (s: TestServer, projectId: string) => http(s.base, TOKENS.alex, 'GET', `/v1/projects/${projectId}/artifacts/art-fb`);

  it('with the worker on, a version whose derived is still null reads as [] without any parse on read', async () => {
    let releaseWorker!: () => void;
    const held = new Promise<string[]>((resolve) => {
      releaseWorker = () => resolve(['worker text']);
    });
    let workerParses = 0;
    const s = await withServer({ workers: { pdfText: { parse: () => (workerParses++, held), parseTimeoutMs: 60_000, stopGraceMs: 50 } } });
    try {
      const extract = vi.spyOn(extractModule, 'extractText');
      await pdfVersion(s, 'p-fb-on', minimalPdf(['text the worker will fill']));
      await until(() => workerParses === 1, 4000, 'worker parse started');
      expect(s.svc.current.artifacts['art-fb']?.versions[0]?.derived).toBeNull();

      const r = await read(s, 'p-fb-on');
      expect(r.status).toBe(200);
      expect(r.json.text).toEqual([]);
      expect(extract).not.toHaveBeenCalled();
      releaseWorker();
      await until(() => s.svc.current.artifacts['art-fb']?.versions[0]?.derived, 4000, 'worker derived');
      expect((await read(s, 'p-fb-on')).json.text).toEqual(['worker text']);
    } finally {
      await s.stop();
    }
  });

  it('with the worker off, two concurrent reads of one version share a single parse', async () => {
    const s = await withServer({ workers: { pdfText: false } });
    try {
      await pdfVersion(s, 'p-fb-off', minimalPdf(['shared parse text']));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realExtract = extractModule.extractText;
      const extract = vi.spyOn(extractModule, 'extractText').mockImplementation(async (kind, bytes) => {
        await gate;
        return realExtract(kind, bytes);
      });
      const realView = s.svc.view.bind(s.svc);
      let views = 0;
      vi.spyOn(s.svc, 'view').mockImplementation((u) => {
        views += 1;
        return realView(u);
      });

      const first = read(s, 'p-fb-off');
      await until(() => extract.mock.calls.length === 1, 4000, 'first parse started');
      views = 0;
      const second = read(s, 'p-fb-off');
      // The second read is past `view()` and so (synchronously from there) waiting on the shared parse.
      await until(() => views >= 1, 4000, 'second read in the handler');
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.json.text.join(' ')).toContain('shared parse text');
      expect(b.json.text).toEqual(a.json.text);
      expect(extract).toHaveBeenCalledTimes(1);

      // Once settled, a later read parses again (nothing is cached past the in-flight parse).
      expect((await read(s, 'p-fb-off')).json.text).toEqual(a.json.text);
      expect(extract).toHaveBeenCalledTimes(2);
    } finally {
      await s.stop();
    }
  });

  it('with the worker off, a pdf blob over MAX_IMPORT_BYTES reads as [] without its bytes being read', async () => {
    const s = await withServer({ workers: { pdfText: false } });
    try {
      const bytes = minimalPdf(['too big to parse']);
      const hash = sha256(bytes);
      const realGet = s.svc.blobMeta.get.bind(s.svc.blobMeta);
      vi.spyOn(s.svc.blobMeta, 'get').mockImplementation(async (h) => {
        const m = await realGet(h);
        return m && h === hash ? { ...m, size: MAX_IMPORT_BYTES + 1 } : m;
      });
      await pdfVersion(s, 'p-fb-big', bytes);
      const reads = vi.spyOn(s.svc.blobFiles, 'readBytes');
      const extract = vi.spyOn(extractModule, 'extractText');

      const r = await read(s, 'p-fb-big');
      expect(r.status).toBe(200);
      expect(r.json.text).toEqual([]);
      expect(reads).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
    } finally {
      await s.stop();
    }
  });
});
