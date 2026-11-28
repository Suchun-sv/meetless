import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';
import type { IconName } from '@/components/ui/Icon';

/**
 * The phone shell's shared state (mobile-v1): header actions a page adds to the project header, and
 * the bottom inset pages must leave free. The ask bar and the Agent sheet are A3's (ChatDock).
 */
export interface HeaderAction {
  /** An icon button (产物's +), or a text button when `text` is set (待确认's 全部接受). */
  icon?: IconName;
  text?: string;
  label: string;
  onPress: () => void;
  testID?: string;
}

/** A page's own back step in the nav bar (B4's 「‹ 返回」 to B3 inside one route). */
export interface HeaderBack {
  label: string;
  onPress: () => void;
}

interface Chrome {
  back: HeaderBack | null;
  setBack: (owner: number, b: HeaderBack | null) => void;
  clearBack: (owner: number) => void;
  actions: HeaderAction[];
  /** `owner` scopes the actions to one screen: a later screen's set is never cleared by an earlier one's cleanup. */
  setActions: (owner: number, a: HeaderAction[]) => void;
  clearActions: (owner: number) => void;
  bottomInset: number;
}

const Ctx = createContext<Chrome | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ owner: number; actions: HeaderAction[] }>({ owner: 0, actions: [] });
  const [backState, setBackState] = useState<{ owner: number; back: HeaderBack | null }>({ owner: 0, back: null });
  const actions = state.actions;
  const back = backState.back;
  const value = useMemo<Chrome>(
    () => ({
      back,
      setBack: (owner, b) => setBackState({ owner, back: b }),
      clearBack: (owner) => setBackState((s) => (s.owner === owner ? { owner: 0, back: null } : s)),
      actions,
      setActions: (owner, a) => setState({ owner, actions: a }),
      clearActions: (owner) => setState((s) => (s.owner === owner ? { owner: 0, actions: [] } : s)),
      // The ask bar and the tab bar sit in the layout flow below the content, so nothing is covered.
      bottomInset: 0,
    }),
    [actions, back],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useChrome(): Chrome {
  const v = useContext(Ctx);
  if (!v) throw new Error('chrome outside ChromeProvider');
  return v;
}

let nextOwner = 1;

/**
 * A page's actions in the phone header, left of ⋯ (产物's +, 待确认's 全部接受). Shown only while that
 * screen is focused: on native the stack keeps blurred screens mounted, so mount/unmount is not enough.
 */
export function useHeaderActions(actions: HeaderAction[]): void {
  const { setActions, clearActions } = useChrome();
  const owner = useRef(0);
  if (owner.current === 0) owner.current = nextOwner++;
  const latest = useRef(actions);
  latest.current = actions;
  const key = actions.map((a) => `${a.icon ?? ''}:${a.text ?? ''}:${a.label}`).join('|');
  useFocusEffect(
    useCallback(() => {
      const id = owner.current;
      setActions(id, latest.current);
      return () => clearActions(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );
}

export function useHeaderActionList(): HeaderAction[] {
  return useChrome().actions;
}

/** Extra bottom padding for absolutely positioned or floating content on phones (0: the bars are in flow). */
export function useBottomInset(): number {
  return useContext(Ctx)?.bottomInset ?? 0;
}

/**
 * Overrides the nav bar's back (label and action) while the calling screen is focused; null keeps the
 * default. Like useHeaderActions, scoped to its screen and cleared on blur.
 */
export function useHeaderBack(back: HeaderBack | null): void {
  const { setBack, clearBack } = useChrome();
  const owner = useRef(0);
  if (owner.current === 0) owner.current = nextOwner++;
  const latest = useRef(back);
  latest.current = back;
  const key = back ? back.label : '';
  useFocusEffect(
    useCallback(() => {
      const id = owner.current;
      if (latest.current) setBack(id, { label: latest.current.label, onPress: () => latest.current?.onPress() });
      else clearBack(id);
      return () => clearBack(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );
}

export function useHeaderBackOverride(): HeaderBack | null {
  return useContext(Ctx)?.back ?? null;
}
