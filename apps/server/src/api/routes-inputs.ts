import type { Handler } from './frame';
import { importInput } from '../imports/import';

/** `inputs.import`'s handler; frame.ts's `defineRoute` has already confirmed `p` is a user (not an agent token). */
const inputsImport: Handler<'inputs.import'> = async ({ p, req, deps }) => importInput(deps, p, req);

/** Input handlers: spread into `HANDLERS` in `api/index.ts`. */
export const INPUT_HANDLERS = {
  'inputs.import': inputsImport,
};
