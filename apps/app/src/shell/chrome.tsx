import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

interface Chrome {
  actions: HeaderAction[];
  setActions: (a: HeaderAction[]) => void;
  bottomInset: number;
}

const Ctx = createContext<Chrome | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<HeaderAction[]>([]);
  const value = useMemo<Chrome>(
    () => ({
      actions,
      setActions,
      // The ask bar and the tab bar sit in the layout flow below the content, so nothing is covered.
      bottomInset: 0,
    }),
    [actions],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useChrome(): Chrome {
  const v = useContext(Ctx);
  if (!v) throw new Error('chrome outside ChromeProvider');
  return v;
}

/** A page's actions in the project header, left of ⋯ (e.g. 产物's +). Cleared on unmount. */
export function useHeaderActions(actions: HeaderAction[]): void {
  const { setActions } = useChrome();
  const key = actions.map((a) => `${a.icon ?? ''}:${a.text ?? ''}:${a.label}`).join('|');
  useEffect(() => {
    setActions(actions);
    return () => setActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useHeaderActionList(): HeaderAction[] {
  return useChrome().actions;
}

/** Extra bottom padding for absolutely positioned or floating content on phones (0: the bars are in flow). */
export function useBottomInset(): number {
  return useContext(Ctx)?.bottomInset ?? 0;
}
