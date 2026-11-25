/**
 * Fixed-window rate limiter, keyed by an arbitrary string (the client IP for sign-in and
 * invite redemption; contract §12.8). Only failures are meant to be counted by callers:
 * this class just counts whatever `hit` is called with.
 *
 * Per-call cost is O(1): `hit` and `blocked` only ever look at the one key they were
 * called with. Cleaning up *other* keys' expired windows (so a stream of distinct,
 * short-lived IPs does not grow the map forever) is a separate, amortised full-map sweep
 * that runs at most once per `windowMs`, not on every call.
 */
export interface RateLimitOpts {
  limit: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

interface Window {
  count: number;
  resetAt: number;
}

/** Test-only seam: `onSweep` fires once per full-map sweep, so a test can count them without timing. */
export interface RateLimiterHooks {
  onSweep?: () => void;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  /** `-Infinity` so the very first call always sweeps (trivial: the map is empty). */
  private lastSweep = -Infinity;

  constructor(
    private readonly opts: RateLimitOpts,
    private readonly now: () => number,
    private readonly hooks: RateLimiterHooks = {},
  ) {}

  /** Current number of keys with a live (unexpired) window; expired ones are pruned first. */
  get size(): number {
    this.maybeSweep(this.now());
    return this.windows.size;
  }

  /** Counts one attempt for `key`. The `limit + 1`-th attempt inside the window is refused. */
  hit(key: string): RateLimitResult {
    const t = this.now();
    this.maybeSweep(t);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + this.opts.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return this.resultFor(w, t);
  }

  /** The same check as `hit`, but does not count an attempt. */
  blocked(key: string): RateLimitResult {
    const t = this.now();
    this.maybeSweep(t);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) return { ok: true };
    return this.resultFor(w, t);
  }

  private resultFor(w: Window, t: number): RateLimitResult {
    if (w.count <= this.opts.limit) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
  }

  /**
   * A full-map sweep, dropping every window whose fixed period has elapsed, so stale IPs
   * do not grow the map forever. Amortised to at most once per `windowMs`: `hit` and
   * `blocked` stay O(1) per call (they only ever touch their own key's window) except for
   * this occasional sweep, which every caller pays for equally rather than none of them.
   */
  private maybeSweep(t: number): void {
    if (t - this.lastSweep < this.opts.windowMs) return;
    this.lastSweep = t;
    this.hooks.onSweep?.();
    for (const [key, w] of this.windows) {
      if (w.resetAt <= t) this.windows.delete(key);
    }
  }
}

/** `MEETLESS_RATE_SIGNIN` / `MEETLESS_RATE_REDEEM`: `<limit>/<seconds>` (e.g. `10/300`); throws on a malformed value. */
export function parseRateLimitEnv(raw: string | undefined, envName: string, def: RateLimitOpts): RateLimitOpts {
  if (raw === undefined) return def;
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  const limit = m ? Number(m[1]) : NaN;
  const seconds = m ? Number(m[2]) : NaN;
  if (!m || !(limit > 0) || !(seconds > 0)) {
    throw new Error(`${envName} must be "<limit>/<seconds>" with positive integers (e.g. "10/300"), got ${JSON.stringify(raw)}`);
  }
  return { limit, windowMs: seconds * 1000 };
}
