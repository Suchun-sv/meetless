import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CLIENT_ERROR_BODY_LIMIT, registerClientErrors } from '../src/web/client-error';
import { serverConfig } from './helpers';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

function build(lines: string[]): FastifyInstance {
  app = Fastify();
  registerClientErrors(app, serverConfig({ dataDir: '/tmp' }), (l) => lines.push(l));
  return app;
}

describe('POST /v1/client-error', () => {
  it('logs one capped JSON line and answers 204, without query strings or extra fields', async () => {
    const lines: string[] = [];
    const a = build(lines);
    const res = await a.inject({ method: 'POST', url: '/v1/client-error', payload: { kind: 'error', message: 'x'.repeat(5000), stack: 'at a\nat b', ua: 'Safari', path: '/p?token=secret', cookie: 'ml_session=mlp_secret' } });
    expect(res.statusCode).toBe(204);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!.replace('[meetless-client-error] ', '')) as Record<string, string>;
    expect(entry.message).toHaveLength(2000);
    expect(entry.stack).toBe('at a at b');
    expect(entry.path).toBe('/p');
    expect(lines[0]).not.toContain('secret');
    expect(Object.keys(entry).sort()).toEqual(['at', 'ip', 'kind', 'message', 'path', 'stack', 'ua']);
  });

  it('refuses a body over the cap', async () => {
    const lines: string[] = [];
    const res = await build(lines).inject({ method: 'POST', url: '/v1/client-error', payload: { message: 'y'.repeat(CLIENT_ERROR_BODY_LIMIT + 10) } });
    expect(res.statusCode).toBe(413);
    expect(lines).toHaveLength(0);
  });

  it('rate-limits each IP after 30 reports', async () => {
    const lines: string[] = [];
    const a = build(lines);
    for (let i = 0; i < 30; i++) expect((await a.inject({ method: 'POST', url: '/v1/client-error', payload: {} })).statusCode).toBe(204);
    const over = await a.inject({ method: 'POST', url: '/v1/client-error', payload: {} });
    expect(over.statusCode).toBe(429);
    expect(lines).toHaveLength(30);
  });
});
