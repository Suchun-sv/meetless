import { useCallback, useEffect, useMemo, useState } from 'react';
import { CAPTURE_CODES, type CaptureSource, type CaptureStatus, type CommitInfo, type MeetlessBridge } from '@meetless/client/bridge';
import type { Artifact, Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp, type AppApi } from '../app/AppContext';
import { Btn } from '../ui/primitives';
import { sourceRow, type SourceRow } from './source-model';

/**
 * Capture UI behaviour (task 7 brief): the guarded run, its button, the per-artifact source
 * status and its handlers, and the Notion authorise-and-poll flow. Presentational rendering
 * (`SourceView`, `NotionView`) lives in `SourcePanel.tsx`; this file is the glue that calls the
 * bridge.
 */

/** `t('cap.err.<code>')` for a code the capture service promises a copy key for, else `errorText(code)` (the bridge's own `CAPTURE_FAILED` and any other code never promises one). */
export function capErrorText(t: AppApi['t'], errorText: AppApi['errorText'], code: string): string {
  return (CAPTURE_CODES as readonly string[]).includes(code) ? t(`cap.err.${code}` as MessageKey) : errorText(code);
}

type RunDeps = {
  bridge: Pick<MeetlessBridge, 'captureRun'>;
  t: AppApi['t'];
  errorText: AppApi['errorText'];
  notify: AppApi['notify'];
};

export interface CaptureRunner {
  readonly running: boolean;
  run(opts?: { artifactIds?: Id[] }): Promise<void>;
}

/**
 * The guarded, run-once-at-a-time `captureRun` call (R1, brief): a second `run` while one is in
 * flight is a no-op. Exported standalone (not only through the `useCaptureRun` hook) so the guard
 * and the result notices are unit-testable without a render tree: `useCaptureRun` is a thin React
 * wrapper that re-renders through `onChange`.
 */
export function createCaptureRunner(deps: RunDeps, projectId: Id, onChange?: (running: boolean) => void): CaptureRunner {
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
          // Accepted plus queued only: a duplicate was already captured (another run got there first).
          const n = r.result.recorded + r.result.queued;
          deps.notify('info', n > 0 ? deps.t('cap.text', { n }) : deps.t('cap.none'));
          const { skipped } = r.result;
          if (opts?.artifactIds?.length === 1 && skipped.length === 1) {
            // One artifact asked for and skipped: say why right here, since `status` cannot
            // show a reason that only came up during the run (a repo whose git log failed).
            deps.notify('info', capErrorText(deps.t, deps.errorText, skipped[0]!.code));
          } else if (skipped.length > 0) {
            deps.notify('info', deps.t('cap.skippedN', { n: skipped.length }));
          }
        } else {
          deps.notify('error', capErrorText(deps.t, deps.errorText, r.code));
        }
      } finally {
        set(false);
      }
    },
  };
}

/** `captureRun` for `projectId`, guarded against a second concurrent call, with the result notices. */
export function useCaptureRun(projectId: Id): { running: boolean; run(opts?: { artifactIds?: Id[] }): Promise<void> } {
  const { bridge, t, errorText, notify } = useApp();
  const [running, setRunning] = useState(false);
  const runner = useMemo(() => createCaptureRunner({ bridge, t, errorText, notify }, projectId, setRunning), [bridge, t, errorText, notify, projectId]);
  return { running, run: runner.run };
}

/** The per-artifact (or, with no `artifactIds`, whole-project) capture button (brief). */
export function CaptureButton({ projectId, artifactIds, testId }: { projectId: Id; artifactIds?: Id[]; testId: string }) {
  const { t } = useApp();
  const { running, run } = useCaptureRun(projectId);
  return (
    <Btn kind="sm" testId={testId} disabled={running} onClick={() => void run(artifactIds ? { artifactIds } : undefined)}>
      {running ? t('cap.running') : t('cap.btn')}
    </Btn>
  );
}

/**
 * Polls `captureStatus` every `intervalMs` (default 2s) until Notion reads connected, for at most
 * `timeoutMs` (default 5 minutes). Returns a stop function; the caller must call it on unmount.
 */
export function pollNotionConnected(
  captureStatus: MeetlessBridge['captureStatus'],
  projectId: Id,
  onConnected: () => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
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
  }, intervalMs);
  const limit = setTimeout(stop, timeoutMs);
  return stop;
}

