import { DETECTOR_ID, detectExtracts, INPUT_KINDS, projectNeeds, shareableView, toItems } from '@meetless/core';
import type { InputKind, Requester } from '@meetless/core';
import type { ApiRequest, ApiResponse } from '@meetless/api';
import type { Principal } from '../auth';
import { ApiError, type ApiDeps } from '../api/frame';
import { optObject, optString, reqBool, reqString } from '../api/fields';
import { extractText, MAX_IMPORT_BYTES, MAX_IMPORT_CHARS } from './extract';

/**
 * `inputs.import` (contract §3): extracts text server-side for `docx`/`pdf`, runs the
 * rule-based detector over the needs the importer may see — shared needs only for a
 * shared (`private: false`) import, so a shared input never proposes an extract against
 * a private need (contract :195, 12.9 C1) — and appends `input.imported` as the user.
 *
 * Steps (brief order, kept literal so a failure maps to the right error — except that a
 * genuine retry answers from the first result immediately, see step 1b):
 * 1. The caller must be a member of `req.projectId` (`NOT_A_MEMBER` / `NOT_FOUND`).
 * 0. Every request field has its wire type (`api/fields.ts`): a wrong-typed or missing one is
 *    `BAD_REQUEST { field }`; `private` must be exactly `true` or `false`.
 * 1b. Retry short-circuit (review finding, Task 5 fix round 1): if the caller's own view
 *     already has an input `req.inputId` they themselves imported into this project, answer
 *     from it immediately (the caller's own input with that id in another project is
 *     `ALREADY_EXISTS`) — no blob read, no re-extraction, and nothing in steps 2–6 can turn
 *     a genuine retry of an already-succeeded import into a different answer. An input with
 *     that id that is not the caller's own (someone else's, or not visible to the caller) is
 *     never revealed here: it falls through to the normal path, where `service.submit`'s
 *     id-based dedupe refuses it (`ALREADY_EXISTS`) exactly as before this fix.
 * 2. Exactly one of `text` and `blobHash`; `docx` and `pdf` require `blobHash` (`BAD_REQUEST`).
 * 3. A `blobHash` must exist and be readable by the caller (`NOT_AUTHORISED`), and no
 *    bigger than `MAX_IMPORT_BYTES` (`TOO_LARGE`), before its bytes are read.
 * 4. The resulting text must be no longer than `MAX_IMPORT_CHARS` (`TOO_LARGE`).
 * 5. `toItems` splits it: one paragraph per line, and one per item of an enumeration.
 * 6. Detection runs against the importer's visible needs (private import) or only the
 *    shared ones (shared import): DeepSeek when the server has it (validated JSON), else, or
 *    when that fails, the rule detector. `opts.addAll` (text given to the agent to add) makes
 *    every item a candidate need for the rules.
 * 7. `service.submit` appends `input.imported`; a duplicate `inputId` is answered from
 *    the input already stored (no new append) — still the fallback for the cases step 1b
 *    does not short-circuit (concurrent first-time submits racing on the same id, etc.) —
 *    but only if that stored input is the caller's own in this project; otherwise
 *    `ALREADY_EXISTS { what: 'input', id }`.
 */
export async function importInput(deps: ApiDeps, p: Principal, req: ApiRequest<'inputs.import'>, opts: { addAll?: boolean } = {}): Promise<ApiResponse<'inputs.import'>> {
  const inputId = reqString(req.inputId, 'inputId');
  const title = reqString(req.title, 'title');
  const kind = reqString(req.kind, 'kind') as InputKind;
  // Checked before any blob is read or parsed (an unknown kind used to fall into the PDF parser).
  if (!(INPUT_KINDS as readonly string[]).includes(kind)) throw new ApiError('BAD_REQUEST', { field: 'kind' });
  const blobHash = optString(req.blobHash, 'blobHash');
  const given = optString(req.text, 'text');
  const from = optObject(req.from, 'from') as Requester | null;
  const date = reqString(req.date, 'date');
  const isPrivate = reqBool(req.private, 'private');

  deps.service.requireMember(p.userId, req.projectId);

  const already = deps.service.view(p.userId).inputs[inputId];
  if (already && already.importedBy === p.userId) {
    if (already.projectId !== req.projectId) throw takenIn(inputId);
    return { inputId, seq: already.seq, extracts: already.extracts.length };
  }

  const hasText = given !== null;
  const hasBlob = blobHash !== null;
  if (hasText === hasBlob) throw new ApiError('BAD_REQUEST');
  if ((kind === 'docx' || kind === 'pdf') && !hasBlob) throw new ApiError('BAD_REQUEST');

  let text: string;
  if (hasBlob) {
    const meta = await deps.service.blobMeta.get(blobHash);
    const readable = meta !== null && (await deps.service.canReadBlob(p.userId, blobHash));
    if (!readable) throw new ApiError('NOT_AUTHORISED');
    if (meta!.size > MAX_IMPORT_BYTES) throw new ApiError('TOO_LARGE');
    const bytes = await deps.service.blobFiles.readBytes(blobHash);
    text = await extractText(kind, bytes);
  } else {
    text = given!;
  }
  if (text.length > MAX_IMPORT_CHARS) throw new ApiError('TOO_LARGE');

  const { paras, lead } = toItems(text, `${inputId}-p`, { addAll: opts.addAll === true });
  const view = deps.service.view(p.userId);
  const needs = isPrivate ? projectNeeds(view, req.projectId) : projectNeeds(shareableView(view), req.projectId);
  const byModel = deps.ai?.enabled ? await deps.ai.extract(p.userId, text, needs, paras) : null;
  const extracts = byModel ?? detectExtracts(paras, needs, 8, lead);
  const detector = byModel ? `deepseek/${deps.ai!.model}` : DETECTOR_ID;

  await deps.service.submit(p.userId, {
    id: `import:${inputId}`,
    type: 'input.imported',
    payload: {
      inputId,
      projectId: req.projectId,
      kind,
      title,
      from,
      date,
      blobHash,
      body: paras,
      extracts,
      detector,
      private: isPrivate,
    },
  });

  // Accepted or duplicate, the stored input (just-written or the original) is the answer, but only
  // when it is this caller's own import into this project: the same id already used in another
  // project (a duplicate submit by the same user) is refused, never answered with that project's seq.
  const input = deps.service.current.inputs[inputId]!;
  if (input.projectId !== req.projectId || input.importedBy !== p.userId) throw takenIn(inputId);
  return { inputId, seq: input.seq, extracts: input.extracts.length };
}

/** The refusal for an `inputId` already used elsewhere: names only the caller's own id, nothing of the stored input. */
function takenIn(inputId: string): ApiError {
  return new ApiError('ALREADY_EXISTS', { what: 'input', id: inputId });
}
