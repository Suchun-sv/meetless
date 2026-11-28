import { CAPTURE_CODES, type CaptureSource, type MeetlessBridge } from '@meetless/client/bridge';
import { isWebUrl, type Id } from '@meetless/core';
import type { MessageKey, Params } from '@meetless/i18n';

/**
 * Capture glue from renderer artifacts/capture-ui.tsx, without its React and DOM parts (that file
 * imports the renderer's AppContext). Desktop only: callers check `hasCapability` first.
 */

type T = (key: MessageKey, params?: Params) => string;
type Notify = (tone: 'error' | 'info', text: string) => void;

/** `cap.err.<code>` when the capture service promises copy for it, else `errorText(code)`. */
export function capErrorText(t: T, errorText: (code: string) => string, code: string): string {
  return (CAPTURE_CODES as readonly string[]).includes(code) ? t(`cap.err.${code}` as MessageKey) : errorText(code);
}

export interface CaptureRunner {
  readonly running: boolean;
  run(opts?: { artifactIds?: Id[] }): Promise<void>;
}

/** One `captureRun` at a time, with the result notices. */
export function createCaptureRunner(deps: { bridge: Pick<MeetlessBridge, 'captureRun'>; t: T; errorText: (c: string) => string; notify: Notify }, projectId: Id, onChange?: (running: boolean) => void): CaptureRunner {
  let running = false;
  const set = (v: boolean) => {
    running = v;
    onChange?.(v);
  };
  return {
    get running() {
      return running;
    },
    async run(opts) {
      if (running) return;
      set(true);
      try {
        const r = await deps.bridge.captureRun({ projectId, ...(opts?.artifactIds ? { artifactIds: opts.artifactIds } : {}) });
        if (r.ok) {
          const n = r.result.recorded + r.result.queued;
          deps.notify('info', n > 0 ? deps.t('cap.text', { n }) : deps.t('cap.none'));
          const { skipped } = r.result;
          if (opts?.artifactIds?.length === 1 && skipped.length === 1) deps.notify('info', capErrorText(deps.t, deps.errorText, skipped[0]!.code));
          else if (skipped.length > 0) deps.notify('info', deps.t('cap.skippedN', { n: skipped.length }));
        } else {
          deps.notify('error', capErrorText(deps.t, deps.errorText, r.code));
        }
      } finally {
        set(false);
      }
    },
  };
}

/** Polls `captureStatus` until Notion reads connected (every 2 s, at most 5 min). Returns stop. */
export function pollNotionConnected(captureStatus: MeetlessBridge['captureStatus'], projectId: Id, onConnected: () => void, opts: { intervalMs?: number; timeoutMs?: number } = {}): () => void {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(limit);
  };
  const timer = setInterval(() => {
    void captureStatus(projectId).then((r) => {
      if (!stopped && r.ok && r.status.notion === 'connected') {
        stop();
        onConnected();
      }
    });
  }, opts.intervalMs ?? 2000);
  const limit = setTimeout(stop, opts.timeoutMs ?? 5 * 60_000);
  return stop;
}

export interface NotionConnector {
  readonly waiting: boolean;
  connect(): void;
  destroy(): void;
}

/** Starts Notion OAuth, opens the authorize url, then polls; `destroy` makes a late answer a no-op. */
export function createNotionConnector(
  bridge: Pick<MeetlessBridge, 'notionConnect' | 'captureStatus'>,
  projectId: Id,
  openUrl: (url: string) => void,
  onConnected: () => void,
  onWaitingChange?: (waiting: boolean) => void,
): NotionConnector {
  let waiting = false;
  let destroyed = false;
  let stopPoll: (() => void) | null = null;
  const setWaiting = (v: boolean) => {
    waiting = v;
    onWaitingChange?.(v);
  };
  return {
    get waiting() {
      return waiting;
    },
    connect() {
      void bridge.notionConnect().then((r) => {
        if (destroyed || !r.ok || !isWebUrl(r.authorizeUrl)) return;
        openUrl(r.authorizeUrl);
        setWaiting(true);
        stopPoll?.();
        stopPoll = pollNotionConnected(bridge.captureStatus, projectId, () => {
          if (destroyed) return;
          setWaiting(false);
          onConnected();
        });
      });
    },
    destroy() {
      destroyed = true;
      stopPoll?.();
      stopPoll = null;
    },
  };
}

/** One Overleaf sync at a time; `onDone` refreshes the panel whatever the result. */
export function createOverleafSyncer(bridge: Pick<MeetlessBridge, 'overleafSync'>, artifactId: Id, onDone: () => void, onChange?: (syncing: boolean) => void): { sync(): Promise<void> } {
  let syncing = false;
  return {
    async sync() {
      if (syncing) return;
      syncing = true;
      onChange?.(true);
      try {
        await bridge.overleafSync(artifactId);
      } finally {
        syncing = false;
        onChange?.(false);
        onDone();
      }
    },
  };
}

/** What the commit list depends on: the repo plus its sync and capture times. */
export function commitsFetchKey(src: CaptureSource | null | undefined): string | null {
  if (!src?.repo) return null;
  return [src.repo.id, src.syncedAt ?? '', src.lastRunAt ?? ''].join('|');
}

export type NotionRead = { phase: 'idle' } | { phase: 'reading' } | { phase: 'ready'; paragraphs: string[] } | { phase: 'error'; code: string };

/** Reads a Notion page once at a time; a refusal reports its code and refreshes the panel. */
export function createNotionReader(bridge: Pick<MeetlessBridge, 'notionPage'>, artifactId: Id, onState: (s: NotionRead) => void, onFailed: () => void): { read(): Promise<void>; destroy(): void } {
  let busy = false;
  let destroyed = false;
  return {
    async read() {
      if (busy || destroyed) return;
      busy = true;
      onState({ phase: 'reading' });
      try {
        const r = await bridge.notionPage(artifactId);
        if (destroyed) return;
        if (r.ok) onState({ phase: 'ready', paragraphs: r.paragraphs });
        else {
          onState({ phase: 'error', code: r.code });
          onFailed();
        }
      } finally {
        busy = false;
      }
    },
    destroy() {
      destroyed = true;
    },
  };
}