export interface NotionConnector {
  readonly waiting: boolean;
  connect(): void;
  /** Stops any poll and makes a `notionConnect()` still in flight a no-op once it resolves. */
  destroy(): void;
}

/**
 * The Notion authorise-and-poll flow as a plain object, not a hook (brief, Interfaces) —
 * mirroring `createCaptureRunner`, so the unmount race is unit-testable without a render tree
 * (fix round 1, review finding 2): `connect()` starts the user's own OAuth, opens `authorizeUrl`,
 * then polls until connected (`pollNotionConnected`); `destroy()` (called on unmount) marks the
 * connector destroyed so that a `notionConnect()` resolving afterwards opens nothing, starts no
 * poll and updates no state — the earlier version started a brand-new, unstoppable poll in exactly
 * that race, because its "stop the previous poll" cleanup only ever ran if `connect()` had already
 * produced one before unmount.
 */
export function createNotionConnector(
  bridge: Pick<MeetlessBridge, 'notionConnect' | 'captureStatus'>,
  projectId: Id,
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
        if (destroyed || !r.ok) return;
        window.open(r.authorizeUrl);
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

/** `createNotionConnector` as a hook: `waiting` drives `af.notionWaiting`; destroyed on unmount. */
export function useNotionConnect(
  bridge: Pick<MeetlessBridge, 'notionConnect' | 'captureStatus'>,
  projectId: Id,
  onConnected: () => void,
): { waiting: boolean; connect: () => void } {
  const [waiting, setWaiting] = useState(false);
  const connector = useMemo(() => createNotionConnector(bridge, projectId, onConnected, setWaiting), [bridge, projectId, onConnected]);
  useEffect(() => () => connector.destroy(), [connector]);
  return { waiting, connect: connector.connect };
}

export interface OverleafSyncer {
  readonly syncing: boolean;
  sync(): Promise<void>;
}

/**
 * The guarded Overleaf sync (I4), shaped like `createCaptureRunner`: a second `sync` while one is
 * in flight is a no-op, `onChange` drives the `syncing` state (Sync disabled, `af.olSyncing`), and
 * `onDone` refreshes the panel once the sync settles, whatever its result (the status carries the
 * failure code).
 */
export function createOverleafSyncer(bridge: Pick<MeetlessBridge, 'overleafSync'>, artifactId: Id, onDone: () => void, onChange?: (syncing: boolean) => void): OverleafSyncer {
  let syncing = false;
  const set = (v: boolean) => {
    syncing = v;
    onChange?.(v);
  };
  return {
    get syncing() {
      return syncing;
    },
    async sync() {
      if (syncing) return;
      set(true);
      try {
        await bridge.overleafSync(artifactId);
      } finally {
        set(false);
        onDone();
      }
    },
  };
}

/**
 * What the commit list depends on (I3): the source's repo, plus when it was last synced and last
 * captured. The repo id of an Overleaf clone stays the same across pulls, so without the times a
 * re-sync would show the new "Synced at" over the old commits. `null` when there is no repo.
 */
export function commitsFetchKey(src: CaptureSource | null | undefined): string | null {
  if (!src?.repo) return null;
  return [src.repo.id, src.syncedAt ?? '', src.lastRunAt ?? ''].join('|');
}

/** A live Notion page read (I5): nothing yet, in flight, the paragraphs, or the reason it failed. */
export type NotionRead = { phase: 'idle' } | { phase: 'reading' } | { phase: 'ready'; paragraphs: string[] } | { phase: 'error'; code: string };

export interface NotionReader {
  read(): Promise<void>;
  /** Called on unmount: a read resolving afterwards updates nothing. */
  destroy(): void;
}

/**
 * Reads a Notion artifact's page once at a time (I5). On a refusal it reports the code and calls
 * `onFailed` (the panel's `refresh`), so a revoked authorisation (`notion_not_connected`, which
 * also clears the stored tokens) brings the panel back to its Connect prompt.
 */
export function createNotionReader(bridge: Pick<MeetlessBridge, 'notionPage'>, artifactId: Id, onState: (s: NotionRead) => void, onFailed: () => void): NotionReader {
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
        if (r.ok) {
          onState({ phase: 'ready', paragraphs: r.paragraphs });
        } else {
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

export interface SourcePanelData {
  row: SourceRow;
  overleafToken: boolean;
  notionConnected: boolean;
  notionWaiting: boolean;
  /** An Overleaf sync is in flight (I4). */
  syncing: boolean;
  commits: CommitInfo[];
  /** Re-fetches `captureStatus` (a failed Notion read calls it, I5). */
  refresh(): void;
  onPickRepo(): void;
  onUnbindRepo(): void;
  onSaveToken(token: string): void;
  onClearToken(): void;
  onSync(): void;
  onConnectNotion(): void;
  onDisconnectNotion(): void;
}

/**
 * Orchestrates one artifact's capture source for `SourceView` (brief): fetches `captureStatus`
 * (re-fetched after every mutating call, via `tick`) and, once a repo is bound or an Overleaf sync
 * has run, its recent commits (`repoLog(repoId, 'HEAD', 20)`). `SourceView` stays presentational;
 * this is the only place that calls the bridge. Used by `ArtifactViewer` for code, Notion, and an
 * Overleaf artifact with no file yet, and by `ArtifactSide` for every other kind (fix round 1:
 * exactly one of the two ever mounts this hook for a given artifact, via `usesSource`).
 *
 * Both effects below carry the same `cancelled` guard as task 6's `useOfficeState` (this repo's
 * own established pattern for "a bridge call must not update state once its subtree is gone"):
 * without it, a slow `captureStatus`/`repoLog` reply that lands after the artifact or version
 * selection has moved on would call `setStatus`/`setCommits` on an unmounted (or since-superseded)
 * effect run.
 */
export function useSourcePanel(artifact: Artifact): SourcePanelData {
  const { bridge } = useApp();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((x) => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    void bridge.captureStatus(artifact.projectId).then((r) => {
      if (!cancelled && r.ok) setStatus(r.status);
    });
    return () => {
      cancelled = true;
    };
    // `tick` has no use inside the effect; it exists only so `refresh()` re-runs this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, artifact.projectId, tick]);

  const source = status?.sources.find((s) => s.artifactId === artifact.id);
  const repoId = source?.repo?.id ?? null;
  // Refetches after a sync or a capture too, not only when the repo changes (I3).
  const commitsKey = commitsFetchKey(source);
  useEffect(() => {
    if (!repoId) {
      setCommits([]);
      return;
    }
    let cancelled = false;
    void bridge.repoLog(repoId, 'HEAD', 20).then((r) => {
      if (!cancelled) setCommits(r.ok ? r.commits : []);
    });
    return () => {
      cancelled = true;
    };
    // `commitsKey` includes `repoId` plus the sync and capture times; it exists only to re-run this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, commitsKey]);

  const onPickRepo = useCallback(() => {
    void bridge.pickRepo().then(async (r) => {
      if (r.ok) {
        await bridge.captureBindRepo(artifact.id, r.repo.id);
        refresh();
      }
    });
  }, [bridge, artifact.id, refresh]);
  const onUnbindRepo = useCallback(() => {
    void bridge.captureBindRepo(artifact.id, null).then(refresh);
  }, [bridge, artifact.id, refresh]);
  const onSaveToken = useCallback(
    (token: string) => {
      void bridge.overleafSetToken(token).then(refresh);
    },
    [bridge, refresh],
  );
  const onClearToken = useCallback(() => {
    void bridge.overleafSetToken(null).then(refresh);
  }, [bridge, refresh]);
  const [syncing, setSyncing] = useState(false);
  const syncer = useMemo(() => createOverleafSyncer(bridge, artifact.id, refresh, setSyncing), [bridge, artifact.id, refresh]);
  const onSync = useCallback(() => void syncer.sync(), [syncer]);
  const onDisconnectNotion = useCallback(() => {
    void bridge.notionDisconnect().then(refresh);
  }, [bridge, refresh]);
  const { waiting: notionWaiting, connect: onConnectNotion } = useNotionConnect(bridge, artifact.projectId, refresh);

  return {
    row: sourceRow(artifact, status),
    overleafToken: status?.overleafToken ?? false,
    notionConnected: status?.notion === 'connected',
    notionWaiting,
    syncing,
    commits,
    refresh,
    onPickRepo,
    onUnbindRepo,
    onSaveToken,
    onClearToken,
    onSync,
    onConnectNotion,
    onDisconnectNotion,
  };
}
