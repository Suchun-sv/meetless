import { describe, expect, it, vi } from 'vitest';
import type { MeetlessBridge, SubmitResult } from '@meetless/client/bridge';
import { fakeApi, fakeBridge } from '../support/app';
import { Log } from '../support/log';
import { importFile, importMarkdown } from '../../src/renderer/inputs/importer';
import { scrollToPara } from '../../src/renderer/inputs/InputSheet';
import {
  blockedFor,
  decodeText,
  EXTRACT_TONE,
  extractAction,
  inputGroups,
  kindFromName,
  MAX_IMPORT_BYTES,
  mdTitle,
  paraExtract,
  requesterFrom,
  requesterLabel,
  selectedInput,
  sharePrivateNeedIds,
} from '../../src/renderer/inputs/model';

describe('kindFromName', () => {
  it('maps md, markdown, txt, docx and pdf (case-insensitive); rejects doc, rtf and no extension', () => {
    expect(kindFromName('a.md')).toBe('md');
    expect(kindFromName('a.MD')).toBe('md');
    expect(kindFromName('a.markdown')).toBe('md');
    expect(kindFromName('A.MARKDOWN')).toBe('md');
    expect(kindFromName('a.txt')).toBe('txt');
    expect(kindFromName('a.TXT')).toBe('txt');
    expect(kindFromName('a.docx')).toBe('docx');
    expect(kindFromName('a.DOCX')).toBe('docx');
    expect(kindFromName('a.pdf')).toBe('pdf');
    expect(kindFromName('a.PDF')).toBe('pdf');
    expect(kindFromName('a.doc')).toBeNull();
    expect(kindFromName('a.rtf')).toBeNull();
    expect(kindFromName('noext')).toBeNull();
  });
});

describe('MAX_IMPORT_BYTES', () => {
  it('is 20 MiB', () => {
    expect(MAX_IMPORT_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('decodeText', () => {
  it('strips a BOM and turns CRLF into LF', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('a\r\nb')]);
    expect(decodeText(bytes)).toBe('a\nb');
  });

  it('leaves text with no BOM and no CRLF alone', () => {
    expect(decodeText(new TextEncoder().encode('a\nb'))).toBe('a\nb');
  });
});

describe('mdTitle', () => {
  it('uses the title, else the first line clipped to 30, with one .md', () => {
    expect(mdTitle('', '# 组会纪要\n希望……')).toBe('组会纪要.md');
    expect(mdTitle('x.md', 'y')).toBe('x.md');
    expect(mdTitle('Notes', 'anything')).toBe('Notes.md');
  });

  it('clips a long first line to 30 characters before adding .md, once', () => {
    const longLine = 'x'.repeat(40);
    const title = mdTitle('', longLine);
    expect(title.endsWith('.md')).toBe(true);
    expect(title).not.toMatch(/\.md\.md$/);
    expect(title.length).toBe(30 + 3); // clip(40, 30) -> 29 chars + ellipsis = 30, plus ".md"
  });
});

describe('requesterFrom', () => {
  it('resolves a member by displayName case-insensitively, else keeps the name as given; empty text is null', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-mia', displayName: 'Mia', locale: 'en' });
    log.emit('project.created', 'u-mia', { projectId: 'p1', name: 'P1' });
    expect(requesterFrom(log.state, 'p1', '')).toBeNull();
    expect(requesterFrom(log.state, 'p1', '   ')).toBeNull();
    expect(requesterFrom(log.state, 'p1', 'mia')).toEqual({ userId: 'u-mia' });
    expect(requesterFrom(log.state, 'p1', 'MIA')).toEqual({ userId: 'u-mia' });
    expect(requesterFrom(log.state, 'p1', 'Prof. Zhang')).toEqual({ name: 'Prof. Zhang' });
  });
});

describe('requesterLabel', () => {
  it('resolves a member id to a display name, keeps a bare name, and is null for none', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-mia', displayName: 'Mia', locale: 'en' });
    expect(requesterLabel(log.state, { userId: 'u-mia' })).toBe('Mia');
    expect(requesterLabel(log.state, { name: 'Venue' })).toBe('Venue');
    expect(requesterLabel(log.state, null)).toBeNull();
  });

  // Fix round 1, Important 2: a free-typed requester name is user text and must never carry a dot.
  it('strips a dot from a free-typed name and from a member displayName', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-mia', displayName: '张·老师', locale: 'en' });
    expect(requesterLabel(log.state, { name: '王·老师' })).toBe('王 老师');
    expect(requesterLabel(log.state, { userId: 'u-mia' })).toBe('张 老师');
  });
});

