import { describe, expect, it } from 'vitest';
import { startProc } from '../e2e/procs';

/** e2e process start-up must not leave orphans behind when a process never gets ready. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('e2e startProc', () => {
  it('kills a child that never prints its ready line, before rejecting', async () => {
    const err = (await startProc(['node', '-e', 'console.log("booting"); setInterval(() => {}, 1000)'], process.cwd(), {}, /never-ready/, 'stuck', 300).catch((e: unknown) => e)) as Error & { pid?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/stuck did not start within 300 ms/);
    expect(err.message).toContain('booting');
    expect(err.pid).toBeTypeOf('number');
    expect(alive(err.pid!)).toBe(false);
  });

  it('also kills a child that ignores SIGTERM', async () => {
    const err = (await startProc(['node', '-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], process.cwd(), {}, /never-ready/, 'stubborn', 300, 300).catch(
      (e: unknown) => e,
    )) as Error & { pid?: number };
    expect(err.pid).toBeTypeOf('number');
    expect(alive(err.pid!)).toBe(false);
  });

  it('resolves on the ready line, and stop() ends the child', async () => {
    const p = await startProc(['node', '-e', 'console.log("ready now"); setInterval(() => {}, 1000)'], process.cwd(), {}, /ready now/, 'ok', 5_000);
    const pid = p.child.pid!;
    expect(alive(pid)).toBe(true);
    await p.stop();
    expect(alive(pid)).toBe(false);
  });
});
