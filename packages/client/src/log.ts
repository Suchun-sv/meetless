import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small rotating file log for the desktop main process (and the dev bridge host).
 * `main.log` rotates to `main.1.log` … `main.<keep>.log` when it exceeds `maxBytes`.
 * Callers must never pass secrets (tokens, keys); `redact` strips anything that looks
 * like a bearer token or a dev token as a last line of defence.
 */
export interface FileLog {
  readonly file: string;
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

const redact = (s: string) => s.replace(/(Bearer\s+)\S+/gi, '$1[redacted]').replace(/\b(token|apiKey|api_key|x-api-key)(["'=:\s]+)[^\s"',}]+/gi, '$1$2[redacted]');

export function createFileLog(dir: string, opts: { name?: string; maxBytes?: number; keep?: number; echo?: boolean } = {}): FileLog {
  mkdirSync(dir, { recursive: true });
  const name = opts.name ?? 'main';
  const file = join(dir, `${name}.log`);
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const keep = opts.keep ?? 3;
  const rotate = () => {
    if (!existsSync(file) || statSync(file).size < maxBytes) return;
    rmSync(join(dir, `${name}.${keep}.log`), { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      const from = join(dir, `${name}.${i}.log`);
      if (existsSync(from)) renameSync(from, join(dir, `${name}.${i + 1}.log`));
    }
    renameSync(file, join(dir, `${name}.1.log`));
  };
  const write = (level: string, msg: string) => {
    const line = `${new Date().toISOString()} ${level} ${redact(msg)}\n`;
    try {
      rotate();
      appendFileSync(file, line);
    } catch {
      // Logging must never break the app.
    }
    if (opts.echo) (level === 'ERROR' ? console.error : console.log)(line.trimEnd());
  };
  return {
    file,
    info: (m) => write('INFO', m),
    error: (m, err) => write('ERROR', err === undefined ? m : `${m}: ${err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)}`),
  };
}
