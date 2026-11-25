import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import {
  API_ROUTES,
  APP_ROUTE_NAMES,
  MCP_PATH,
  MCP_TOOL_ROUTE,
  MCP_TOOLS,
  requestParts,
} from '../src/index';
import type { ApiName } from '../src/index';

const allNames = Object.keys(API_ROUTES) as ApiName[];

describe('API_ROUTES', () => {
  it('route names are unique and so is every method + path', () => {
    expect(new Set(allNames).size).toBe(allNames.length);

    const methodPaths = allNames.map((name) => `${API_ROUTES[name].method} ${API_ROUTES[name].path}`);
    expect(new Set(methodPaths).size).toBe(methodPaths.length);
  });

  it('has the session.revoke route from the coordinator ruling', () => {
    expect(API_ROUTES['session.revoke']).toEqual({
      method: 'DELETE',
      path: '/v1/session',
      auth: 'user',
      from: ['app'],
    });
  });
});

describe('requestParts', () => {
  it('encodes path params, puts the rest in the query for GET/DELETE and in a JSON body for POST', () => {
    expect(requestParts('context.get', { projectId: 'p 1', code: 'N2', locale: 'en' }, 'http://h')).toEqual({
      method: 'GET',
      url: 'http://h/v1/projects/p%201/needs/N2/context?locale=en',
      body: null,
    });
    expect(requestParts('tokens.create', { label: 'Mac' }, 'http://h').body).toBe('{"label":"Mac"}');
  });

  it('has no "?" when a GET route has no remaining fields', () => {
    expect(requestParts('tokens.list', {}, 'http://h')).toEqual({
      method: 'GET',
      url: 'http://h/v1/tokens',
      body: null,
    });
  });

  it('never repeats a path param in the query string', () => {
    const { url } = requestParts('invites.list', { projectId: 'proj1' }, 'http://h');
    expect(url).toBe('http://h/v1/projects/proj1/invites');
  });

  it('url-encodes path params for DELETE and sends no body', () => {
    expect(requestParts('tokens.revoke', { tokenId: 't 1' }, 'http://h')).toEqual({
      method: 'DELETE',
      url: 'http://h/v1/tokens/t%201',
      body: null,
    });
  });

  it('omits undefined fields from the query string of a GET', () => {
    const { url } = requestParts('agentCalls.list', { limit: undefined }, 'http://h');
    expect(url).toBe('http://h/v1/agent-calls');
  });
});

describe('APP_ROUTE_NAMES', () => {
  it('excludes MCP-only and unauthenticated routes', () => {
    expect(APP_ROUTE_NAMES).not.toContain('work.record');
    expect(APP_ROUTE_NAMES).not.toContain('invites.redeem');
  });

  it('is exactly the set of routes reachable from the app with authentication', () => {
    const expected = allNames.filter((name) => {
      const route = API_ROUTES[name];
      return (route.from as readonly string[]).includes('app') && route.auth !== 'none';
    });
    expect([...APP_ROUTE_NAMES].sort()).toEqual([...expected].sort());
    expect(APP_ROUTE_NAMES).toContain('session.revoke');
  });
});

describe('MCP_TOOLS', () => {
  it('every MCP tool maps to a route reachable with an agent token', () => {
    for (const tool of MCP_TOOLS) {
      const routeName = MCP_TOOL_ROUTE[tool];
      const route = API_ROUTES[routeName];
      expect(route).toBeDefined();
      expect(route.auth).toBe('agent');
      expect(route.from).toContain('mcp');
    }
  });

  it('reserves remember and recall for project memory (R70): no current tool uses those names', () => {
    const RESERVED = ['remember', 'recall'];
    for (const name of RESERVED) {
      expect(MCP_TOOLS as readonly string[]).not.toContain(name);
      expect(Object.keys(MCP_TOOL_ROUTE)).not.toContain(name);
    }
  });

  it('MCP is served over Streamable HTTP by the server, not a per-machine env/stdio package', () => {
    expect(MCP_PATH).toBe('/mcp');
    expect('MCP_ENV' in api).toBe(false);
  });
});

describe('agent.guide', () => {
  it('is a user-authenticated app route, alongside session.revoke', () => {
    expect(API_ROUTES['agent.guide']).toEqual({
      method: 'GET',
      path: '/v1/agent/guide',
      auth: 'user',
      from: ['app'],
    });
    expect(APP_ROUTE_NAMES).toContain('agent.guide');
    expect(APP_ROUTE_NAMES).toContain('session.revoke');
  });
});
