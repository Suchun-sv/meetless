import { useEffect, useSyncExternalStore } from 'react';
import { useApp } from '@/state';
import { getMaterial, type ApiFn } from './api';

/*
 * 「可以先离开，分析完会提醒你」: materials the user added (or left while they were analysed) are
 * followed in the background, outside any screen, so leaving B2 does not stop it. When one
 * finishes and its page is not on screen, `useInboxDone` offers 「《title》分析完了」 with 去看看,
 * and every inbox list (B1, the 需求 badge) reloads.
 */

let api: ApiFn | null = null;
const queued = new Map<string, string>();
const running = new Set<string>();
const viewing = new Set<string>();

/** The app's api for the background follow-ups; screens that use the inbox set it. */
export function useInboxWatchApi(): void {
  const { api: a } = useApp();
  useEffect(() => {
    api = a as unknown as ApiFn;
    for (const [id, title] of queued) follow(id, title);
    queued.clear();
  }, [a]);
}

/** The material page on screen: its own finish is not announced elsewhere. */
export function useViewingMaterial(materialId: string): void {
  useEffect(() => {
    viewing.add(materialId);
    return () => void viewing.delete(materialId);
  }, [materialId]);
}

const changeSubs = new Set<() => void>();
/** Tell every inbox list to reload (an analysis finished, a material was committed or undone). */
export function inboxChanged(): void {
  changeSubs.forEach((f) => f());
}
export function onInboxChanged(f: () => void): () => void {
  changeSubs.add(f);
  return () => changeSubs.delete(f);
}

let done: { id: string; title: string } | null = null;
const doneSubs = new Set<() => void>();
function setDone(v: typeof done) {
  done = v;
  doneSubs.forEach((f) => f());
}

function follow(id: string, title: string) {
  if (running.has(id) || !api) return;
  running.add(id);
  const a = api;
  void (async () => {
    let rev: number | undefined;
    let fails = 0;
    for (;;) {
      try {
        const m = await getMaterial(a, id, rev);
        fails = 0;
        if (m.status !== 'analyzing') {
          running.delete(id);
          inboxChanged();
          if (!viewing.has(id)) setDone({ id, title: m.title || title });
          return;
        }
        rev = m.rev;
      } catch {
        if (++fails >= 3) {
          running.delete(id);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000 * fails));
      }
    }
  })();
}

/** Follow `materialId` until its analysis ends. */
export function watchMaterial(materialId: string, title: string): void {
  if (api) follow(materialId, title);
  else queued.set(materialId, title);
}

/** The finished material to announce, if any, and a way to dismiss it. */
export function useInboxDone(): { done: { id: string; title: string } | null; dismiss: () => void } {
  const v = useSyncExternalStore(
    (f) => {
      doneSubs.add(f);
      return () => doneSubs.delete(f);
    },
    () => done,
    () => done,
  );
  useEffect(() => {
    if (!v) return;
    const id = setTimeout(() => setDone(null), 8000);
    return () => clearTimeout(id);
  }, [v]);
  return { done: v, dismiss: () => setDone(null) };
}
