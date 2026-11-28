import { Platform } from 'react-native';
import { mockInbox } from './mock';

/*
 * The personal inbox (mobile-v2 「需求」 tab) through the app's `api()` (S's `inbox.*` routes), so it
 * works on web, iOS and desktop. Materials are the user's own until committed into projects; the
 * existing per-project pending items come back as materials too (`input:<id>`, `proposal:<id>`).
 * An analysis is followed by long-polling `inbox.get` with the last `rev`. Until the server has these
 * routes a local mock stands in, but only in dev builds, with `?inboxmock=1`, or EXPO_PUBLIC_INBOX_MOCK=1.
 */

export type CardKind = 'text' | 'pdf' | 'docx' | 'image' | 'mail' | 'chat' | 'proposal';
export type MaterialStatus = 'analyzing' | 'ready' | 'committed' | 'empty' | 'failed';
export type Stage = 'reading' | 'extracting' | 'routing' | 'checking' | 'done';

export interface InboxCard {
  id: string;
  kind: CardKind;
  title: string;
  /** 「邮件」「项目 Agent」「12 条消息」「PDF 6 页」…, shown next to the time. */
  source: string;
  addedAt: string;
  status: MaterialStatus;
  stage?: Stage;
  progress?: { page: number; pages: number } | null;
  counts: { items: number; projects: number; duplicates: number; conflicts: number };
  projectIds: string[];
  committed?: { projectIds: string[]; count: number };
  error?: { code: string; message?: string };
}

/** An item the analysis found. A2's review reads the details; B2 shows type and text as they arrive. */
export interface InboxItem {
  id: string;
  type: 'need' | 'hyp' | 'rev';
  text: string;
  [k: string]: unknown;
}

export interface InboxMaterial extends InboxCard {
  rev: number;
  sizeBytes?: number;
  pages?: number;
  summary?: string;
  due?: { date: string; quote?: string } | null;
  items: InboxItem[];
  /** The project suggestion (B3), set once the analysis is done; A2 reads it. */
  routing?: unknown;
}

export interface InboxList {
  pending: InboxCard[];
  recent: InboxCard[];
  older: number;
  badge: number;
}

export interface CommitResult {
  batchId: string;
  projectIds: string[];
  created: number;
  merged: number;
  revised?: number;
  changedDue: number;
  undoUntil: string;
}

export type AddSource = 'paste' | 'file' | 'camera' | 'album' | 'drop' | 'share';

type R<T> = { ok: true; data: T } | { ok: false; code: string };
/** The app's `api`, loosely typed: the `inbox.*` names arrive in `@meetless/api` with S's v3. */
export type ApiFn = (name: string, input: Record<string, unknown>) => Promise<R<unknown>>;

export class InboxError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Never in production builds: only a dev build or EXPO_PUBLIC_INBOX_MOCK=1 may use the mock; without the routes the inbox falls back to the per-project items in core. */
const MOCK_ALLOWED = __DEV__ || process.env.EXPO_PUBLIC_INBOX_MOCK === '1';
/** `?inboxmock=1` forces the mock on web, but only where the mock is allowed at all. */
const EXPLICIT_MOCK = MOCK_ALLOWED && Platform.OS === 'web' && typeof location !== 'undefined' && /[?&]inboxmock=/.test(location.search);
let mock = EXPLICIT_MOCK;
let available: boolean | null = mock ? true : null;

/** Whether the server has the inbox routes (or a dev mock stands in); null until the first call. */
export function inboxAvailable(): boolean | null {
  return available;
}

const fromMock = <T,>(name: string, input: Record<string, unknown>) =>
  mockInbox.call<T>(name, input).catch((e: unknown) => {
    throw new InboxError(e instanceof Error ? e.message : 'MOCK');
  });

function unavailable<T>(name: string, input: Record<string, unknown>): Promise<T> {
  if (MOCK_ALLOWED) {
    mock = true;
    available = true;
    return fromMock<T>(name, input);
  }
  available = false;
  throw new InboxError('INBOX_UNAVAILABLE');
}

async function call<T>(api: ApiFn, name: string, input: Record<string, unknown>): Promise<T> {
  if (mock) return fromMock<T>(name, input);
  if (available === false) throw new InboxError('INBOX_UNAVAILABLE');
  let r: R<unknown>;
  try {
    r = await api(name, input);
  } catch {
    return unavailable<T>(name, input);
  }
  if (!r.ok) {
    // A server without the inbox answers the list with NOT_FOUND (404); for one material NOT_FOUND is real.
    if (/NOT_AVAILABLE|UNKNOWN|ROUTE|HTTP_404/.test(r.code) || (name === 'inbox.list' && r.code === 'NOT_FOUND')) return unavailable<T>(name, input);
    throw new InboxError(r.code);
  }
  available = true;
  return r.data as T;
}

export const listInbox = (api: ApiFn) => call<InboxList>(api, 'inbox.list', {});
/** The material; while it is analysing, the server holds the call (up to 20 s) until it changes past `rev`. */
export const getMaterial = (api: ApiFn, materialId: string, rev?: number) => call<InboxMaterial>(api, 'inbox.get', { materialId, ...(rev !== undefined ? { rev } : {}) });
/** Pasted text, or an uploaded file or photo (`blobHash` from `bridge.uploadBlob`) with iOS's on-device OCR text when there is some. */
export const addMaterial = (
  api: ApiFn,
  input: { source: AddSource; text?: string; blobHash?: string; mediaType?: string; fileName?: string; ocrText?: string | null },
) => call<{ id: string; rev: number; existing: boolean }>(api, 'inbox.add', input as Record<string, unknown>);
export const commitMaterial = (api: ApiFn, materialId: string, body: Record<string, unknown>) => call<CommitResult>(api, 'inbox.commit', { materialId, ...body });
export const undoMaterial = (api: ApiFn, materialId: string) => call<{ ok: true }>(api, 'inbox.undo', { materialId });
export const retryMaterial = (api: ApiFn, materialId: string) => call<{ rev: number }>(api, 'inbox.retry', { materialId });
export const removeMaterial = (api: ApiFn, materialId: string) => call<{ ok: true }>(api, 'inbox.remove', { materialId });

/** Seeds the mock with the signed-in user's projects so its suggestions name real ones. */
export const seedMockProjects = (ids: string[]) => mockInbox.seed(ids);
