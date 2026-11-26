import { useEffect, useMemo, useState } from 'react';
import type { MeetlessBridge } from '@meetless/client/bridge';
import { AppProvider, useApp } from './app/AppContext';
import { SignIn } from './setup/SignIn';
import { Shell } from './shell/Shell';
import './setup/setup.css';

/** Bridge calls that mean work is in flight (an upload, a capture, an import): no silent relaunch meanwhile. */
const BUSY_CALLS: ReadonlySet<string> = new Set(['uploadBlob', 'captureRun', 'captureBindRepo', 'overleafSync', 'notionPage', 'api', 'submit']);
let inFlight = 0;

/**
 * The bridge with its busy calls counted. A new plain object, never a Proxy: the preload's bridge is
 * frozen by contextBridge (read-only, non-configurable properties), and the web bridge keeps its
 * methods on a class prototype, so every method is copied, bound to the original.
 */
function tracked(bridge: MeetlessBridge): MeetlessBridge {
  const out: Record<string, unknown> = {};
  const names = new Set<string>();
  for (let o: object | null = bridge; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const k of Object.getOwnPropertyNames(o)) if (k !== 'constructor') names.add(k);
  }
  for (const k of names) {
    const v = (bridge as unknown as Record<string, unknown>)[k];
    if (typeof v !== 'function') continue;
    const fn = v as (...a: unknown[]) => unknown;
    out[k] = BUSY_CALLS.has(k)
      ? (...args: unknown[]) => {
          inFlight++;
          return Promise.resolve(fn.apply(bridge, args)).finally(() => inFlight--);
        }
      : (...args: unknown[]) => fn.apply(bridge, args);
  }
  return out as unknown as MeetlessBridge;
}

/**
 * Whether the user is in the middle of something main must not interrupt with a silent hot-update
 * relaunch or reload: a call in flight, an open dialog, a field being typed in, or any unsent text.
 */
(window as { __meetlessBusy?: () => boolean }).__meetlessBusy = () => {
  if (inFlight > 0 || document.querySelector('.modal')) return true;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return true;
  return [...document.querySelectorAll('textarea')].some((el) => el.value.trim() !== '');
};

export function App({ bridge }: { bridge: MeetlessBridge | null }) {
  const watched = useMemo(() => (bridge ? tracked(bridge) : null), [bridge]);
  if (!watched) return <NoBridge />;
  return (
    <AppProvider bridge={watched}>
      <Root />
    </AppProvider>
  );
}

/** Shown outside the desktop app with no dev bridge: there is no locale yet, so both languages. */
function NoBridge() {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="brand-mark" />
          Meetless
        </div>
        <p className="muted">No client bridge. Open this renderer inside the Meetless desktop app, or from a dev bridge host with ?bridge=&lt;url&gt;&amp;bridgeToken=&lt;token&gt;.</p>
        <p className="muted">未连接客户端桥接。请在 Meetless 桌面应用中打开，或通过开发用 bridge host 打开。</p>
      </div>
    </div>
  );
}

function Root() {
  const { snapshot } = useApp();
  return (
    <>
      {snapshot.session ? <Shell /> : <SignIn />}
      <NewBuild />
    </>
  );
}

/** Web: the server has a newer renderer build than this page (a `newBuild` event): offer a refresh. */
function NewBuild() {
  const { bridge, t } = useApp();
  const [shown, setShown] = useState(false);
  useEffect(() => bridge.subscribe((e) => e.type === 'newBuild' && setShown(true)), [bridge]);
  if (!shown) return null;
  return (
    <button type="button" className="chip new-build" data-testid="new-build" onClick={() => window.location.reload()}>
      {t('web.newBuild')}
    </button>
  );
}
