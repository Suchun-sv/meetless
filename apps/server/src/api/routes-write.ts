import { proposeNeed, recordWork, setVerdict } from '../agentapi/write';
import { clientOf } from './frame';
import type { Handler } from './frame';

/** `work.record`: project membership and need resolution live in `recordWork`. */
const workRecord: Handler<'work.record'> = async ({ p, req, http, deps }) => recordWork(deps, p, req, clientOf(p, http));

/** `needs.propose`: project membership and parent resolution live in `proposeNeed`. */
const needsPropose: Handler<'needs.propose'> = async ({ p, req, http, deps }) => proposeNeed(deps, p, req, clientOf(p, http));

/** `needs.verdict`: project membership and need resolution live in `setVerdict`; core itself rejects a verdict on a non-hypothesis. */
const needsVerdict: Handler<'needs.verdict'> = async ({ p, req, deps }) => setVerdict(deps, p, req);

/** Agent write handlers (work, proposals, verdicts): spread into `HANDLERS` in `api/index.ts`. */
export const WRITE_HANDLERS = {
  'work.record': workRecord,
  'needs.propose': needsPropose,
  'needs.verdict': needsVerdict,
};
