import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiRequest, ApiResponse, AppApiName } from '@meetless/api';
import type { ClientSnapshot, MeetlessBridge, Result, SubmitResult } from '@meetless/client/bridge';
import type { DomainEvent, EventPayloads, EventType, Id, IsoDate, IsoTime, State } from '@meetless/core';
import {
  createTranslator,
  formatClock,
  formatDateTime,
  formatDay,
  isSupportedLocale,
  resolveLocale,
  type Locale,
  type MessageKey,
  type Params,
  type Translator,
} from '@meetless/i18n';
import { newId } from '../model/ids';
import { safeReplay, type Replayed } from '../model/state';
import type { Overlay } from './overlays';
import { defaultRoute, DRAWER_VIEWS, restoredRoute, type Route } from './routes';

/* The renderer's app context (contract §8). `Overlay` lives in app/overlays.tsx; re-exported here. */
export type { Overlay } from './overlays';

export interface Notice {
  id: number;
  tone: 'error' | 'info';
  text: string;
}

export interface AppApi {
  bridge: MeetlessBridge;
  snapshot: ClientSnapshot;
  live: State;
  skipped: DomainEvent[];
  me: Id;
  today: IsoDate;
  locale: Locale;
  setLocale(l: Locale): void;
  tr: Translator;
  t(key: MessageKey, params?: Params): string;
  errorText(code: string): string;
  timeZone: string;
  fmtDay(d: IsoDate): string;
  fmtClock(iso: IsoTime): string;
  fmtDateTime(iso: IsoTime): string;
  route: Route;
  go(r: Route): void;
  openNeed(projectId: Id, needId: Id): void;
  closeNeed(): void;
  overlay: Overlay | null;
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
  notices: Notice[];
  notify(tone: 'error' | 'info', text: string): void;
  dismissNotice(id: number): void;
  /** Shows a notice when rejected or queued. */
  submit<K extends EventType>(type: K, payload: EventPayloads[K], opts?: { occurredAt?: IsoTime }): Promise<SubmitResult>;
  /** No notice; the caller decides. */
  api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>>;
}

/** Exported for component tests, which provide a fixed AppApi. */
export const AppCtx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** The initial locale: the stored choice, else the system preference. */
export function pickLocale(stored: string | null, system: readonly string[]): Locale {
  return stored && isSupportedLocale(stored) ? stored : resolveLocale(system);
}

/** Where openNeed goes: the same drawer view of the same project, else that project's board. */
export function needRoute(from: Route, projectId: Id, needId: Id): Route {
  if ('projectId' in from && from.projectId === projectId && DRAWER_VIEWS.has(from.view)) return { view: from.view, projectId, needId };
  return { view: 'board', projectId, needId };
}

