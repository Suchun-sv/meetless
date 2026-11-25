import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { renameCommand } from './rename';

/**
 * The inline project-name edit that 「重命名」 opens in the top bar and on each sidebar project row
 * (contract 12.23). Enter saves, Esc cancels, and blur saves, as the hypothesis verdict field in
 * `DrawerEdit` does. An unchanged name sends nothing and closes. An empty or too long name shows
 * its error notice and sends nothing: Enter keeps the edit open, blur closes it. A refusal from
 * the service shows through `submit`'s own notice, and a submit that throws shows the network
 * notice. The input is uncontrolled and each handler reads the text from the element. `settled`
 * makes sure that the blur that follows Enter or Esc, or the unmount, never sends a second time.
 */
export function RenameInput({ projectId, name, onDone, className = '' }: { projectId: Id; name: string; onDone: () => void; className?: string }) {
  const { t, submit, notify, errorText } = useApp();
  const settled = useRef(false);
  const [busy, setBusy] = useState(false);

  const commit = async (draft: string, from: 'enter' | 'blur'): Promise<void> => {
    if (settled.current) return;
    const r = renameCommand(projectId, name, draft);
    if (r.kind === 'error') {
      notify('error', t(r.key));
      if (from === 'blur') {
        settled.current = true;
        onDone();
      }
      return;
    }
    settled.current = true;
    if (r.kind === 'cmd') {
      setBusy(true);
      try {
        await submit(r.type, r.payload);
      } catch {
        notify('error', errorText('NETWORK'));
      } finally {
        setBusy(false);
      }
    }
    onDone();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): Promise<void> | undefined => {
    if (e.key === 'Escape') {
      e.preventDefault();
      settled.current = true;
      onDone();
      return undefined;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return undefined;
    e.preventDefault();
    return commit(e.currentTarget.value, 'enter');
  };

  return (
    <input
      className={`inp rename-inp ${className}`.trim()}
      data-testid="rename-input"
      data-project={projectId}
      aria-label={t('pj.name')}
      defaultValue={name}
      readOnly={busy}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(e: FocusEvent<HTMLInputElement>) => commit(e.currentTarget.value, 'blur')}
    />
  );
}
