import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename } from 'node:path';

export interface Elsewhere {
  pid: number | null;
  /** Shown in 「正在别处使用」: 终端, Remote Control, 后台. */
  how: string;
}

/**
 * A claude process under our config dir that holds this session: by its id or name on the command
 * line (`--resume <id>`, `-n`/`--remote-control "<name>"`, `attach <id>`), or running in the
 * project's folder. Our own turn's process is skipped.
 */
export function claudeProcess(opts: { configDir: string; sessionId: string | null; name: string | null; folder: string; skip: ReadonlySet<number> }): Elsewhere | null {
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return null;
  }
  for (const d of pids) {
    const pid = Number(d);
    if (pid === process.pid || opts.skip.has(pid)) continue;
    let argv: string[];
    try {
      argv = readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch {
      continue;
    }
    if (!argv.length) continue;
    const exe = basename(argv[0]!);
    if (exe !== 'claude' && !argv[0]!.includes('/claude/versions/')) continue;
    let env: string;
    try {
      env = readFileSync(`/proc/${d}/environ`, 'utf8');
    } catch {
      continue;
    }
    if (!env.split('\0').includes(`CLAUDE_CONFIG_DIR=${opts.configDir}`)) continue;
    let cwd = '';
    try {
      cwd = readlinkSync(`/proc/${d}/cwd`);
    } catch {
      cwd = '';
    }
    const named = opts.name !== null && argv.includes(opts.name);
    const byId = opts.sessionId !== null && argv.some((a) => a.includes(opts.sessionId!));
    if (!(byId || named || cwd === opts.folder)) continue;
    const how = argv.some((a) => a.startsWith('--remote-control')) || argv.includes('remote-control') ? 'Remote Control' : argv.includes('--bg') ? '后台' : '终端';
    return { pid, how };
  }
  return null;
}

/** `claude agents --json`: a background session of ours (by id or folder) that has not finished. */
export function backgroundAgent(opts: { claudeBin: string; env: NodeJS.ProcessEnv; sessionId: string | null; folder: string }): Promise<Elsewhere | null> {
  return new Promise((resolve) => {
    execFile(opts.claudeBin, ['agents', '--json', '--cwd', opts.folder], { env: opts.env, timeout: 8000, cwd: opts.folder }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const list = JSON.parse(stdout) as unknown[];
        // Entries look like {pid, cwd, kind: 'interactive' | ..., sessionId, name, status: 'idle' | ...}.
        type Agent = { pid?: unknown; cwd?: unknown; kind?: unknown; sessionId?: unknown; status?: unknown };
        const live = ((list ?? []) as Agent[]).find((x) => {
          const status = String(x.status ?? '').toLowerCase();
          const ours = (opts.sessionId !== null && x.sessionId === opts.sessionId) || x.cwd === opts.folder;
          return ours && !/complete|done|exit|fail|stop/.test(status);
        });
        if (!live) return resolve(null);
        const pid = typeof live.pid === 'number' ? live.pid : null;
        resolve({ pid, how: live.kind === 'interactive' ? '终端' : '后台' });
      } catch {
        resolve(null);
      }
    });
  });
}
