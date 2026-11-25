import { describe, expect, it } from 'vitest';
import { createTranslator, formatDay } from '@meetless/i18n';
import { SEP } from '@meetless/core';
import { Log } from '../support/log';
import {
  DEFAULT_WHERE,
  acceptFor,
  agentPrompt,
  artifactList,
  checkUrl,
  fileKinds,
  mediaTypeFor,
  selectedArtifact,
  selectedVersion,
  shareState,
  uploadVersionFile,
  versionLine,
} from '../../src/renderer/artifacts/model';

const tr = createTranslator('en');
const t = tr.t;
const fmtDay = (d: string) => formatDay(d, 'en');

function setup() {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
  log.emit('project.created', 'u-me', { projectId: 'p2', name: 'P2' });
  return log;
}

describe('artifactList', () => {
  it('is newest first and holds only the project’s artifacts', () => {
    const log = setup();
    // A: created early (low seq), p1
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p1', kind: 'pdf', title: 'A', where: 'PDF', needIds: [] });
    // B: created later (higher seq than A's creation), p1
    log.emit('artifact.created', 'u-me', { artifactId: 'a2', projectId: 'p1', kind: 'pdf', title: 'B', where: 'PDF', needIds: [] });
    // C: in another project, must never show in p1's list
    log.emit('artifact.created', 'u-me', { artifactId: 'a3', projectId: 'p2', kind: 'pdf', title: 'C', where: 'PDF', needIds: [] });
    // A gets a new version after B was created: A's rank (max(seq, newest version seq)) should overtake B.
    log.emit('artifact.version_added', 'u-me', {
      artifactId: 'a1',
      versionId: 'a1:v1',
      label: 'v1',
      date: '2026-11-24',
      note: '',
    });
    const list = artifactList(log.state, 'p1');
    expect(list.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(list.every((a) => a.projectId === 'p1')).toBe(true);
  });
});

describe('selectedArtifact', () => {
  it('returns the focused artifact, else the first of the list', () => {
    const log = setup();
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p1', kind: 'pdf', title: 'A', where: 'PDF', needIds: [] });
    log.emit('artifact.created', 'u-me', { artifactId: 'a2', projectId: 'p1', kind: 'pdf', title: 'B', where: 'PDF', needIds: [] });
    expect(selectedArtifact(log.state, 'p1', 'a2')?.id).toBe('a2');
    expect(selectedArtifact(log.state, 'p1', null)?.id).toBe('a2'); // a2 ranks first: created after a1, no versions on either
    expect(selectedArtifact(log.state, 'p1', 'missing')?.id).toBe('a2');
    expect(selectedArtifact(log.state, 'p2', null)).toBeNull();
  });
});

describe('selectedVersion', () => {
  it('returns the named version when it belongs to the artifact, else the newest', () => {
    const log = setup();
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p1', kind: 'pdf', title: 'A', where: 'PDF', needIds: [] });
    log.emit('artifact.version_added', 'u-me', { artifactId: 'a1', versionId: 'a1:v1', label: 'v1', date: '2026-11-20', note: '' });
    log.emit('artifact.version_added', 'u-me', { artifactId: 'a1', versionId: 'a1:v2', label: 'v2', date: '2026-11-24', note: '' });
    const a = log.state.artifacts.a1!;
    expect(selectedVersion(a, 'a1:v1')?.id).toBe('a1:v1');
    expect(selectedVersion(a, null)?.id).toBe('a1:v2'); // newest first
    expect(selectedVersion(a, 'not-a-version')?.id).toBe('a1:v2');
  });
});

describe('checkUrl', () => {
  it('Overleaf git URLs, Notion page links, empty for upload kinds; else bad_url', () => {
    expect(checkUrl('overleaf', 'https://git.overleaf.com/6560c0ffee')).toBe('ok');
    expect(checkUrl('overleaf', '/local/path')).toBe('ok');
    expect(checkUrl('overleaf', 'https://example.com/x')).toBe('bad_url');
    expect(checkUrl('notion', 'https://www.notion.so/My-Page-abc123')).toBe('ok');
    expect(checkUrl('notion', 'https://example.com/x')).toBe('bad_url');
    expect(checkUrl('pdf', '')).toBe('ok');
    expect(checkUrl('pdf', 'https://files.example.com/a.pdf')).toBe('ok');
    expect(checkUrl('pdf', 'not a url')).toBe('bad_url');
    expect(checkUrl('code', 'https://github.com/org/repo')).toBe('ok');
  });
});

describe('mediaTypeFor and acceptFor', () => {
  it('cover pptx, docx and pdf only', () => {
    expect(mediaTypeFor('pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(mediaTypeFor('docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(mediaTypeFor('pdf')).toBe('application/pdf');
    expect(mediaTypeFor('overleaf')).toBeNull();
    expect(mediaTypeFor('code')).toBeNull();
    expect(mediaTypeFor('notion')).toBeNull();
    expect(acceptFor('pptx')).toBe('.pptx');
    expect(acceptFor('docx')).toBe('.docx');
    expect(acceptFor('pdf')).toBe('.pdf');
    expect(acceptFor('overleaf')).toBeNull();
    expect(fileKinds.has('pptx') && fileKinds.has('docx') && fileKinds.has('pdf')).toBe(true);
    expect(fileKinds.has('overleaf') || fileKinds.has('code') || fileKinds.has('notion')).toBe(false);
  });
});

describe('DEFAULT_WHERE', () => {
  it('names every kind’s default home', () => {
    expect(DEFAULT_WHERE).toEqual({ overleaf: 'Overleaf', code: 'GitHub', notion: 'Notion', pptx: 'PowerPoint', docx: 'Word', pdf: 'PDF' });
  });
});

describe('shareState', () => {
  it('shared, ok for my private artifact, not_owner, links_private', () => {
    const log = setup();
    log.emit('artifact.created', 'u-me', { artifactId: 'pub', projectId: 'p1', kind: 'pdf', title: 'Public', where: 'PDF', needIds: [] });
    log.emit('artifact.created', 'u-me', { artifactId: 'priv', projectId: 'p1', kind: 'pdf', title: 'Private', where: 'PDF', needIds: [], private: true });
    log.emit('need.created', 'u-me', {
      needId: 'n-priv',
      projectId: 'p1',
      kind: 'ext',
      title: 'Secret need',
      roundId: null,
      source: { src: 'doc', date: '2026-11-24', quote: 'q', ref: 'r' },
      private: true,
    });
    log.emit('artifact.linked', 'u-me', { artifactId: 'priv', needIds: ['n-priv'] });

    const pub = log.state.artifacts.pub!;
    const priv = log.state.artifacts.priv!;
    expect(shareState(log.state, 'u-me', pub)).toBe('shared');
    expect(shareState(log.state, 'u-other', pub)).toBe('shared');
    expect(shareState(log.state, 'u-other', priv)).toBe('not_owner');
    expect(shareState(log.state, 'u-me', priv)).toBe('links_private');

    // A second private artifact with no private links: shareable by its owner.
    log.emit('artifact.created', 'u-me', { artifactId: 'priv2', projectId: 'p1', kind: 'pdf', title: 'Private 2', where: 'PDF', needIds: [], private: true });
    expect(shareState(log.state, 'u-me', log.state.artifacts.priv2!)).toBe('ok');
  });
});

describe('versionLine', () => {
  it('joins label, date and round with the no-dot separator', () => {
    const log = setup();
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p1', title: 'Round 1', kind: 'hard', start: '2026-11-01', due: '2026-12-01' });
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p1', kind: 'pdf', title: 'A', where: 'PDF', needIds: [] });
    log.emit('artifact.version_added', 'u-me', { artifactId: 'a1', versionId: 'a1:v1', label: 'v1', date: '2026-11-24', note: '', roundId: 'r1' });
    log.emit('artifact.version_added', 'u-me', { artifactId: 'a1', versionId: 'a1:v2', label: 'v2', date: '2026-11-24', note: '' });
    const a = log.state.artifacts.a1!;
    const withRound = a.versions.find((v) => v.id === 'a1:v1')!;
    const withoutRound = a.versions.find((v) => v.id === 'a1:v2')!;
    expect(versionLine(t, fmtDay, log.state, withRound)).toBe(['v1', fmtDay('2026-11-24'), t('round', { n: 1 })].join(SEP));
    expect(versionLine(t, fmtDay, log.state, withoutRound)).toBe(['v2', fmtDay('2026-11-24'), t('round.none')].join(SEP));
    expect(versionLine(t, fmtDay, log.state, withRound)).not.toMatch(/[·•]/);
  });
});

describe('uploadVersionFile', () => {
  const file = { arrayBuffer: async () => new ArrayBuffer(4) };

  it('resolves the blob hash and media type on a successful upload', async () => {
    const calls: [Uint8Array, string][] = [];
    const uploadBlob = async (bytes: Uint8Array, mediaType: string) => {
      calls.push([bytes, mediaType]);
      return { ok: true as const, hash: 'blob-hash', size: 4 };
    };
    const result = await uploadVersionFile(uploadBlob, 'pdf', file);
    expect(result).toEqual({ ok: true, blobHash: 'blob-hash', mediaType: 'application/pdf' });
    expect(calls).toEqual([[new Uint8Array(4), 'application/pdf']]);
  });

  // Review fix round 1 (Important #2): a failed upload must surface its code, never a partial
  // result — NewArtifactModal and NewVersionModal rely on this `ok: false` to show an error and
  // submit no `artifact.version_added` with a null content reference.
  it('surfaces the bridge code, with no partial result, when the upload fails', async () => {
    const uploadBlob = async () => ({ ok: false as const, code: 'TOO_LARGE' });
    const result = await uploadVersionFile(uploadBlob, 'docx', file);
    expect(result).toEqual({ ok: false, code: 'TOO_LARGE' });
  });
});

describe('agentPrompt', () => {
  it('names the artifact and both ids', () => {
    const log = setup();
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p1', kind: 'pdf', title: 'My Paper', where: 'PDF', needIds: [] });
    const a = log.state.artifacts.a1!;
    const text = agentPrompt(t, 'p1', a);
    expect(text).toBe(t('af.agentPrompt', { title: 'My Paper', projectId: 'p1', artifactId: 'a1' }));
    expect(text).toContain('My Paper');
    expect(text).toContain('p1');
    expect(text).toContain('a1');
  });
});
