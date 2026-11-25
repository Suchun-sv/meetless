import { fetchContext } from '../agentapi/context';
import { listNeeds } from '../agentapi/needs';
import { readArtifact, searchHits } from '../agentapi/read';
import { clientOf } from './frame';
import type { Handler } from './frame';

/** `context.get`: all of the membership check, locale resolution and fetch recording lives in `fetchContext`. */
const contextGet: Handler<'context.get'> = async ({ p, req, http, deps }) => fetchContext(deps, p, req, clientOf(p, http));

/** `needs.list`: the project membership check, then `listNeeds` over the caller's own view. */
const needsList: Handler<'needs.list'> = async ({ p, req, deps }) => {
  deps.service.requireMember(p.userId, req.projectId);
  return { needs: listNeeds(deps.service.view(p.userId), req) };
};

/** `search`: no project membership check (projectId is optional); the view itself is already scoped to the caller's own projects. */
const searchRoute: Handler<'search'> = async ({ p, req, deps }) => ({ hits: searchHits(deps.service.view(p.userId), req) });

/** `artifacts.read`: the project membership check, then `readArtifact` over the caller's own view. */
const artifactsRead: Handler<'artifacts.read'> = async ({ p, req, deps }) => {
  deps.service.requireMember(p.userId, req.projectId);
  return readArtifact(deps, deps.service.view(p.userId), req);
};

/** Agent read handlers (context, needs, search, artifacts): spread into `HANDLERS` in `api/index.ts`. */
export const READ_HANDLERS = {
  'context.get': contextGet,
  'needs.list': needsList,
  search: searchRoute,
  'artifacts.read': artifactsRead,
};
