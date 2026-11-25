/**
 * How a "To confirm" item submits its answer: the commands go through `useApp().submit` one at
 * a time, each only after the previous one was accepted or queued (a duplicate counts as done
 * too). A rejection stops the sequence; `submit` has already shown its notice.
 */
import { useRef, useState } from 'react';
import type { AppApi } from '../app/AppContext';
import { useApp } from '../app/AppContext';
import { useThrowNotice } from '../needs/busy';
import type { Cmd } from './model';

/** Submits `cmds` in order; true when every one was accepted, queued or a duplicate. */
export async function runCmds(cmds: readonly Cmd[], submit: AppApi['submit']): Promise<boolean> {
  for (const c of cmds) {
    const r = await submit(c.type, c.payload);
    if (r.kind === 'rejected') return false;
  }
  return true;
}

/**
 * The item's `busy` flag and its `run`. While a submit is pending, `busy` disables the item's
 * buttons, and a ref (not the render-time flag) turns away a second `run` that arrives before
 * the re-render. On success the item reports `label` through `onDone` and stays busy (the panel
 * moves it to the done rows); on a rejection, or a submit that throws (with its notice), it is
 * released and stays as it was.
 */
export function useAnswer(onDone: (label: string) => void): { busy: boolean; run: (cmds: readonly Cmd[], label: string) => Promise<void> } {
  const { submit } = useApp();
  const onThrow = useThrowNotice();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = async (cmds: readonly Cmd[], label: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let ok = false;
    try {
      ok = await runCmds(cmds, submit);
    } catch {
      onThrow();
    }
    if (ok) {
      onDone(label);
      return;
    }
    inFlight.current = false;
    setBusy(false);
  };
  return { busy, run };
}