describe('scrollToPara (ruling R13)', () => {
  it('scrolls the matching paragraph into view; does nothing for a null paraId or a missing container', () => {
    const scrollIntoView = vi.fn();
    const el = { scrollIntoView };
    const querySelector = vi.fn(() => el as unknown as Element);
    const container = { querySelector } as unknown as HTMLElement;

    scrollToPara(container, 'p1');
    expect(querySelector).toHaveBeenCalledWith('[data-para="p1"]');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    scrollToPara(container, null);
    scrollToPara(container, undefined);
    expect(querySelector).toHaveBeenCalledTimes(1); // still only the one call above

    scrollToPara(null, 'p1');
    expect(querySelector).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the container has no matching element', () => {
    const querySelector = vi.fn(() => null);
    const container = { querySelector } as unknown as HTMLElement;
    expect(() => scrollToPara(container, 'missing')).not.toThrow();
  });
});

function importInput(log: Log, opts: { inputId: string; projectId: string; date: string; text: string }) {
  log.emit('input.imported', 'u-me', {
    inputId: opts.inputId,
    projectId: opts.projectId,
    kind: 'txt',
    title: 'T',
    date: opts.date,
    body: [{ id: 'pa1', text: opts.text }],
    extracts: [{ id: 'x1', type: 'new', text: opts.text, paraId: 'pa1' }],
    detector: 'rules/1',
  });
}

describe('inputGroups and selectedInput', () => {
  function setup() {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
    log.emit('project.created', 'u-me', { projectId: 'p2', name: 'P2' });
    importInput(log, { inputId: 'in-done', projectId: 'p1', date: '2026-11-20', text: 'hello' });
    log.emit('extract.ignored', 'u-me', { inputId: 'in-done', extractId: 'x1' });
    importInput(log, { inputId: 'in-pending', projectId: 'p1', date: '2026-11-24', text: 'world' });
    return log;
  }

  it('groups by whether every extract has been decided', () => {
    const log = setup();
    const { pending, done } = inputGroups(log.state, 'p1');
    expect(pending.map((i) => i.id)).toEqual(['in-pending']);
    expect(done.map((i) => i.id)).toEqual(['in-done']);
  });

  it('selects the focused input, else the first pending one, else the first of the list', () => {
    const log = setup();
    expect(selectedInput(log.state, 'p1', 'in-done')?.id).toBe('in-done');
    expect(selectedInput(log.state, 'p1', null)?.id).toBe('in-pending');
    expect(selectedInput(log.state, 'p1', 'missing')?.id).toBe('in-pending');
    expect(selectedInput(log.state, 'p2', null)).toBeNull();
  });

  it('falls back to the first of the list when nothing is pending', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
    importInput(log, { inputId: 'in-done', projectId: 'p1', date: '2026-11-20', text: 'hello' });
    log.emit('extract.ignored', 'u-me', { inputId: 'in-done', extractId: 'x1' });
    expect(selectedInput(log.state, 'p1', null)?.id).toBe('in-done');
  });
});

describe('paraExtract', () => {
  it('maps a paragraph id to the extract that points at it', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
    log.emit('input.imported', 'u-me', {
      inputId: 'in1',
      projectId: 'p1',
      kind: 'txt',
      title: 'T',
      date: '2026-11-24',
      body: [
        { id: 'pa1', text: 'a' },
        { id: 'pa2', text: 'b' },
      ],
      extracts: [{ id: 'x1', type: 'new', text: 'a', paraId: 'pa1' }],
      detector: 'rules/1',
    });
    const input = log.state.inputs.in1!;
    expect(paraExtract(input)).toEqual({ pa1: 'x1' });
  });
});

describe('EXTRACT_TONE', () => {
  it('maps every extract type to its tone', () => {
    expect(EXTRACT_TONE).toEqual({ new: 'strong', hyp: 'info', rev: 'warning', action: 'neutral' });
  });
});

