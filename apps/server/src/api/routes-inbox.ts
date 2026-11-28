import type { ApiName, InboxAddReq } from '@meetless/api';
import { ApiError, type ApiDeps, type Handler } from './frame';
import { optInt, reqString } from './fields';

/** The 「需求」 inbox (src/inbox/manager.ts): every route acts on the caller's own materials only. */
const inbox = (deps: ApiDeps) => {
  if (!deps.inbox) throw new ApiError('NOT_AVAILABLE');
  return deps.inbox;
};

export const INBOX_HANDLERS: Partial<{ [K in ApiName]: Handler<K> }> = {
  'inbox.list': async ({ p, deps }) => inbox(deps).list(p.userId),
  'inbox.add': async ({ p, req, deps }) => {
    const r = req as unknown as Record<string, unknown>;
    for (const f of ['text', 'blobHash', 'mediaType', 'fileName', 'ocrText']) if (r[f] !== undefined && r[f] !== null && typeof r[f] !== 'string') throw new ApiError('BAD_REQUEST', { field: f });
    return inbox(deps).add(p.userId, req as InboxAddReq);
  },
  'inbox.get': async ({ p, req, deps }) => inbox(deps).get(p.userId, reqString(req.materialId, 'materialId'), optInt(req.rev, 'rev')),
  'inbox.commit': async ({ p, req, deps }) => inbox(deps).commit(p.userId, reqString(req.materialId, 'materialId'), req),
  'inbox.undo': async ({ p, req, deps }) => inbox(deps).undo(p.userId, reqString(req.materialId, 'materialId')),
  'inbox.retry': async ({ p, req, deps }) => inbox(deps).retry(p.userId, reqString(req.materialId, 'materialId')),
  'inbox.remove': async ({ p, req, deps }) => inbox(deps).remove(p.userId, reqString(req.materialId, 'materialId')),
};
