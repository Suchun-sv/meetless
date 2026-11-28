import type { ApiName } from '@meetless/api';
import { ApiError, type ApiDeps, type Handler } from './frame';
import { optInt, reqString } from './fields';

/** A project's Claude Code session (src/cc/manager.ts); NOT_AVAILABLE on a server that runs none. */
const cc = (deps: ApiDeps) => {
  if (!deps.cc) throw new ApiError('NOT_AVAILABLE');
  return deps.cc;
};

export const CC_HANDLERS: Partial<{ [K in ApiName]: Handler<K> }> = {
  'cc.status': async ({ p, req, deps }) => {
    if (!deps.cc) {
      const proj = deps.service.current.projects[req.projectId];
      if (!proj || !deps.service.readable(p.userId).has(req.projectId)) throw new ApiError('NOT_A_MEMBER');
      return { available: false, state: 'idle', owner: proj.createdBy === p.userId, session: null, repoPath: null, turn: null };
    }
    return deps.cc.status(p.userId, req.projectId);
  },
  'cc.history': async ({ p, req, deps }) => cc(deps).history(p.userId, req.projectId, typeof req.before === 'string' ? req.before : undefined, optInt(req.limit, 'limit')),
  'cc.turn': async ({ p, req, deps }) => cc(deps).turn(p.userId, req.projectId, reqString(req.text, 'text')),
  'cc.events': async ({ p, req, deps }) =>
    cc(deps).events(p.userId, req.projectId, typeof req.turnId === 'string' && req.turnId ? req.turnId : undefined, optInt(req.after, 'after') ?? 0),
  'cc.cancel': async ({ p, req, deps }) => cc(deps).cancel(p.userId, req.projectId),
  'cc.approve': async ({ p, req, deps }) => {
    if (typeof req.allow !== 'boolean') throw new ApiError('BAD_REQUEST');
    return cc(deps).approve(p.userId, req.projectId, reqString(req.approvalId, 'approvalId'), req.allow);
  },
  'cc.handoff': async ({ p, req, deps }) => cc(deps).handoff(p.userId, req.projectId),
  'cc.repo': async ({ p, req, deps }) => {
    if (req.repoPath !== null && typeof req.repoPath !== 'string') throw new ApiError('BAD_REQUEST');
    return cc(deps).setRepo(p.userId, req.projectId, req.repoPath);
  },
};
