import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const desktopDir = resolve(import.meta.dirname, '..');
const serverDir = resolve(desktopDir, '../server');

export interface Proc {
  child: ChildProcess;
  stop(): Promise<void>;
}

/** SIGTERM, then SIGKILL after `graceMs`; resolves once the child has exited. */
function kill(child: ChildProcess, graceMs: number): Promise<void> {
  return new Promise<void>((r) => {
    if (child.exitCode !== null || child.signalCode !== null) return r();
    const hard = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('exit', () => {
      clearTimeout(hard);
      r();
    });
    child.kill('SIGTERM');
  });
}

/**
 * Spawns `cmd` and resolves once its output matches `ready`. If it is not ready within
 * `timeoutMs`, the child is killed (SIGTERM, then SIGKILL after `graceMs`) and the promise
 * rejects only after the child has exited, so a failed start-up never leaves an orphan. The
 * rejection carries the child's `pid` and its output so far.
 */
export function startProc(cmd: string[], cwd: string, env: Record<string, string>, ready: RegExp, name: string, timeoutMs = 30_000, graceMs = 5_000): Promise<Proc> {
  return new Promise((res, rej) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const error = (message: string) => Object.assign(new Error(`${message}:\n${out}`), { pid: child.pid });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void kill(child, graceMs).then(() => rej(error(`${name} did not start within ${timeoutMs} ms`)));
    }, timeoutMs);
    const onData = (d: Buffer) => {
      out += d.toString();
      if (!settled && ready.test(out)) {
        settled = true;
        clearTimeout(timer);
        res({ child, stop: () => kill(child, graceMs) });
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.once('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(error(`${name} could not be spawned (${e.message})`));
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(error(`${name} exited ${code}`));
    });
  });
}

/** The real sync server as its own process (Postgres store). */
export function startServerProc(env: Record<string, string>) {
  return startProc(['node', '--import', 'tsx', 'src/main.ts'], serverDir, env, /listening on/, 'server');
}

/** One client instance = one dev bridge host process with its own data dir. */
export function startBridgeProc(opts: { dataDir: string; port: number; locale: string; token: string; env?: Record<string, string> }) {
  return startProc(
    ['node', '--import', 'tsx', 'src/bridge-host/main.ts', '--data-dir', opts.dataDir, '--port', String(opts.port), '--locale', opts.locale, '--token', opts.token],
    desktopDir,
    opts.env ?? {},
    /meetless-dev-bridge\]/,
    `bridge ${opts.port}`,
  );
}
