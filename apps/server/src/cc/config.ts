import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerConfig } from '../server';

/**
 * Where a project's Claude Code session lives (design: one real session per project). Off unless
 * MEETLESS_CC_HOME is set, so tests and other servers never write project folders.
 * - MEETLESS_CC_HOME        the projects' folders, e.g. ~/meetless (no CLAUDE.md may sit there or above)
 * - MEETLESS_CC_CONFIG_DIR  CLAUDE_CONFIG_DIR for every session: its own login, never the machine's; default <home>/.claude-home
 * - MEETLESS_CC_CLAUDE      the claude binary; default ~/.local/bin/claude
 * - MEETLESS_CC_SSH_HOST    the host in the 在别处继续 commands (ssh -t <host> ...); none = those commands are left out
 * - MEETLESS_CC_USERS       the project owners (user ids, comma-separated) who get a session at all: a session runs
 *                           as this server's unix user and can be approved to run shell commands. Unset = nobody.
 * - MEETLESS_CC_REPO_ROOTS  where a project's read-only repo may live (colon-separated); default ~/github
 */
export interface CcConfig {
  home: string;
  configDir: string;
  claudeBin: string;
  sshHost: string | null;
  users: ReadonlySet<string>;
  repoRoots: string[];
  /** The meetless MCP as the sessions reach it: this server on loopback. */
  mcpUrl: string;
}

export function ccConfigFrom(cfg: ServerConfig): CcConfig | null {
  const env = cfg.env ?? process.env;
  if (!env.MEETLESS_CC_HOME) return null;
  const home = resolve(env.MEETLESS_CC_HOME);
  const host = cfg.host === '0.0.0.0' || cfg.host === '::' ? '127.0.0.1' : cfg.host;
  return {
    home,
    configDir: resolve(env.MEETLESS_CC_CONFIG_DIR ?? join(home, '.claude-home')),
    claudeBin: env.MEETLESS_CC_CLAUDE ?? join(homedir(), '.local/bin/claude'),
    sshHost: env.MEETLESS_CC_SSH_HOST || null,
    users: new Set((env.MEETLESS_CC_USERS ?? '').split(',').map((u) => u.trim()).filter(Boolean)),
    repoRoots: (env.MEETLESS_CC_REPO_ROOTS ?? join(homedir(), 'github')).split(':').filter(Boolean).map((r) => resolve(r)),
    mcpUrl: `http://${host.includes(':') ? `[${host}]` : host}:${cfg.port}/mcp`,
  };
}
