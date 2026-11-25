import type { KeyboardEvent } from 'react';
import { isActivationKey } from './model';

/*
 * Small pieces shared by the Home and project card files (`HomeCards.tsx`, `ProjectCards.tsx`).
 */

/** A bar, never a dot: `bar2-f`'s CSS min-width keeps a near-0% value visible. `grow` lets it fill a row. */
export function Bar({ a, b, grow }: { a: number; b: number; grow?: boolean }) {
  const pct = b ? Math.round((a / b) * 100) : 0;
  return (
    <div className={`bar2${grow ? ' grow' : ''}`}>
      <div className="bar2-f" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The props that make a `div` row act as a button: focusable, and run by a click, Enter or Space.
 * Risk rows need this instead of a `<button>` because a project risk row holds a `NeedChip`, itself
 * a button. A key press on that inner chip is the chip's own, never the row's.
 */
export function rowButton(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || !isActivationKey(e.key)) return;
      e.preventDefault();
      onActivate();
    },
  };
}

/** A card's empty state: what is missing, and the one action that fills it. */
export function CardEmpty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="wg-empty" data-testid="card-empty">
      <div className="faint small">{text}</div>
      {action && onAction && (
        <button type="button" className="btn btn-sm" data-testid="card-empty-action" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
