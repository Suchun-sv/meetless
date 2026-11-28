import type { Id, IsoDate, State } from '@meetless/core';
import { acceptCommands } from '@renderer/collab/confirm';
import { newId } from '@/state';
import { addedState } from './added';
import type { ChatCommand } from './chat';

/**
 * 「全部加入」 under an `added` reply: accept every bulk extract of the input, parents first, DDLs
 * created once per day across the batch. Adapter over the desktop's `acceptCommands` (the same
 * logic A2's To confirm uses); switch to `features/confirm/model` once A2 is merged.
 */
export function acceptAllCommands(live: State, inputId: Id, today: IsoDate): ChatCommand[] {
  const st = addedState(live, inputId);
  if (!st.input) return [];
  const input = st.input;
  const made = new Map<IsoDate, Id>();
  return st.ordered.flatMap((x) => acceptCommands(live, input, x, newId('n'), today, x.due ?? null, made)) as ChatCommand[];
}
