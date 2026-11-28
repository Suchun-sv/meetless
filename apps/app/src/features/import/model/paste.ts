import type { ApiRequest } from '@meetless/api';
import type { Result } from '@meetless/client/bridge';
import { clip, looksLikeAdd, looksLikeInput, type Id, type InputKind, type IsoDate, type Scene, type State } from '@meetless/core';
import { kindFromName, MAX_IMPORT_BYTES, mdTitle, requesterFrom } from '@renderer/inputs/model';
import type { Target } from '../../chat/model/target';

export { kindFromName, MAX_IMPORT_BYTES, mdTitle, requesterFrom, requesterLabel } from '@renderer/inputs/model';

/*
 * 粘贴导入 (新输入): paste or type a meeting note, a mail, a chat log; optionally a title, who it
 * came from and a scene; 「项目」 or 「仅自己」. It goes to `inputs.import` as Markdown text, the
 * server detects needs from it, and what it found waits in To confirm. Files (md, txt, docx, pdf)
 * go the same way, docx and pdf after a blob upload.
 */

/** The scenes the paste form offers; `agent` is the composer's own and is not offered here. */
export const PASTE_SCENES: readonly Scene[] = ['meeting', 'mail', 'chat', 'doc', 'handwritten'];

export interface PasteDraft {
  title: string;
  text: string;
  /** A member's name (matched case-insensitively) or any outside name; empty for nobody. */
  from: string;
  priv: boolean;
  /** Null lets the server detect it from the text (default `doc`). */
  scene: Scene | null;
}

export const EMPTY_DRAFT: PasteDraft = { title: '', text: '', from: '', priv: false, scene: null };

export function canImport(d: PasteDraft, busy: boolean): boolean {
  return !busy && d.text.trim().length > 0;
}

/**
 * The hint under the text field: `add` when it reads as needs to add (需要：..., a numbered list),
 * `input` for any other notes, null while too short to say.
 */
export function pasteHint(text: string): 'add' | 'input' | null {
  const v = text.trim();
  if (!v) return null;
  if (looksLikeAdd(v)) return 'add';
  return looksLikeInput(v) ? 'input' : null;
}

/** The `inputs.import` request for a pasted draft. The title falls back to the first line (desktop `mdTitle`). */
export function pasteRequest(live: State, projectId: Id, d: PasteDraft, today: IsoDate, inputId: Id): ApiRequest<'inputs.import'> {
  return {
    projectId,
    inputId,
    title: mdTitle(d.title, d.text),
    kind: 'md',
    blobHash: null,
    text: d.text,
    from: requesterFrom(live, projectId, d.from),
    date: today,
    private: d.priv,
    ...(d.scene ? { scene: d.scene } : {}),
  };
}

/** Upload media type for the kinds that are not read as text. */
export const BLOB_MEDIA_TYPE: Readonly<Record<'docx' | 'pdf', string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** The picker's accepted extensions (a legacy binary `.doc` is refused at pick time). */
export const ACCEPT_EXT: readonly string[] = ['md', 'markdown', 'txt', 'docx', 'pdf'];

/** The document picker's MIME types for those extensions (native pickers filter by type, not extension). */
export const ACCEPT_MIME: readonly string[] = ['text/markdown', 'text/plain', BLOB_MEDIA_TYPE.docx, BLOB_MEDIA_TYPE.pdf];

/**
 * A picked file, checked before anything is sent: its kind, and whether it is read as text (md,
 * txt) or uploaded as a blob first (docx, pdf). An error code when it cannot be imported.
 */
export type FilePlan = { ok: true; kind: InputKind; readAsText: boolean; title: string } | { ok: false; code: 'BAD_TYPE' | 'EMPTY_FILE' | 'TOO_LARGE' };

export function filePlan(name: string, size: number): FilePlan {
  const kind = kindFromName(name);
  if (!kind) return { ok: false, code: 'BAD_TYPE' };
  if (size === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (size > MAX_IMPORT_BYTES) return { ok: false, code: 'TOO_LARGE' };
  return { ok: true, kind, readAsText: kind === 'md' || kind === 'txt', title: clip(name.replace(/\.[^./]+$/, ''), 40) };
}

/** The `inputs.import` request for a picked file, once its text is read or its blob uploaded. */
export function fileRequest(
  live: State,
  projectId: Id,
  a: { kind: InputKind; title: string; text: string | null; blobHash: string | null; from: string; priv: boolean; today: IsoDate; inputId: Id },
): ApiRequest<'inputs.import'> {
  return { projectId, inputId: a.inputId, title: a.title, kind: a.kind, blobHash: a.blobHash, text: a.text, from: requesterFrom(live, projectId, a.from), date: a.today, private: a.priv };
}

/**
 * Text from a picked md/txt file, read as a UTF-8 string (expo-file-system on native, `File.text()`
 * on web; Hermes has no `TextDecoder`, so bytes are not decoded here): BOM stripped, CRLF to LF.
 * Null means `EMPTY_FILE`.
 */
export function fileText(raw: string): string | null {
  const v = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n/g, '\n');
  return v.trim() ? v : null;
}

/** The i18n key for an import error code the form shows itself; other codes go through the app's error text. */
export function importErrorKey(code: string): 'in.emptyFile' | 'ch.badFile' | null {
  if (code === 'EMPTY_FILE') return 'in.emptyFile';
  if (code === 'BAD_TYPE') return 'ch.badFile';
  return null;
}

/** After `inputs.import`: open the new input (its extracts wait in To confirm), or the error code. */
export function importOutcome(res: Result<{ data: { inputId: Id; extracts: number } }>, projectId: Id): { open: Target; extracts: number } | { code: string } {
  if (res.ok) return { open: { kind: 'input', projectId, inputId: res.data.inputId }, extracts: res.data.extracts };
  return { code: res.code };
}