/** The local calendar date, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): IsoDate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const EMPTY: ClientSnapshot = {
  session: null,
  events: [],
  status: { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError: null },
  outbox: [],
  locale: null,
  systemLocales: typeof navigator !== 'undefined' ? [...navigator.languages] : [],
  cacheKind: 'sqlite',
  host: 'dev-bridge',
};

/** Holds the bridge snapshot, the replayed state, the route, the overlay and the notices. */
export function AppProvider({ bridge, children }: { bridge: MeetlessBridge; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null);
  const [replayed, setReplayed] = useState<Replayed>(() => safeReplay([]));
  const [route, setRoute] = useState<Route>(restoredRoute);
  // Main reads the route before a silent hot-update relaunch or reload, to come back to it.
  useEffect(() => {
    (window as { __meetlessRoute?: () => Route }).__meetlessRoute = () => route;
  }, [route]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const eventsRef = useRef<DomainEvent[]>([]);

  useEffect(() => {
    let alive = true;
    const setEvents = (next: DomainEvent[]) => {
      eventsRef.current = next;
      setSnapshot((s) => (s ? { ...s, events: next } : s));
    };
    const replaceEvents = (next: DomainEvent[]) => {
      setEvents(next);
      setReplayed(safeReplay(next));
    };
    const off = bridge.subscribe((e) => {
      switch (e.type) {
        case 'events': {
          const cur = eventsRef.current;
          const known = new Set(cur.map((x) => x.id));
          const fresh = e.events.filter((x) => !known.has(x.id));
          if (fresh.length === 0) return;
          const lastSeq = cur.at(-1)?.seq ?? 0;
          const next = [...cur, ...fresh].sort((a, b) => a.seq - b.seq);
          setEvents(next);
          // Strictly newer events apply incrementally; anything else replays from scratch.
          setReplayed((r) => (fresh.every((x) => x.seq > lastSeq) ? safeReplay(fresh, r) : safeReplay(next)));
          return;
        }
        case 'reset':
          return replaceEvents(e.events);
        case 'status':
          return setSnapshot((s) => (s ? { ...s, status: e.status } : s));
        case 'outbox':
          return setSnapshot((s) => (s ? { ...s, outbox: e.outbox } : s));
        case 'session':
          if (!e.session) {
            setRoute(defaultRoute());
            setOverlay(null);
          }
          return setSnapshot((s) => (s ? { ...s, session: e.session, locale: e.locale } : s));
      }
    });
    void bridge.snapshot().then((s) => {
      if (!alive) return;
      // Keep anything pushed while the snapshot was in flight.
      const byId = new Map([...s.events, ...eventsRef.current].map((x) => [x.id, x]));
      const events = [...byId.values()].sort((a, b) => a.seq - b.seq);
      eventsRef.current = events;
      setSnapshot({ ...s, events });
      setReplayed(safeReplay(events));
    });
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const snap = snapshot ?? EMPTY;
  const locale = pickLocale(snap.locale, snap.systemLocales);
  const tr = useMemo(() => createTranslator(locale), [locale]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const notify = useCallback((tone: Notice['tone'], text: string) => {
    const id = ++noticeId.current;
    setNotices((n) => [...n.slice(-3), { id, tone, text }]);
    if (tone === 'info') setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 4000);
  }, []);

  const errorText = useCallback((code: string) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code })), [tr]);

  const submit = useCallback(
    async <K extends EventType>(type: K, payload: EventPayloads[K], opts: { occurredAt?: IsoTime } = {}) => {
      const r = await bridge.submit({ id: newId('cmd'), type, payload, ...opts });
      if (r.kind === 'rejected') notify('error', errorText(r.code));
      if (r.kind === 'queued') notify('info', tr.t('common.offlineNotEffective'));
      return r;
    },
    [bridge, notify, errorText, tr],
  );

  if (!snapshot) return <div className="page muted">{tr.t('common.loading')}</div>;

  const api: AppApi = {
    bridge,
    snapshot: snap,
    live: replayed.state,
    skipped: replayed.skipped,
    me: snap.session?.userId ?? '',
    today: localDay(),
    locale,
    setLocale: (l) => void bridge.setLocale(l),
    tr,
    t: tr.t,
    errorText,
    timeZone,
    fmtDay: (d) => formatDay(d, locale),
    fmtClock: (iso) => formatClock(iso, locale, timeZone),
    fmtDateTime: (iso) => formatDateTime(iso, locale, timeZone),
    route,
    go: setRoute,
    openNeed: (projectId, needId) => setRoute((r) => needRoute(r, projectId, needId)),
    closeNeed: () => setRoute((r) => ('projectId' in r && r.needId ? { ...r, needId: null } : r)),
    overlay,
    openOverlay: setOverlay,
    closeOverlay: () => setOverlay(null),
    notices,
    notify,
    dismissNotice: (id) => setNotices((n) => n.filter((x) => x.id !== id)),
    submit,
    api: (name, input) => bridge.api(name, input),
  };
  return <AppCtx.Provider value={api}>{children}</AppCtx.Provider>;
}
