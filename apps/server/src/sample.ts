import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Id } from '@meetless/core';
import { buildSample, loadPrototype, replayActions, SAMPLE_PROJECT_IDS, type SampleLocale, type SampleOptions } from '@meetless/sample';
import type { SyncService } from './service';

/** Three levels above `apps/server/src`: where `design/claude-design-v3` lives. */
export const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** `MEETLESS_SAMPLE` (`zh-CN` or `en`) and `MEETLESS_SAMPLE_ME` (default `u-alex`); unset = no sample. */
export function sampleFromEnv(env: Record<string, string | undefined>): { locale: SampleLocale; me: Id } | null {
  const locale = env.MEETLESS_SAMPLE;
  if (locale === undefined || locale === '') return null;
  if (locale !== 'zh-CN' && locale !== 'en') throw new Error(`MEETLESS_SAMPLE must be zh-CN or en, not ${locale}`);
  return { locale, me: env.MEETLESS_SAMPLE_ME || 'u-alex' };
}

/**
 * Appends the prototype's sample projects (the paper and Atlas) through
 * `appendTrusted`, one command at a time.
 * - A no-op (`loaded: false`, nothing written) when the sample is already fully
 *   there, or when the log holds any other project (a schema with data). User
 *   registrations alone are not data; the dev users' own come back as duplicates.
 * - Refuses (throws) when a sample project exists but the sample's last command
 *   is missing from the log: an earlier load stopped part-way.
 * - Before writing, replays the whole sample on top of the current state and
 *   throws naming the first command that does not replay, with nothing written.
 * - If an append still fails, stops there and throws with the failing command id.
 */
export async function loadSample(service: SyncService, opts: SampleOptions & { repoRoot: string }): Promise<{ loaded: boolean; events: number }> {
  const s = service.current;
  const actions = buildSample(loadPrototype(opts.repoRoot), opts);
  const last = actions.at(-1)!.cmd.id;
  if (Object.values(SAMPLE_PROJECT_IDS).some((id) => s.projects[id])) {
    if (!Object.prototype.hasOwnProperty.call(s.seenEventIds, last)) throw new Error(`sample data is only partly loaded (missing ${last}); reset the sample schema`);
    return { loaded: false, events: 0 };
  }
  // Projects are never removed, so "a project in the state" = "a project.created in the log".
  if (Object.keys(s.projects).length > 0) return { loaded: false, events: 0 };

  for (const { actorId, cmd } of actions) {
    const seen = Object.prototype.hasOwnProperty.call(s.seenEventIds, cmd.id) ? service.eventAt(s.seenEventIds[cmd.id]!) : null;
    if (seen && seen.actorId !== actorId) throw new Error(`sample data: command id ${cmd.id} is already taken by ${seen.actorId}; nothing written`);
  }
  try {
    replayActions(actions, s, Math.max(Date.now(), s.lastRecordedAt ? Date.parse(s.lastRecordedAt) : 0));
  } catch (e) {
    throw new Error(`sample data does not replay, nothing written: ${(e as Error).message}`, { cause: e });
  }

  let events = 0;
  for (const { actorId, cmd } of actions) {
    let status: string;
    try {
      ({ status } = await service.appendTrusted(actorId, cmd));
    } catch (e) {
      throw new Error(`sample data: command ${cmd.id} (${cmd.type}) failed: ${(e as Error).message}`, { cause: e });
    }
    if (status === 'accepted') events += 1;
  }
  return { loaded: true, events };
}

/** Today's date in UTC, YYYY-MM-DD. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
