import type { Extract, Id, Input, State } from '@meetless/core';

/**
 * What an `added` reply still offers, read from `live` (never the frozen reply): the extracts of
 * its input still pending, the ones 「全部加入」 may take in bulk, and that bulk in the order to
 * accept it. A conflicting revision of a shared need is decided in To confirm, never in bulk.
 */
export interface AddedState {
  input: Input | null;
  pending: Extract[];
  bulk: Extract[];
  /** `bulk` with parents before the hypotheses that hang under them, so a child accepted in the same batch finds its need. */
  ordered: Extract[];
}

export function addedState(live: State, inputId: Id): AddedState {
  const input = live.inputs[inputId] ?? null;
  const pending = input ? input.extracts.filter((x) => x.state === null) : [];
  const bulk = input ? pending.filter((x) => !(x.conflict && input.privateTo === null)) : [];
  const ids = new Set(bulk.map((x) => x.id));
  const child = (x: Extract) => Number(!!x.parent && ids.has(x.parent));
  const ordered = [...bulk].sort((a, b) => child(a) - child(b));
  return { input, pending, bulk, ordered };
}
