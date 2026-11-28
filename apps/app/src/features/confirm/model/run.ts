/**
 * Submitting a sequence of commands: one at a time, each only after the previous one was
 * accepted, queued or a duplicate. A rejection stops the sequence (the app's submit has already
 * shown its notice). `Submit` is the app's `submit(type, payload)`.
 */
import type { SubmitResult } from '@meetless/client/bridge';
import type { EventPayloads, EventType } from '@meetless/core';
import type { Cmd } from '../../../../../desktop/src/renderer/collab/model';

export type { Cmd, SubmitResult };
export type Submit = <K extends EventType>(type: K, payload: EventPayloads[K]) => Promise<SubmitResult>;

/** Submits `cmds` in order; true when every one went through. */
export async function runCmds(cmds: readonly Cmd[], submit: Submit): Promise<boolean> {
  for (const c of cmds) {
    const r = await submit(c.type, c.payload);
    if (r.kind === 'rejected') return false;
  }
  return true;
}

/** Whether a submit result counts as done (accepted, queued or a duplicate). */
export function went(r: SubmitResult | undefined): boolean {
  return r !== undefined && r.kind !== 'rejected';
}
