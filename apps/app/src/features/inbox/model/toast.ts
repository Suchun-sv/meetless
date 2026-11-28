import { useSyncExternalStore } from 'react';

/** B5's toast after a commit, shown on B1: the result line, 撤销 and 去看看; the card it highlights. */
export interface DoneToast {
  materialId: string;
  text: string;
  projectIds: string[];
  at: number;
}

let current: DoneToast | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function showDoneToast(t: Omit<DoneToast, 'at'>): void {
  current = { ...t, at: Date.now() };
  emit();
}

export function clearDoneToast(): void {
  current = null;
  emit();
}

export function useDoneToast(): DoneToast | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => current,
  );
}
