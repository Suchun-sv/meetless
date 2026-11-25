import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BRIDGE_METHODS, type ClientSnapshot, type MeetlessBridge, type SubmitResult } from '@meetless/client/bridge';
import type { Id, IsoDate, State } from '@meetless/core';
import { createTranslator, formatClock, formatDateTime, formatDay, type Locale } from '@meetless/i18n';
import { sampleState, type SampleReplay } from '@meetless/sample';
import { AppCtx, needRoute, type AppApi, type Overlay } from '../../src/renderer/app/AppContext';
import { defaultRoute, type Route } from '../../src/renderer/app/routes';
import { newId } from '../../src/renderer/model/ids';

/*
 * Test support for renderer component tests (contract §8). Markup is rendered on the server side
 * with renderToStaticMarkup; the repo has no jsdom.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const NOT_AVAILABLE = { ok: false, code: 'NOT_AVAILABLE' } as const;

/**
 * A bridge where every method resolves `{ ok: false, code: 'NOT_AVAILABLE' }` unless overridden,
 * except `submit`, which resolves the SubmitResult `{ kind: 'rejected', code: 'NOT_AVAILABLE' }`;
 * `subscribe` registers nothing. Override `api` to fake the server's routes in component tests.
 */
export function fakeBridge(over: Partial<MeetlessBridge> = {}): MeetlessBridge {
  const methods = Object.fromEntries(BRIDGE_METHODS.map((m) => [m, async () => NOT_AVAILABLE])) as unknown as Omit<MeetlessBridge, 'subscribe'>;
  // submit answers with a SubmitResult, not a Result: the rejected variant with the same code.
  const submit = async (): Promise<SubmitResult> => ({ kind: 'rejected', code: 'NOT_AVAILABLE' });
  return { ...methods, submit, subscribe: () => () => undefined, ...over };
}

/**
 * A fixed AppApi over `live` for `me`. Defaults: locale 'en', route `defaultRoute()`, today
 * '2026-11-24', no overlay, `fakeBridge()`, time zone UTC. `submit` and `api` forward to the
 * bridge, so a test that overrides `bridge.submit` or `bridge.api` sees the calls. Navigation,
 * overlay, notice and locale calls update the returned object in place (nothing re-renders),
 * so a test can call a handler and then read `route`, `overlay`, `notices` or `locale`.
 */
export function fakeApi(opts: { live: State; me: Id; locale?: Locale; route?: Route; today?: IsoDate; overlay?: Overlay | null; bridge?: MeetlessBridge }): AppApi {
  const locale = opts.locale ?? 'en';
  const tr = createTranslator(locale);
  const bridge = opts.bridge ?? fakeBridge();
  const timeZone = 'UTC';
  const snapshot: ClientSnapshot = {
    session: { serverUrl: 'http://127.0.0.1:4870', userId: opts.me, displayName: opts.live.users[opts.me]?.displayName ?? opts.me },
    events: [],
    status: { state: 'online', lastSyncedAt: null, cursor: opts.live.lastSeq, lastError: null },
    outbox: [],
    locale,
    systemLocales: [],
    cacheKind: 'sqlite',
    host: 'dev-bridge',
  };
  let nextNotice = 0;
  const api: AppApi = {
    bridge,
    snapshot,
    live: opts.live,
    skipped: [],
    me: opts.me,
    today: opts.today ?? '2026-11-24',
    locale,
    setLocale: (l) => void (api.locale = l),
    tr,
    t: tr.t,
    errorText: (code) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code })),
    timeZone,
    fmtDay: (d) => formatDay(d, locale),
    fmtClock: (iso) => formatClock(iso, locale, timeZone),
    fmtDateTime: (iso) => formatDateTime(iso, locale, timeZone),
    route: opts.route ?? defaultRoute(),
    go: (r) => void (api.route = r),
    openNeed: (projectId, needId) => void (api.route = needRoute(api.route, projectId, needId)),
    closeNeed: () => void (api.route = 'projectId' in api.route ? { ...api.route, needId: null } : api.route),
    overlay: opts.overlay ?? null,
    openOverlay: (o) => void (api.overlay = o),
    closeOverlay: () => void (api.overlay = null),
    notices: [],
    notify: (tone, text) => void api.notices.push({ id: ++nextNotice, tone, text }),
    dismissNotice: (id) => void (api.notices = api.notices.filter((n) => n.id !== id)),
    submit: (type, payload, o = {}) => bridge.submit({ id: newId('cmd'), type, payload, ...o }),
    api: (name, input) => bridge.api(name, input),
  };
  return api;
}

/** Renders `node` inside `AppCtx` with `api`, as static markup. */
export function render(api: AppApi, node: ReactNode): string {
  return renderToStaticMarkup(<AppCtx.Provider value={api}>{node}</AppCtx.Provider>);
}

const samples = new Map<Locale, SampleReplay>();

/** The sample projects for me = 'u-alex', today = '2026-11-24': the full service state, its events and their scopes. */
export function sample(locale: Locale): SampleReplay {
  let s = samples.get(locale);
  if (!s) {
    s = sampleState({ locale, me: 'u-alex', today: '2026-11-24', repoRoot: REPO_ROOT });
    samples.set(locale, s);
  }
  return s;
}
