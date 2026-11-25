import type { FastifyInstance } from 'fastify';
import { RateLimiter } from '../api/ratelimit';
import type { ServerConfig } from '../server';

/** The body cap for one report: generous for a stack, small enough that a flood stays cheap. */
export const CLIENT_ERROR_BODY_LIMIT = 8 * 1024;
const FIELDS = { kind: 40, message: 2000, stack: 4000, ua: 400, path: 200 } as const;

/** One report field as a single-line, length-capped string; anything that is not a string becomes ''. */
function field(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, max) : '';
}

/**
 * `POST /v1/client-error`: the web page's boot guard (`renderer/public/boot.js`) and the React error
 * boundary report an error that kept the app from starting, so an operator can read in the server log
 * what a user's browser hit. Unauthenticated (the page may fail before sign-in), so: an 8 KB body cap,
 * fixed fields cut to fixed lengths, a per-IP limit that counts every report (30 per 10 minutes), and
 * one JSON log line. Cookies, headers other than the user agent field, and query strings are never
 * logged. Answers 204 with no body.
 */
export function registerClientErrors(app: FastifyInstance, cfg: ServerConfig, print: (line: string) => void = (l) => console.warn(l)): void {
  const limiter = new RateLimiter({ limit: 30, windowMs: 10 * 60_000 }, () => cfg.now().getTime());
  app.post('/v1/client-error', { bodyLimit: CLIENT_ERROR_BODY_LIMIT }, async (req, reply) => {
    const hit = limiter.hit(req.ip);
    if (!hit.ok) return reply.code(429).header('Retry-After', String(hit.retryAfterSec)).send({ error: { code: 'RATE_LIMITED', details: { retryAfter: hit.retryAfterSec } } });
    const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    const entry = {
      at: cfg.now().toISOString(),
      ip: req.ip,
      kind: field(b.kind, FIELDS.kind),
      message: field(b.message, FIELDS.message),
      stack: field(b.stack, FIELDS.stack),
      ua: field(b.ua, FIELDS.ua),
      path: field(b.path, FIELDS.path).split('?')[0],
    };
    print(`[meetless-client-error] ${JSON.stringify(entry)}`);
    return reply.code(204).send();
  });
}
