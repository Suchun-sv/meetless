import { useEffect, useRef, type ReactNode } from 'react';
import { closesOnClick, FOCUSABLE, trapTab } from './focus';

/**
 * A dialog over a scrim. On open it focuses the first focusable element (or the dialog), keeps
 * Tab inside, and gives focus back on close. Escape closes it; so does a click on the scrim when
 * the press also started there.
 */
export function Modal({ onClose, wide, testId, children }: { onClose: () => void; wide?: boolean; testId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const downOnScrim = useRef(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const to = trapTab(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      (to === -1 ? el : items[to]!).focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (closesOnClick(downOnScrim.current, e.target === e.currentTarget)) onClose();
        downOnScrim.current = false;
      }}
    >
      <div ref={box} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
