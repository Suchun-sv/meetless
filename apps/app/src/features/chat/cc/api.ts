import { Platform } from 'react-native';
import type { Id } from '@meetless/core';
import { mockCc } from './mock';

/*
 * The project's Claude Code session through the app's `api()` (S's `cc.*` routes), so it works the
 * same on web, iOS and desktop. A turn is `cc.turn`, then `cc.events` long-polled until done. Without
 * the routes, Claude Code is unavailable (production) or a local mock answers (dev, `?ccmock=1`).
 */

export type CcState = 'idle' | 'running_here' | 'in_use_elsewhere';

export interface CcStatus {
  state: CcState;
  detail?: string;
  /** The caller is the project owner (only the owner talks to the session and approves). */
  owner: boolean;
  /** Null until the session's first turn. */
  session: { id: string; name: string } | null;
  repoPath: string | null;
  /** Set while a turn runs here, to reattach after a reload. */
  turn: { id: string; startedAt: string } | null;
  /** False when the server runs no Claude Code: only the DeepSeek mode is offered. */
  available?: boolean;
}

export type CcItem =
  | { kind: 'user'; id: string; text: string; at: string }
  | { kind: 'assistant'; id: string; text: string; at: string }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean | null; at: string }
  | { kind: 'result'; id: string; costUsd?: number; at: string };

export type CcEvent = { seq?: number } & (
  | { type: 'session'; sessionId: string }
  | { type: 'user'; id: string; text: string }
  | { type: 'text'; id: string; delta: string }
  | { type: 'tool'; id: string; name: string; summary: string }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'permission'; approvalId: string; tool: string; input: string; expiresAt: string }
  | { type: 'permission_done'; approvalId: string; behavior: 'allow' | 'deny' }
  | { type: 'result'; costUsd?: number; durationMs?: number }
  | { type: 'error'; code: string; message?: string }
);

export interface CcHandoff {
  commands: { kind: 'terminal' | 'remote' | 'desktop'; command: string; note?: string }[];
}

type R<T> = { ok: true; data: T } | { ok: false; code: string };
/** The app's `api`, loosely typed: the `cc.*` names arrive in `@meetless/api` with S's v3. */
export type ApiFn = (name: string, input: Record<string, unknown>) => Promise<R<unknown>>;

export class CcError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const EXPLICIT_MOCK = Platform.OS === 'web' && typeof location !== 'undefined' && /[?&]ccmock=/.test(location.search);
/**
 * The local mock may stand in for missing cc routes only in dev builds, with `?ccmock=…`, or with
 * EXPO_PUBLIC_CC_MOCK=1. Production (8445, the desktop) never shows fake Claude Code replies: without
 * the routes Claude Code is unavailable and the chat stays on DeepSeek.
 */
const MOCK_ALLOWED = EXPLICIT_MOCK || __DEV__ || process.env.EXPO_PUBLIC_CC_MOCK === '1';
let mock = EXPLICIT_MOCK;

/** Whether the server has the cc routes: null until probed (cc.status), then true or false. */
let available: boolean | null = mock ? true : null;
const listeners = new Set<() => void>();
function setAvailable(v: boolean): void {
  if (available === v) return;
  available = v;
  for (const l of listeners) l();
}
export function ccAvailable(): boolean | null {
  return available;
}
export function onCcAvailability(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function unavailable<T>(name: string, input: Record<string, unknown>): Promise<T> {
  if (MOCK_ALLOWED) {
    mock = true;
    setAvailable(true);
    return fromMock<T>(name, input);
  }
  setAvailable(false);
  throw new CcError('CC_UNAVAILABLE');
}

const fromMock = <T,>(name: string, input: Record<string, unknown>) =>
  mockCc.call<T>(name, input).catch((e: unknown) => {
    throw new CcError(e instanceof Error ? e.message : 'MOCK');
  });

async function call<T>(api: ApiFn, name: string, input: Record<string, unknown>): Promise<T> {
  if (mock) return fromMock<T>(name, input);
  let r: R<unknown>;
  try {
    r = await api(name, input);
  } catch {
    // The bridge does not know the route yet (server and client before S's v3).
    if (name === 'cc.status') return unavailable<T>(name, input);
    throw new CcError('NETWORK');
  }
  if (!r.ok) {
    if (/NOT_AVAILABLE|UNKNOWN|NOT_FOUND|ROUTE|HTTP_404/.test(r.code)) return unavailable<T>(name, input);
    throw new CcError(r.code);
  }
  // A server without Claude Code configured answers cc.status with `available: false`.
  if (name === 'cc.status') setAvailable((r.data as { available?: boolean } | null)?.available !== false);
  return r.data as T;
}

export const ccStatus = (api: ApiFn, projectId: Id) => call<CcStatus>(api, 'cc.status', { projectId });
export const ccHistory = (api: ApiFn, projectId: Id, before?: string | null) => call<{ items: CcItem[]; before: string | null }>(api, 'cc.history', { projectId, limit: 50, ...(before ? { before } : {}) });
export const ccCancel = (api: ApiFn, projectId: Id) => call<{ cancelled: boolean }>(api, 'cc.cancel', { projectId });
export const ccApprove = (api: ApiFn, projectId: Id, approvalId: string, allow: boolean) => call<{ ok: true }>(api, 'cc.approve', { projectId, approvalId, allow });
export const ccHandoff = (api: ApiFn, projectId: Id) => call<CcHandoff>(api, 'cc.handoff', { projectId });
export const ccSetRepo = (api: ApiFn, projectId: Id, repoPath: string | null) => call<{ repoPath: string | null }>(api, 'cc.repo', { projectId, repoPath });

/**
 * Follows a turn's events (`cc.events`, long-polled with `after = next`) until it is done or stopped.
 * `turnId` null follows the latest turn (reattaching after a reload).
 */
export function ccFollow(api: ApiFn, projectId: Id, turnId: string | null, after: number, onEvent: (e: CcEvent) => void): { done: Promise<void>; stop: () => void } {
  let stopped = false;
  const done = (async () => {
    let next = after;
    let fails = 0;
    while (!stopped) {
      let r: { events: CcEvent[]; next: number; done: boolean };
      try {
        r = await call(api, 'cc.events', { projectId, after: next, ...(turnId ? { turnId } : {}) });
        fails = 0;
      } catch (e) {
        if (++fails >= 3) {
          onEvent({ type: 'error', code: e instanceof CcError ? e.code : 'NETWORK' });
          return;
        }
        await new Promise((res) => setTimeout(res, 1000 * fails));
        continue;
      }
      if (stopped) return;
      for (const ev of r.events) onEvent(ev);
      next = r.next;
      if (r.done) return;
    }
  })();
  return { done, stop: () => void (stopped = true) };
}

/** Sends one message (`cc.turn`) and follows its events. Refusals (not the owner, in use elsewhere, a turn running) come back as an error event. */
export function ccTurn(api: ApiFn, projectId: Id, text: string, onEvent: (e: CcEvent) => void): { done: Promise<void>; stop: () => void } {
  let follow: { stop: () => void } | null = null;
  let stopped = false;
  const done = (async () => {
    let t: { turnId: string; next: number };
    try {
      t = await call(api, 'cc.turn', { projectId, text });
    } catch (e) {
      onEvent({ type: 'error', code: e instanceof CcError ? e.code : 'NETWORK' });
      return;
    }
    if (stopped) return;
    const f = ccFollow(api, projectId, t.turnId, t.next, onEvent);
    follow = f;
    await f.done;
  })();
  return {
    done,
    stop: () => {
      stopped = true;
      follow?.stop();
    },
  };
}
