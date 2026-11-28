import type { ApiName } from './types';

export interface RouteDef {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  auth: 'user' | 'agent' | 'none';
  from: readonly ('app' | 'mcp')[];
}

/**
 * The route table (contract §3), plus `session.revoke` (coordinator ruling).
 * Path params are the `:name` segments of `path`; they are fields of the route's `req`.
 */
export const API_ROUTES = {
  me: { method: 'GET', path: '/v1/me', auth: 'user', from: ['app'] },
  'invites.create': { method: 'POST', path: '/v1/projects/:projectId/invites', auth: 'user', from: ['app'] },
  'invites.list': { method: 'GET', path: '/v1/projects/:projectId/invites', auth: 'user', from: ['app'] },
  'invites.revoke': {
    method: 'DELETE',
    path: '/v1/projects/:projectId/invites/:inviteId',
    auth: 'user',
    from: ['app'],
  },
  'invites.redeem': { method: 'POST', path: '/v1/invites/redeem', auth: 'none', from: ['app'] },
  'tokens.create': { method: 'POST', path: '/v1/tokens', auth: 'user', from: ['app'] },
  'tokens.list': { method: 'GET', path: '/v1/tokens', auth: 'user', from: ['app'] },
  'tokens.revoke': { method: 'DELETE', path: '/v1/tokens/:tokenId', auth: 'user', from: ['app'] },
  'agentCalls.list': { method: 'GET', path: '/v1/agent-calls', auth: 'user', from: ['app'] },
  'agentSetup.get': { method: 'GET', path: '/v1/agent-setup', auth: 'user', from: ['app'] },
  'agent.guide': { method: 'GET', path: '/v1/agent/guide', auth: 'user', from: ['app'] },
  'agent.ask': { method: 'POST', path: '/v1/agent/ask', auth: 'user', from: ['app'] },
  'inputs.import': { method: 'POST', path: '/v1/projects/:projectId/inputs', auth: 'user', from: ['app'] },
  'office.config': {
    method: 'GET',
    path: '/v1/projects/:projectId/artifacts/:artifactId/versions/:versionId/office',
    auth: 'user',
    from: ['app'],
  },
  'context.get': {
    method: 'GET',
    path: '/v1/projects/:projectId/needs/:code/context',
    auth: 'agent',
    from: ['app', 'mcp'],
  },
  'projects.list': { method: 'GET', path: '/v1/projects', auth: 'agent', from: ['mcp'] },
  'needs.list': { method: 'GET', path: '/v1/projects/:projectId/needs', auth: 'agent', from: ['mcp'] },
  search: { method: 'GET', path: '/v1/search', auth: 'agent', from: ['mcp'] },
  'artifacts.read': { method: 'GET', path: '/v1/projects/:projectId/artifacts/:artifactId', auth: 'agent', from: ['mcp'] },
  'work.record': { method: 'POST', path: '/v1/projects/:projectId/work', auth: 'agent', from: ['mcp'] },
  'needs.propose': { method: 'POST', path: '/v1/projects/:projectId/proposals', auth: 'agent', from: ['mcp'] },
  'needs.verdict': {
    method: 'POST',
    path: '/v1/projects/:projectId/needs/:code/verdict',
    auth: 'agent',
    from: ['mcp'],
  },
  'session.revoke': { method: 'DELETE', path: '/v1/session', auth: 'user', from: ['app'] },
  'cc.status': { method: 'GET', path: '/v1/projects/:projectId/cc/status', auth: 'user', from: ['app'] },
  'cc.history': { method: 'GET', path: '/v1/projects/:projectId/cc/history', auth: 'user', from: ['app'] },
  'cc.turn': { method: 'POST', path: '/v1/projects/:projectId/cc/turn', auth: 'user', from: ['app'] },
  'cc.events': { method: 'GET', path: '/v1/projects/:projectId/cc/events', auth: 'user', from: ['app'] },
  'cc.cancel': { method: 'POST', path: '/v1/projects/:projectId/cc/cancel', auth: 'user', from: ['app'] },
  'cc.approve': { method: 'POST', path: '/v1/projects/:projectId/cc/approve', auth: 'user', from: ['app'] },
  'cc.handoff': { method: 'GET', path: '/v1/projects/:projectId/cc/handoff', auth: 'user', from: ['app'] },
  'cc.repo': { method: 'POST', path: '/v1/projects/:projectId/cc/repo', auth: 'user', from: ['app'] },
  'inbox.list': { method: 'GET', path: '/v1/inbox', auth: 'user', from: ['app'] },
  'inbox.add': { method: 'POST', path: '/v1/inbox', auth: 'user', from: ['app'] },
  'inbox.get': { method: 'GET', path: '/v1/inbox/:materialId', auth: 'user', from: ['app'] },
  'inbox.commit': { method: 'POST', path: '/v1/inbox/:materialId/commit', auth: 'user', from: ['app'] },
  'inbox.undo': { method: 'POST', path: '/v1/inbox/:materialId/undo', auth: 'user', from: ['app'] },
  'inbox.retry': { method: 'POST', path: '/v1/inbox/:materialId/retry', auth: 'user', from: ['app'] },
  'inbox.remove': { method: 'DELETE', path: '/v1/inbox/:materialId', auth: 'user', from: ['app'] },
} as const satisfies Record<ApiName, RouteDef>;

type FromOf<K extends ApiName> = (typeof API_ROUTES)[K]['from'][number];
type AuthOf<K extends ApiName> = (typeof API_ROUTES)[K]['auth'];

/** The `ApiName`s whose route is reachable from the app with authentication (contract §3). */
export type AppApiName = {
  [K in ApiName]: 'app' extends FromOf<K> ? (AuthOf<K> extends 'none' ? never : K) : never;
}[ApiName];

export const APP_ROUTE_NAMES: readonly AppApiName[] = (Object.keys(API_ROUTES) as ApiName[]).filter(
  (name): boolean => {
    const route = API_ROUTES[name];
    return (route.from as readonly string[]).includes('app') && route.auth !== 'none';
  },
) as AppApiName[];

/**
 * Builds the method, URL and body for a route call. Path params come from `input` and are
 * URL-encoded; they are never repeated in the query or body. GET/DELETE put the remaining
 * defined fields of `input` in the query string; POST puts them in a JSON body.
 */
export function requestParts(
  name: ApiName,
  input: unknown,
  base: string,
): { method: 'GET' | 'POST' | 'DELETE'; url: string; body: string | null } {
  const route = API_ROUTES[name];
  const req = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const paramNames: string[] = [];
  const path = route.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, param: string) => {
    paramNames.push(param);
    return encodeURIComponent(String(req[param]));
  });
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(req)) {
    if (!paramNames.includes(key)) rest[key] = req[key];
  }

  let url = `${base}${path}`;
  let body: string | null = null;
  if (route.method === 'POST') {
    body = JSON.stringify(rest);
  } else {
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (pairs.length > 0) url += `?${pairs.join('&')}`;
  }
  return { method: route.method, url, body };
}
