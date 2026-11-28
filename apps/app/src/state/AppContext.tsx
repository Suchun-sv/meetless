import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import type { ApiRequest, ApiResponse, AppApiName } from '@meetless/api';
import type { ClientSnapshot, MeetlessBridge, Result, SubmitResult } from '@meetless/client/bridge';
import type { DomainEvent, EventPayloads, EventType, Id, IsoDate, IsoTime, State } from '@meetless/core';
import { asLocale, useI18n, type I18n, type Locale } from '@/i18n';
import { localDay, newId, safeReplay, type Replayed } from './model';
import { routeToHref, type AppRoute } from './routes';

export interface Notice {
  id: number;
  tone: 'error' | 'info';
  text: string;
  /** A one-tap action on the toast (撤销). */
  action?: { label: string; onPress: () => void };
}

/**
 * The app context (the renderer's AppContext without its route and overlay state: Expo Router owns
 * navigation here). The core reducer runs on the client over the server-accepted events in memory.
 */
export interface AppApi extends I18n {
  bridge: MeetlessBridge;
  snapshot: ClientSnapshot;
  /** The replayed state (`@meetless/core` State). */
  live: State;
  skipped: DomainEvent[];
  me: Id;
  today: IsoDate;
  notices: Notice[];
  notify(tone: Notice['tone'], text: string, action?: Notice['action']): void;
  dismissNotice(id: number): void;
  /** Shows a notice when rejected, or when queued offline (desktop). */
  submit<K extends EventType>(type: K, payload: EventPayloads[K], opts?: { occurredAt?: IsoTime }): Promise<SubmitResult>;
  /** No notice; the caller decides. */
  api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>>;
  signOut(): Promise<void>;
}

export const AppCtx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Navigate with the renderer's Route shape: `const go = useGo(); go({ view: 'board', projectId })`. */
export function useGo(): (r: AppRoute, opts?: { replace?: boolean }) => void {
  const router = useRouter();
  return useCallback((r, opts) => (opts?.replace ? router.replace(routeToHref(r)) : router.push(routeToHref(r))), [router]);
}

/** Holds the bridge snapshot and the replayed state; the locale comes from I18nProvider. */
export function AppProvider({ bridge, children, fallback = null }: { bridge: MeetlessBridge; children: ReactNode; fallback?: ReactNode }) {
  const i18n = useI18n();
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null);
  const [replayed, setReplayed] = useState<Replayed>(() => safeReplay([]));
  const [notices, setNotices] = useState<Notice[]>([]);
  const [today, setToday] = useState(localDay);
  const noticeId = useRef(0);
  const eventsRef = useRef<DomainEvent[]>([]);
  const { setLocale } = i18n;

  useEffect(() => {
    let alive = true;
    const setEvents = (next: DomainEvent[]) => {
      eventsRef.current = next;
      setSnapshot((s) => (s ? { ...s, events: next } : s));
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
          setEvents(e.events);
          setReplayed(safeReplay(e.events));
          return;
        case 'status':
          return setSnapshot((s) => (s ? { ...s, status: e.status } : s));
        case 'session':
          return setSnapshot((s) => (s ? { ...s, session: e.session, locale: e.locale } : s));
        case 'outbox':
          // Desktop (ClientNode) only: commands kept while offline, not yet effective for the team.
          return setSnapshot((s) => (s ? { ...s, outbox: e.outbox } : s));
        default:
          return;
      }
    });
    void bridge.snapshot().then((s) => {
      if (!alive) return;
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

  // The signed-in user's recorded locale wins over the device default the first time.
  const serverLocale = asLocale(snapshot?.locale);
  const adopted = useRef(false);
  useEffect(() => {
    if (!adopted.current && serverLocale && snapshot?.session) {
      adopted.current = true;
      if (serverLocale !== i18n.locale) setLocale(serverLocale);
    }
  }, [serverLocale, snapshot?.session, i18n.locale, setLocale]);

  // The date rolls over at midnight while the app stays open.
  useEffect(() => {
    const id = setInterval(() => setToday(localDay()), 60_000);
    return () => clearInterval(id);
  }, []);

  const notify = useCallback((tone: Notice['tone'], text: string, action?: Notice['action']) => {
    const id = ++noticeId.current;
    setNotices((n) => [...n.slice(-3), { id, tone, text, ...(action ? { action } : {}) }]);
    if (tone === 'info') setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), action ? 6000 : 4000);
  }, []);

  const { errorText } = i18n;
  const submit = useCallback(
    async <K extends EventType>(type: K, payload: EventPayloads[K], opts: { occurredAt?: IsoTime } = {}) => {
      const r = await bridge.submit({ id: newId('cmd'), type, payload, ...opts });
      if (r.kind === 'rejected') notify('error', errorText(r.code));
      if (r.kind === 'queued') notify('info', i18n.t('common.offlineNotEffective'));
      return r;
    },
    [bridge, notify, errorText, i18n],
  );

  const api = useMemo<AppApi | null>(() => {
    if (!snapshot) return null;
    return {
      ...i18n,
      setLocale: (l: Locale) => {
        i18n.setLocale(l);
        void bridge.setLocale(l);
      },
      bridge,
      snapshot,
      live: replayed.state,
      skipped: replayed.skipped,
      me: snapshot.session?.userId ?? '',
      today,
      notices,
      notify,
      dismissNotice: (id: number) => setNotices((n) => n.filter((x) => x.id !== id)),
      submit,
      api: (name, input) => bridge.api(name, input),
      signOut: () => bridge.signOut(),
    };
  }, [i18n, bridge, snapshot, replayed, today, notices, notify, submit]);

  if (!api) return <>{fallback}</>;
  return <AppCtx.Provider value={api}>{children}</AppCtx.Provider>;
}
