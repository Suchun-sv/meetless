import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectExtracts, projectNeeds, shareableView, toParagraphs } from '@meetless/core';
import { sha256 } from '../src/index';
import * as extractModule from '../src/imports/extract';
import { cmd, http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';

const FIX = resolve(import.meta.dirname, '../../../fixtures/office');
const fixture = (n: string) => new Uint8Array(readFileSync(resolve(FIX, n)));
const DOCX_MEDIA = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** `PUT /v1/blobs/:hash`: uploads `bytes` as `token` and returns the address it was stored at. */
async function putBlob(base: string, token: string, bytes: Uint8Array, mediaType = 'application/octet-stream'): Promise<string> {
  const hash = sha256(bytes);
  const res = await fetch(`${base}/v1/blobs/${hash}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-meetless-media-type': mediaType },
    body: bytes,
  });
  if (res.status !== 200) throw new Error(`putBlob: PUT answered ${res.status}`);
  return hash;
}

function importBody(over: Record<string, unknown>): Record<string, unknown> {
  return { inputId: randomUUID(), title: 'Import', kind: 'md', blobHash: null, text: 'placeholder text', from: null, date: TODAY, private: false, ...over };
}

async function importCall(s: TestServer, token: string, over: Record<string, unknown>) {
  return http(s.base, token, 'POST', '/v1/projects/p1/inputs', importBody(over));
}

describe('inputs.import: server-side text extraction and rule-based detection', () => {
  let s: TestServer;
  let team: Team;

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
  });
  afterAll(async () => {
    await s.stop();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a markdown import appends input.imported as the user with rules/1 extracts, and the response counts them', async () => {
    const TEXT = [
      'N1 needs to also add a phone number filter.',
      'We should add caching for H1 as well.',
      'The client must provide an API key before launch.',
    ].join('\n');
    const expected = detectExtracts(toParagraphs(TEXT, 'in1-p'), projectNeeds(shareableView(s.svc.view(IDS.alex)), 'p1'));
    // A meaningful fixture: at least one real revision extract, linked to the shared need it names.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some((x) => x.type === 'rev' && x.needId === team.needs.N1)).toBe(true);

    const res = await importCall(s, TOKENS.alex, { inputId: 'in1', title: 'Feedback notes', kind: 'md', text: TEXT });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ inputId: 'in1', seq: expect.any(Number), extracts: expected.length });
    expect(s.svc.current.inputs.in1!.extracts.map((x: { id: string }) => x.id)).toEqual(expected.map((x) => x.id));
    expect(s.svc.current.inputs.in1!.detector).toBe('rules/1');
  });

  it('a docx import extracts on the server from an uploaded blob', async () => {
    const bytes = fixture('export-design-v1.docx');
    const hash = await putBlob(s.base, TOKENS.alex, bytes, DOCX_MEDIA);

    const res = await importCall(s, TOKENS.alex, { inputId: 'in-docx', title: 'Export design doc', kind: 'docx', blobHash: hash, text: null });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ inputId: 'in-docx' });

    const stored = s.svc.current.inputs['in-docx']!;
    expect(stored.kind).toBe('docx');
    expect(stored.blobHash).toBe(hash);
    // Proves extraction ran server-side on the real docx bytes, not just stored them.
    expect(stored.body.some((p: { text: string }) => p.text.includes('Goal: customers can export customer data as a CSV file.'))).toBe(true);
    expect(res.json.extracts).toBe(stored.extracts.length);
  });

  it('retrying the same inputId returns the first seq and appends nothing', async () => {
    const headBefore = s.svc.head;
    const first = await importCall(s, TOKENS.alex, { inputId: 'in1', title: 'Feedback notes (different text, ignored)', kind: 'md', text: 'totally different text, should not be reprocessed' });
    expect(first.status).toBe(200);
    expect(s.svc.head).toBe(headBefore);
    expect(first.json.seq).toBe(s.svc.current.inputs.in1!.seq);
    // The stored input is still the first one's: its body still has the original paragraphs.
    expect(s.svc.current.inputs.in1!.body.some((p: { text: string }) => p.text.includes('N1 needs to also add a phone number filter.'))).toBe(true);
  });

  it('a retry answers from the first result even when the retried request would itself now fail (NOT_AUTHORISED / TOO_LARGE / EXTRACT_FAILED), and still appends nothing', async () => {
    const first = await importCall(s, TOKENS.alex, { inputId: 'in-retry-fail1', kind: 'md', text: 'N1 needs to also add a loyalty tier.' });
    expect(first.status).toBe(200);
    const headAfterFirst = s.svc.head;

    // Retried with a blob that would fail extraction (reason: no_text) were it actually read.
    const emptyHash = await putBlob(s.base, TOKENS.alex, new TextEncoder().encode('   \n\t  '));
    const retryExtractFail = await importCall(s, TOKENS.alex, { inputId: 'in-retry-fail1', kind: 'txt', blobHash: emptyHash, text: null });
    expect(retryExtractFail.status).toBe(200);
    expect(retryExtractFail.json).toEqual(first.json);

    // Retried with a blob alex cannot read (would fail NOT_AUTHORISED).
    const unreadableHash = await putBlob(s.base, TOKENS.lin, new TextEncoder().encode(`lin's own bytes ${randomUUID()}`));
    const retryUnreadable = await importCall(s, TOKENS.alex, { inputId: 'in-retry-fail1', kind: 'txt', blobHash: unreadableHash, text: null });
    expect(retryUnreadable.status).toBe(200);
    expect(retryUnreadable.json).toEqual(first.json);

    // Retried with text over the character cap (would fail TOO_LARGE).
    const retryTooLong = await importCall(s, TOKENS.alex, { inputId: 'in-retry-fail1', kind: 'md', blobHash: null, text: 'x'.repeat(500_001) });
    expect(retryTooLong.status).toBe(200);
    expect(retryTooLong.json).toEqual(first.json);

    // None of these three retries appended anything or changed the stored input.
    expect(s.svc.head).toBe(headAfterFirst);
    expect(s.svc.current.inputs['in-retry-fail1']!.seq).toBe(first.json.seq);
  });

  it('a retry does not run extraction again', async () => {
    const spy = vi.spyOn(extractModule, 'extractText');
    const bytes = fixture('export-design-v1.docx');
    const hash = await putBlob(s.base, TOKENS.alex, bytes, DOCX_MEDIA);

    const first = await importCall(s, TOKENS.alex, { inputId: 'in-retry-spy1', kind: 'docx', blobHash: hash, text: null });
    expect(first.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    const retry = await importCall(s, TOKENS.alex, { inputId: 'in-retry-spy1', kind: 'docx', blobHash: hash, text: null });
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);
    // The retry did not call extractText again.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('another user retrying the same inputId gets the same refusal as before (no leak of the first user’s input)', async () => {
    // Case A: the first import is private; the second user's view does not even contain it.
    const firstPrivate = await importCall(s, TOKENS.alex, { inputId: 'in-leak-a', kind: 'md', text: `Hp1 needs to also note the ${PRIVATE_WORD} result.`, private: true });
    expect(firstPrivate.status).toBe(200);
    const otherOnPrivate = await importCall(s, TOKENS.lin, { inputId: 'in-leak-a', kind: 'md', text: 'unrelated text from lin' });
    expect(otherOnPrivate.status).not.toBe(200);
    expect(otherOnPrivate.json.error).toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(JSON.stringify(otherOnPrivate.json)).not.toContain(PRIVATE_WORD);
    expect(JSON.stringify(otherOnPrivate.json)).not.toContain(String(firstPrivate.json.seq));

    // Case B: the first import is shared, so the second user's view *does* contain it, but they
    // did not import it — the short-circuit must still not answer them with alex's result.
    const firstShared = await importCall(s, TOKENS.alex, { inputId: 'in-leak-b', kind: 'md', text: 'A shared note with nothing private in it.' });
    expect(firstShared.status).toBe(200);
    const otherOnShared = await importCall(s, TOKENS.lin, { inputId: 'in-leak-b', kind: 'md', text: 'unrelated text from lin, again' });
    expect(otherOnShared.status).not.toBe(200);
    expect(otherOnShared.json.error).toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(otherOnShared.json).not.toEqual(firstShared.json);
  });

  it('the same user reusing an inputId in a second project is ALREADY_EXISTS, and nothing is written to the second project (M3)', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId: 'p-m3', name: 'Second project' }));
    expect(created.status).toBe(201);
    const first = await importCall(s, TOKENS.alex, { inputId: 'in-m3', kind: 'md', text: 'First project notes.' });
    expect(first.status).toBe(200);

    const head = s.svc.head;
    const again = await http(s.base, TOKENS.alex, 'POST', '/v1/projects/p-m3/inputs', importBody({ inputId: 'in-m3', kind: 'md', text: 'Second project notes.' }));
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ error: { code: 'ALREADY_EXISTS', details: { what: 'input', id: 'in-m3' } } });
    expect(s.svc.head).toBe(head);
    expect(Object.values(s.svc.current.inputs).filter((i) => i.projectId === 'p-m3')).toEqual([]);

    // The same refusal when the early peek does not see the stored input (the submit's own dedupe
    // answers duplicate, as in a race): checked after the submit, never answered with p1's seq.
    const realView = s.svc.view.bind(s.svc);
    vi.spyOn(s.svc, 'view').mockImplementationOnce((userId) => {
      const v = realView(userId);
      const { ['in-m3']: _hidden, ...inputs } = v.inputs;
      return { ...v, inputs };
    });
    const raced = await http(s.base, TOKENS.alex, 'POST', '/v1/projects/p-m3/inputs', importBody({ inputId: 'in-m3', kind: 'md', text: 'Second project notes.' }));
    expect(raced.status).toBe(409);
    expect(raced.json).toEqual({ error: { code: 'ALREADY_EXISTS', details: { what: 'input', id: 'in-m3' } } });
    expect(JSON.stringify(raced.json)).not.toContain(String(first.json.seq));
    expect(s.svc.head).toBe(head);

    // A genuine retry into the first project still answers from the first result.
    const retry = await importCall(s, TOKENS.alex, { inputId: 'in-m3', kind: 'md', text: 'First project notes.' });
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);
  });

  it('a shared import never links an extract to the importer’s private need', async () => {
    const TEXT = `Hp1 needs to also adjust the ${PRIVATE_WORD} dosing schedule.`;

    const shared = await importCall(s, TOKENS.alex, { inputId: 'in-shared1', title: 'Shared notes', kind: 'md', text: TEXT, private: false });
    expect(shared.status).toBe(200);
    const sharedInput = s.svc.current.inputs['in-shared1']!;
    expect(sharedInput.extracts.some((x: { needId: string | null }) => x.needId === team.needs.Hp1)).toBe(false);

    const priv = await importCall(s, TOKENS.alex, { inputId: 'in-priv1', title: 'Private notes', kind: 'md', text: TEXT, private: true });
    expect(priv.status).toBe(200);
    const privInput = s.svc.current.inputs['in-priv1']!;
    expect(privInput.extracts.some((x: { needId: string | null; type: string }) => x.needId === team.needs.Hp1 && x.type === 'rev')).toBe(true);
  });

  it('refuses a blob the user cannot read (NOT_AUTHORISED), a docx without a blob (BAD_REQUEST), more than 25 MB or 500000 characters (TOO_LARGE) and a non-member (NOT_A_MEMBER); none of these appends', async () => {
    const headBefore = s.svc.head;

    const unreadableHash = await putBlob(s.base, TOKENS.lin, new TextEncoder().encode(`lin's own bytes ${randomUUID()}`));
    const unreadable = await importCall(s, TOKENS.alex, { inputId: 'in-bad1', kind: 'txt', blobHash: unreadableHash, text: null });
    expect(unreadable.json.error).toEqual({ code: 'NOT_AUTHORISED' });

    const docxNoBlob = await importCall(s, TOKENS.alex, { inputId: 'in-bad2', kind: 'docx', blobHash: null, text: 'some text' });
    expect(docxNoBlob.json.error).toEqual({ code: 'BAD_REQUEST' });

    const bigBytes = Buffer.alloc(25 * 1024 * 1024 + 1, 65);
    const bigHash = await putBlob(s.base, TOKENS.alex, bigBytes);
    const tooBig = await importCall(s, TOKENS.alex, { inputId: 'in-bad3', kind: 'txt', blobHash: bigHash, text: null });
    expect(tooBig.json.error).toEqual({ code: 'TOO_LARGE' });

    const tooLong = await importCall(s, TOKENS.alex, { inputId: 'in-bad4', kind: 'md', blobHash: null, text: 'x'.repeat(500_001) });
    expect(tooLong.json.error).toEqual({ code: 'TOO_LARGE' });

    const notMember = await importCall(s, TOKENS.eve, { inputId: 'in-bad5', kind: 'md', blobHash: null, text: 'hello' });
    expect(notMember.json.error).toEqual({ code: 'NOT_A_MEMBER', details: {} });

    expect(s.svc.head).toBe(headBefore);
  });

  it('an extraction failure answers EXTRACT_FAILED with the reason and appends nothing', async () => {
    const headBefore = s.svc.head;
    const hash = await putBlob(s.base, TOKENS.alex, new TextEncoder().encode('   \n\t  '));

    const r = await importCall(s, TOKENS.alex, { inputId: 'in-empty1', kind: 'txt', blobHash: hash, text: null });
    expect(r.json.error).toEqual({ code: 'EXTRACT_FAILED', details: { reason: 'no_text' } });
    expect(s.svc.head).toBe(headBefore);
  });
});
