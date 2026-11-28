import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Id, State } from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import { useApp } from '@/state';
import { pendingMaterials } from '@/state/inbox';
import { getMaterial, listInbox, seedMockProjects, type ApiFn, type CardKind, type InboxCard, type InboxList, type InboxMaterial } from './api';
import { onInboxChanged } from './watch';

/**
 * Before the server has the inbox (production without S's routes), B1 still lists the per-project
 * items waiting for confirmation, grouped by source material (`pendingMaterials` in core), as cards.
 * They open the project's 待确认 page instead of a material page.
 */
export function localInbox(t: Translator['t'], live: State, me: Id, today: string): InboxList {
  const pending: InboxCard[] = pendingMaterials(live, me, today).map((m) => {
    const input = m.inputId ? live.inputs[m.inputId] : undefined;
    const proposal = m.kind === 'proposal' ? live.proposals[m.key.slice(3)] : undefined;
    const kind: CardKind = m.kind === 'proposal' ? 'proposal' : input?.scene === 'mail' ? 'mail' : input?.scene === 'chat' ? 'chat' : input?.kind === 'pdf' ? 'pdf' : 'text';
    const title = input?.title ?? proposal?.title ?? t('inb.question');
    const source = m.kind === 'proposal' ? t('inb.agent') : input ? t(`lin.type.${input.scene ?? 'doc'}`) : t('inb.question');
    const id = m.kind === 'proposal' ? `proposal:${m.key.slice(3)}` : m.inputId ? `input:${m.inputId}` : m.key;
    return { id, kind, title, source, addedAt: input?.date ?? today, status: 'ready', counts: { items: m.items, projects: m.projectIds.length, duplicates: 0, conflicts: 0 }, projectIds: m.projectIds };
  });
  return { pending, recent: [], older: 0, badge: pending.length };
}

/**
 * The 「需求」 list: the server's inbox when it has one (or the dev mock), else the local cards.
 * Reloads on focus, and every few seconds while something is still being analysed.
 */
export function useInbox() {
  const { t, live, me, today, api } = useApp();
  const [server, setServer] = useState<InboxList | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // The dev mock names the user's own projects; their list arrives with the replayed state.
  useEffect(() => {
    seedMockProjects(Object.values(live.projects).filter((p) => p.memberIds.includes(me)).map((p) => p.id));
  }, [live.projects, me]);
  const refresh = useCallback(async () => {
    try {
      const l = await listInbox(api as unknown as ApiFn);
      if (alive.current) {
        setServer(l);
        setFailed(false);
      }
    } catch {
      if (alive.current) setFailed(true);
    }
  }, [api]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  // An analysis finished in the background, or a material was committed or undone.
  useEffect(() => onInboxChanged(() => void refresh()), [refresh]);
  const analysing = server?.recent.some((c) => c.status === 'analyzing') ?? false;
  useEffect(() => {
    if (!analysing) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [analysing, refresh]);
  const list = server ?? (failed ? localInbox(t, live, me, today) : null);
  return { list, local: !server && failed, refresh };
}

/** Materials waiting for the user (the tab badge and 我的's 「N 份材料待确认」): the server's badge, else core's count. */
export function usePendingMaterialCount(): number {
  const { list } = useInbox();
  return list?.badge ?? 0;
}

/** One material, followed while it is analysed: `inbox.get` long-polls past the last `rev`. */
export function useMaterial(materialId: string) {
  const { api } = useApp();
  const [m, setM] = useState<InboxMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let stop = false;
    let rev: number | undefined;
    (async () => {
      let fails = 0;
      while (!stop) {
        try {
          const x = await getMaterial(api as unknown as ApiFn, materialId, rev);
          if (stop) return;
          setM(x);
          setError(null);
          fails = 0;
          if (x.status !== 'analyzing') return;
          rev = x.rev;
        } catch (e) {
          if (++fails >= 3) {
            if (!stop) setError((e as { code?: string }).code ?? 'ERROR');
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * fails));
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [api, materialId, epoch]);
  /** Follow again (after a retry). */
  const reload = useCallback(() => setEpoch((n) => n + 1), []);
  return { m, error, reload };
}
