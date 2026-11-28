import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id } from '@meetless/core';
import { useApp } from '@/state';
import { ccApprove, ccCancel, ccFollow, ccHistory, ccStatus, ccTurn, type ApiFn, type CcStatus } from './api';
import { applyEvent, fromHistory, isOpened, markOpened, type CcRow } from './model';

/**
 * The project's Claude Code session as the chat sees it: its status (idle, running here, in use
 * elsewhere; owner or not), the thread (history from the transcript, so turns made elsewhere show,
 * plus the live turn), and send / stop / approve / load more / refresh.
 */
export function useCcSession(projectId: Id, active: boolean) {
  const api = useApp().api as unknown as ApiFn;
  const [status, setStatus] = useState<CcStatus | null>(null);
  const [rows, setRows] = useState<CcRow[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [opened, setOpened] = useState(() => isOpened(projectId));
  const turn = useRef<{ stop: () => void } | null>(null);

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([ccStatus(api, projectId).catch(() => null), ccHistory(api, projectId).catch(() => null)]);
    if (s) setStatus(s);
    if (h && !turn.current) {
      setRows(fromHistory(h.items));
      setBefore(h.before);
    }
  }, [api, projectId]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  // A turn already running here (after a reload, or started on another of my screens): follow it.
  const runningTurn = status?.state === 'running_here' ? (status.turn?.id ?? null) : null;
  useEffect(() => {
    if (!active || !runningTurn || turn.current) return;
    setRunning(true);
    const f = ccFollow(api, projectId, runningTurn, 0, (e) => setRows((cur) => applyEvent(cur, e)));
    turn.current = f;
    void f.done.finally(() => {
      turn.current = null;
      setRunning(false);
      void refresh();
    });
    return () => f.stop();
  }, [active, runningTurn, api, projectId, refresh]);

  // While someone else holds the session, look again now and then.
  useEffect(() => {
    if (!active || status?.state !== 'in_use_elsewhere') return;
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [active, status?.state, refresh]);

  const loadMore = useCallback(async () => {
    if (!before) return;
    const h = await ccHistory(api, projectId, before).catch(() => null);
    if (!h) return;
    setRows((cur) => [...fromHistory(h.items), ...cur]);
    setBefore(h.before);
  }, [projectId, before]);

  const send = useCallback(
    async (text: string) => {
      if (running || !text.trim()) return;
      setRunning(true);
      setRows((cur) => [...cur, { kind: 'user', id: 'pending-user', text }]);
      setStatus((s) => (s ? { ...s, state: 'running_here' } : s));
      const t = ccTurn(api, projectId, text, (e) => setRows((cur) => applyEvent(cur, e)));
      turn.current = t;
      try {
        await t.done;
      } finally {
        turn.current = null;
        setRunning(false);
        const s = await ccStatus(api, projectId).catch(() => null);
        if (s) setStatus(s);
      }
    },
    [projectId, running],
  );

  const stop = useCallback(async () => {
    turn.current?.stop();
    await ccCancel(api, projectId).catch(() => undefined);
  }, [projectId]);

  const approve = useCallback(
    async (approvalId: string, allow: boolean) => {
      setRows((cur) => cur.map((r) => (r.kind === 'permission' && r.id === approvalId ? { ...r, state: allow ? 'allow' : 'deny' } : r)));
      await ccApprove(api, projectId, approvalId, allow).catch(() => undefined);
    },
    [projectId],
  );

  const open = useCallback(() => {
    markOpened(projectId);
    setOpened(true);
  }, [projectId]);

  /** The owner has never used it: confirm 「为这个项目开启 Claude Code」 first. */
  const needsOpening = !!status && status.owner && status.session === null && !opened && rows.length === 0;
  return { status, rows, running, more: before !== null, needsOpening, refresh, loadMore, send, stop, approve, open };
}

export type CcSession = ReturnType<typeof useCcSession>;
