import type { ApiRequest } from '@meetless/api';
import type { Result } from '@meetless/client/bridge';
import type { Id, IsoDate, Requester } from '@meetless/core';
import { decodeText, kindFromName, MAX_IMPORT_BYTES, mdTitle } from '@renderer/inputs/model';

/**
 * File and Markdown import (renderer inputs/importer.ts) over injected calls, so it runs the same
 * on web and native. md/txt go as text; docx/pdf upload the blob first. Navigation is the caller's.
 */
export interface ImportDeps {
  importInput(req: ApiRequest<'inputs.import'>): Promise<Result<object>>;
  uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>>;
  newId(prefix: string): string;
  today: IsoDate;
}

export type ImportResult = { ok: true; inputId: Id } | { ok: false; code: string };

const MEDIA_TYPE: Record<'docx' | 'pdf', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

async function send(deps: ImportDeps, req: ApiRequest<'inputs.import'>): Promise<ImportResult> {
  const r = await deps.importInput(req);
  return r.ok ? { ok: true, inputId: req.inputId } : { ok: false, code: r.code };
}

export async function importFile(
  deps: ImportDeps,
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
    const up = await deps.uploadBlob(a.bytes, MEDIA_TYPE[kind]);
    if (!up.ok) return { ok: false, code: up.code };
    blobHash = up.hash;
  }
  return send(deps, {
    projectId: a.projectId,
    inputId: deps.newId('in'),
    title: a.name,
    kind,
    blobHash,
    text,
    from: a.from,
    date: deps.today,
    private: a.private,
  });
}

export async function importMarkdown(
  deps: ImportDeps,
  a: { projectId: Id; title: string; text: string; from: Requester | null; private: boolean },
): Promise<ImportResult> {
  if (!a.text.trim()) return { ok: false, code: 'EMPTY_FILE' };
  return send(deps, {
    projectId: a.projectId,
    inputId: deps.newId('in'),
    title: mdTitle(a.title, a.text),
    kind: 'md',
    blobHash: null,
    text: a.text,
    from: a.from,
    date: deps.today,
    private: a.private,
  });
}
