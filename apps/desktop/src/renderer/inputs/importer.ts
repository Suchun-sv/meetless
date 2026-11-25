import type { ApiRequest } from '@meetless/api';
import type { Id, Requester } from '@meetless/core';
import type { AppApi } from '../app/AppContext';
import { newId } from '../model/ids';
import { decodeText, kindFromName, MAX_IMPORT_BYTES, mdTitle } from './model';

/**
 * Imports a file or a hand-written Markdown note (task 8 brief; contract §10, task 12a). md and
 * txt go through `api('inputs.import', ...)` with `blobHash: null` and `text` set, exactly like
 * docx and pdf, which upload the blob first (`uploadBlob`) and send `text: null`. A route error
 * is returned as is, never faked into a success.
 */

const MEDIA_TYPE: Record<'docx' | 'pdf', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

export type ImportResult = { ok: true; inputId: Id } | { ok: false; code: string };

async function finishImport(app: AppApi, req: ApiRequest<'inputs.import'>): Promise<{ ok: true } | { ok: false; code: string }> {
  const r = await app.api('inputs.import', req);
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

export async function importFile(
  app: AppApi,
  a: { projectId: Id; name: string; bytes: Uint8Array; from: Requester | null; private: boolean },
): Promise<ImportResult> {
  const kind = kindFromName(a.name);
  if (!kind) return { ok: false, code: 'BAD_TYPE' };
  if (a.bytes.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (a.bytes.length > MAX_IMPORT_BYTES) return { ok: false, code: 'TOO_LARGE' };

  let text: string | null = null;
  let blobHash: string | null = null;
  if (kind === 'md' || kind === 'txt') {
    text = decodeText(a.bytes);
    if (!text.trim()) return { ok: false, code: 'EMPTY_FILE' };
  } else {
    const up = await app.bridge.uploadBlob(a.bytes, MEDIA_TYPE[kind]);
    if (!up.ok) return { ok: false, code: up.code };
    blobHash = up.hash;
  }

  const inputId = newId('in');
  const req: ApiRequest<'inputs.import'> = {
    projectId: a.projectId,
    inputId,
    title: a.name,
    kind,
    blobHash,
    text,
    from: a.from,
    date: app.today,
    private: a.private,
  };
  const result = await finishImport(app, req);
  if (!result.ok) return result;
  app.go({ view: 'inputs', projectId: a.projectId, focusId: inputId });
  return { ok: true, inputId };
}

export async function importMarkdown(
  app: AppApi,
  a: { projectId: Id; title: string; text: string; from: Requester | null; private: boolean },
): Promise<ImportResult> {
  if (!a.text.trim()) return { ok: false, code: 'EMPTY_FILE' };
  const inputId = newId('in');
  const req: ApiRequest<'inputs.import'> = {
    projectId: a.projectId,
    inputId,
    title: mdTitle(a.title, a.text),
    kind: 'md',
    blobHash: null,
    text: a.text,
    from: a.from,
    date: app.today,
    private: a.private,
  };
  const result = await finishImport(app, req);
  if (!result.ok) return result;
  app.go({ view: 'inputs', projectId: a.projectId, focusId: inputId });
  return { ok: true, inputId };
}
