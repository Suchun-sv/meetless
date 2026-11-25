import { describe, expect, it } from 'vitest';
import { API_ROUTES, WEB_CSRF_COOKIE, WEB_CSRF_HEADER, WEB_HOST_META, WEB_SESSION_COOKIE, WEB_SESSION_PATH } from '../src/index';
import type { WebSessionReq, WebSessionRes } from '../src/index';

describe('web session constants', () => {
  it('have the exact names the server, the web bridge and the page share', () => {
    expect(WEB_SESSION_COOKIE).toBe('ml_session');
    expect(WEB_CSRF_COOKIE).toBe('ml_csrf');
    expect(WEB_CSRF_HEADER).toBe('x-meetless-csrf');
    expect(WEB_SESSION_PATH).toBe('/v1/web/session');
    expect(WEB_HOST_META).toBe('meetless-host');
  });

  it('the web session path is not an API_ROUTES entry (no MCP tool, no API contract change)', () => {
    expect(Object.values(API_ROUTES).map((r): string => r.path)).not.toContain(WEB_SESSION_PATH);
  });

  it('the request and response types take the documented shapes', () => {
    const byToken: WebSessionReq = { token: 'mlp_x' };
    const byInvite: WebSessionReq = { code: 'AAAA-BBBB-CCCC', displayName: 'Ana', locale: 'en' };
    const res: WebSessionRes = { user: { id: 'u-x', displayName: 'Ana', locale: 'en' } };
    expect([byToken, byInvite, res]).toHaveLength(3);
  });
});