describe('extractAction', () => {
  function buildInput(conflict: boolean, isPrivate: boolean) {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p1',
      kind: 'ext',
      title: 'Need',
      roundId: null,
      source: { src: 'doc', date: '2026-11-24', quote: 'q', ref: 'r' },
    });
    log.emit('input.imported', 'u-me', {
      inputId: 'in1',
      projectId: 'p1',
      kind: 'txt',
      title: 'T',
      date: '2026-11-24',
      body: [{ id: 'pa1', text: 'a' }],
      extracts: [{ id: 'x1', type: 'rev', text: 'a', paraId: 'pa1', needId: 'n1', conflict }],
      detector: 'rules/1',
      private: isPrivate,
    });
    return log.state.inputs.in1!;
  }

  it('a conflict on a shared input is decide; the same conflict stays open while the input is private', () => {
    const shared = buildInput(true, false);
    expect(extractAction(shared, shared.extracts[0]!)).toBe('decide');

    const priv = buildInput(true, true);
    expect(extractAction(priv, priv.extracts[0]!)).toBe('open');
  });

  it('no conflict is open; accepted and ignored follow the extract state', () => {
    const input = buildInput(false, false);
    const x = input.extracts[0]!;
    expect(extractAction(input, x)).toBe('open');
    expect(extractAction(input, { ...x, state: 'accepted' })).toBe('accepted');
    expect(extractAction(input, { ...x, state: 'ignored' })).toBe('ignored');
  });
});

describe('sharePrivateNeedIds', () => {
  it('returns the blocked need ids on a PRIVATE_ITEM rejection, else null', () => {
    const blocked: SubmitResult = { kind: 'rejected', code: 'PRIVATE_ITEM', details: { needIds: ['n1', 'n2'] } };
    expect(sharePrivateNeedIds(blocked)).toEqual(['n1', 'n2']);
    expect(sharePrivateNeedIds({ kind: 'rejected', code: 'PRIVATE_ITEM' })).toBeNull();
    expect(sharePrivateNeedIds({ kind: 'rejected', code: 'OTHER' })).toBeNull();
    expect(sharePrivateNeedIds({ kind: 'accepted', seq: 1 })).toBeNull();
    expect(sharePrivateNeedIds({ kind: 'duplicate', seq: 1 })).toBeNull();
    expect(sharePrivateNeedIds({ kind: 'queued' })).toBeNull();
  });
});

describe('blockedFor', () => {
  // Fix round 2, Important 1: a refusal recorded for input A must never leak into a render for a
  // different input B, including the one render that shows B before any effect could run.
  it('yields the recorded need ids only for the input the refusal belongs to; null for a different input or no refusal', () => {
    const blocked = { inputId: 'in-A', needIds: ['n1', 'n2'] };
    expect(blockedFor(blocked, 'in-A')).toEqual(['n1', 'n2']);
    expect(blockedFor(blocked, 'in-B')).toBeNull();
    expect(blockedFor(blocked, null)).toBeNull();
    expect(blockedFor(blocked, undefined)).toBeNull();
    expect(blockedFor(null, 'in-A')).toBeNull();
  });
});

/** An AppApi backed by a fakeBridge that counts uploads and submits (importer tests). */
function trackedApp(overrides: Partial<MeetlessBridge> = {}) {
  const calls = { uploads: 0, submits: 0 };
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
  const bridge = fakeBridge({
    uploadBlob: async (bytes) => {
      calls.uploads++;
      return { ok: true as const, hash: 'blob-1', size: bytes.length };
    },
    submit: async () => {
      calls.submits++;
      return { kind: 'accepted' as const, seq: 1 };
    },
    api: async () => ({ ok: false as const, code: 'HTTP_404' }),
    ...overrides,
  });
  const api = fakeApi({ live: log.state, me: 'u-me', today: '2026-11-24', bridge });
  return { api, calls };
}

