import { viewFor, type EventPayloads, type EventType, type Id, type State } from '@meetless/core';
import type { Locale } from '@meetless/i18n';
import type { AppApi } from '../../src/renderer/app/AppContext';
import { fakeApi, sample } from '../support/app';
import { Log } from '../support/log';

/** Decodes the entities React's `renderToStaticMarkup` escapes (there is no jsdom here). */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Plain text of a rendered markup string: tags stripped, entities decoded. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''));
}

/** The two shipped locales (contract: zh-CN and en, both complete). */
export const LOCALES = ['zh-CN', 'en'] as const;

/**
 * Applies `cmds` to the full sample state (not a per-user view), each as one event from `actor`
 * through core's reducer (the same validation the service runs). Throws the core DomainError on
 * any command the reducer rejects, so a bad fixture fails the test that builds it.
 */
export function sampleWith(locale: Locale, cmds: { type: EventType; payload: unknown }[], actor: Id = 'u-alex'): State {
  const log = new Log({ initial: sample(locale).state });
  for (const cmd of cmds) log.emit(cmd.type, actor, cmd.payload as unknown as EventPayloads[EventType]);
  return log.state;
}

/** A `fakeApi` for 'u-alex', `live` defaulting to their view of the sample (or of `over.state`). */
export function alexApi(locale: Locale, over: Partial<Parameters<typeof fakeApi>[0]> & { state?: State } = {}): AppApi {
  const id: Id = 'u-alex';
  return fakeApi({ live: viewFor(over.state ?? sample(locale).state, id), me: id, locale, today: '2026-11-24', ...over });
}

/** A `fakeApi` for 'u-zhou', `live` defaulting to their view of the sample (or of `over.state`). */
export function zhouApi(locale: Locale, over: Partial<Parameters<typeof fakeApi>[0]> & { state?: State } = {}): AppApi {
  const id: Id = 'u-zhou';
  return fakeApi({ live: viewFor(over.state ?? sample(locale).state, id), me: id, locale, today: '2026-11-24', ...over });
}

/** The title of the private hypothesis `Hp1` in `sample-paper` (the sample's one private need). */
export function privateTitle(locale: Locale): string {
  const { state } = sample(locale);
  const need = Object.values(state.needs).find((n) => n.projectId === 'sample-paper' && n.code === 'Hp1');
  if (!need) throw new Error('Hp1 not found in sample-paper');
  return need.title;
}