describe('importFile', () => {
  it('refuses BAD_TYPE, EMPTY_FILE and TOO_LARGE without uploading or submitting', async () => {
    const { api, calls } = trackedApp();

    expect(await importFile(api, { projectId: 'p1', name: 'a.doc', bytes: new Uint8Array([1]), from: null, private: false })).toEqual({
      ok: false,
      code: 'BAD_TYPE',
    });
    expect(await importFile(api, { projectId: 'p1', name: 'a.txt', bytes: new Uint8Array(0), from: null, private: false })).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(
      await importFile(api, { projectId: 'p1', name: 'a.txt', bytes: new TextEncoder().encode('   \n  '), from: null, private: false }),
    ).toEqual({ ok: false, code: 'EMPTY_FILE' });
    expect(
      await importFile(api, { projectId: 'p1', name: 'a.pdf', bytes: new Uint8Array(MAX_IMPORT_BYTES + 1), from: null, private: false }),
    ).toEqual({ ok: false, code: 'TOO_LARGE' });

    expect(calls.uploads).toBe(0);
    expect(calls.submits).toBe(0);
  });

  it('a docx import uploads the blob and calls inputs.import with text null; an api error code is returned as is', async () => {
    const seen: [string, { text: string | null; blobHash: string | null; kind: string }][] = [];
    const { api, calls } = trackedApp({
      api: async (name, input) => {
        seen.push([name, input as never]);
        return { ok: false as const, code: 'HTTP_404' };
      },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await importFile(api, { projectId: 'p1', name: 'report.docx', bytes, from: null, private: false });
    expect(result).toEqual({ ok: false, code: 'HTTP_404' });
    expect(calls.uploads).toBe(1);
    expect(calls.submits).toBe(0);
    expect(seen).toHaveLength(1);
    const [name, input] = seen[0]!;
    expect(name).toBe('inputs.import');
    expect(input.text).toBeNull();
    expect(input.blobHash).toBe('blob-1');
    expect(input.kind).toBe('docx');
  });

  it('a markdown import calls inputs.import with the text and blobHash null', async () => {
    const seen: [string, { text: string | null; blobHash: string | null; kind: string }][] = [];
    const { api, calls } = trackedApp({
      api: async (name, input) => {
        seen.push([name, input as never]);
        return { ok: true as const, data: { inputId: 'in1', seq: 1, extracts: 0 } };
      },
    });
    const bytes = new TextEncoder().encode('要求：导出要快');
    const result = await importFile(api, { projectId: 'p1', name: 'note.md', bytes, from: null, private: false });
    expect(result.ok).toBe(true);
    expect(calls.uploads).toBe(0);
    expect(calls.submits).toBe(0);
    expect(seen).toHaveLength(1);
    const [name, input] = seen[0]!;
    expect(name).toBe('inputs.import');
    expect(input.text).toBe('要求：导出要快');
    expect(input.blobHash).toBeNull();
    expect(input.kind).toBe('md');
    expect(api.route).toEqual({ view: 'inputs', projectId: 'p1', focusId: (result as { ok: true; inputId: string }).inputId });
  });
});

describe('importMarkdown', () => {
  it('refuses a blank note without calling the api', async () => {
    const { api, calls } = trackedApp();
    expect(await importMarkdown(api, { projectId: 'p1', title: '', text: '   ', from: null, private: false })).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(calls.submits).toBe(0);
  });

  it('calls inputs.import with the text and blobHash null, and navigates to the new input on success', async () => {
    const seen: [string, { text: string | null; blobHash: string | null; kind: string }][] = [];
    const { api } = trackedApp({
      api: async (name, input) => {
        seen.push([name, input as never]);
        return { ok: true as const, data: { inputId: 'in1', seq: 1, extracts: 0 } };
      },
    });
    const ok = await importMarkdown(api, { projectId: 'p1', title: 'Notes', text: '要求：导出要快', from: null, private: false });
    expect(ok.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const [name, input] = seen[0]!;
    expect(name).toBe('inputs.import');
    expect(input.text).toBe('要求：导出要快');
    expect(input.blobHash).toBeNull();
    expect(input.kind).toBe('md');
    expect(api.route).toEqual({ view: 'inputs', projectId: 'p1', focusId: (ok as { ok: true; inputId: string }).inputId });
  });

  it('returns an api error code as is, without navigating', async () => {
    const { api } = trackedApp(); // default api mock answers HTTP_404, as a route the server has not accepted would
    const result = await importMarkdown(api, { projectId: 'p1', title: 'Notes', text: '要求：导出要快', from: null, private: false });
    expect(result).toEqual({ ok: false, code: 'HTTP_404' });
  });
});
